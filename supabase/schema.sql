-- =====================================================================
-- To do list : synchronisation chiffrée de bout en bout + rappels push
-- Version 2 : appareils jumelés par QR code, sans e-mail ni mot de passe.
--
-- Chaque liste synchronisée a un « code de synchronisation » (affiché en QR code
-- dans l'application). L'appareil en dérive deux secrets distincts :
--   - une clé de chiffrement, qui ne quitte jamais l'appareil ;
--   - une clé d'accès (p_key), envoyée au serveur, dont le serveur ne garde que
--     l'empreinte SHA-256 : c'est l'identifiant du compte.
-- Le serveur ne stocke que du contenu chiffré : ni les tâches, ni les notes, ni le
-- texte des rappels ne lui sont lisibles. Les tables ne sont accessibles qu'à travers
-- les fonctions ci-dessous, qui vérifient la clé d'accès à chaque appel.
--
-- À coller tel quel dans Supabase : SQL Editor > New query > Run.
-- Réexécutable : les objets de la version 1 (connexion par e-mail) sont remplacés.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Secrets internes (clés d'envoi des notifications, jeton du cron) : jamais exposés à l'API.
create table if not exists private.secrets (
  name  text primary key,
  value text not null
);

-- ---------------------------------------------------------------------
-- Nettoyage de la version 1 (connexion par e-mail). Les données de la v1 sont
-- effacées : elles étaient rattachées à des comptes e-mail qui n'existent plus.
-- ---------------------------------------------------------------------
drop function if exists public.push_items(jsonb);
drop function if exists public.push_items(jsonb, text);
drop function if exists public.set_reminders(jsonb);
drop function if exists public.set_reminders(jsonb, text);
drop function if exists public.check_vault(text);
drop function if exists public.register_push(text, text, text, text);
drop function if exists public.unregister_push(text);
drop function if exists public.reset_cloud();
drop function if exists public.subs_for(uuid[]);
drop function if exists public.claim_due_reminders();
drop table if exists public.vault;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'user_id') then
    drop table public.items; drop table if exists public.reminders; drop table if exists public.push_subs;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
-- Un compte = une liste synchronisée. id : empreinte SHA-256 (hexadécimal) de la clé d'accès.
create table if not exists public.accounts (
  id         text primary key check (id ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

-- Codes retirés (« Changer de code ») : ne peuvent plus jamais être recréés ni utilisés.
create table if not exists public.retired_accounts (
  id         text primary key,
  retired_at timestamptz not null default now()
);
-- Créations récentes, pour limiter les créations en masse depuis une même adresse.
create table if not exists private.creations (
  ip  text not null,
  at  timestamptz not null default now()
);
create index if not exists creations_at on private.creations (at);

-- Les tâches (et les réglages), chiffrées. updated_at : horloge de l'appareil, pour la fusion.
-- modified_at : horloge du serveur, pour ne télécharger que ce qui a changé.
create table if not exists public.items (
  account     text not null references public.accounts(id) on delete cascade,
  id          text not null check (length(id) between 1 and 80),
  updated_at  bigint not null,
  deleted     boolean not null default false,
  data        text check (data is null or length(data) <= 200000),
  modified_at timestamptz not null default clock_timestamp(),
  primary key (account, id)
);
create index if not exists items_account_modified on public.items (account, modified_at, id);

-- Abonnements aux notifications (un par appareil).
create table if not exists public.push_subs (
  endpoint   text primary key,
  account    text not null references public.accounts(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  label      text,
  created_at timestamptz not null default now(),
  last_ok    timestamptz
);
create index if not exists push_subs_account on public.push_subs (account);

-- Prochains rappels à envoyer. payload : titre et texte du rappel, chiffrés.
create table if not exists public.reminders (
  account  text not null references public.accounts(id) on delete cascade,
  task_id  text not null,
  fire_at  timestamptz not null,
  payload  text not null check (length(payload) < 3000),
  sent_at  timestamptz,
  primary key (account, task_id)
);
create index if not exists reminders_due on public.reminders (fire_at) where sent_at is null;

-- Aucun accès direct : tout passe par les fonctions (security definer) qui vérifient la clé.
alter table public.accounts  enable row level security;
alter table public.retired_accounts enable row level security;
alter table public.items     enable row level security;
alter table public.push_subs enable row level security;
alter table public.reminders enable row level security;
revoke all on public.accounts, public.retired_accounts, public.items, public.push_subs, public.reminders from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Clé d'accès → compte
-- ---------------------------------------------------------------------
create or replace function private.key_hash(p_key text)
returns text language plpgsql immutable set search_path = pg_catalog as $$
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then raise exception 'clé invalide' using errcode = 'P0001'; end if;
  return encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
end $$;

-- Compte correspondant à la clé, ou erreur « compte inconnu » (code supprimé ou changé).
create or replace function private.account_of(p_key text)
returns text language plpgsql set search_path = pg_catalog, public as $$
declare a text := private.key_hash(p_key);
begin
  update public.accounts set last_seen = now() where id = a and last_seen < now() - interval '1 hour';
  if not exists (select 1 from public.accounts where id = a) then
    raise exception 'compte inconnu' using errcode = 'P0001';
  end if;
  return a;
end $$;

-- ---------------------------------------------------------------------
-- Fonctions appelées par l'application
-- ---------------------------------------------------------------------

-- Création d'une liste synchronisée (premier appareil). Sans effet si elle existe déjà.
create or replace function public.create_account(p_key text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  a  text := private.key_hash(p_key);
  v_ip text := coalesce(split_part((nullif(current_setting('request.headers', true), '')::json)->>'x-forwarded-for', ',', 1), '');
begin
  if exists (select 1 from public.retired_accounts where id = a) then
    raise exception 'code retiré' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.accounts where id = a) then return; end if;
  -- garde-fous contre les créations en masse : par adresse, puis au total
  delete from private.creations where at < now() - interval '1 day';
  if v_ip <> '' and (select count(*) from private.creations c where c.ip = v_ip and c.at > now() - interval '1 hour') >= 30 then
    raise exception 'trop de créations depuis cette adresse, réessayez dans une heure' using errcode = 'P0001';
  end if;
  if (select count(*) from private.creations where at > now() - interval '1 hour') >= 2000 then
    raise exception 'trop de créations, réessayez plus tard' using errcode = 'P0001';
  end if;
  insert into private.creations (ip) values (v_ip);
  insert into public.accounts (id) values (a) on conflict (id) do nothing;
end $$;

-- Description d'une liste avant de la rejoindre (pour repérer un lien piégé).
create or replace function public.account_info(p_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.account_of(p_key);
begin
  return jsonb_build_object(
    'created_at', (select created_at from public.accounts where id = a),
    'tasks', (select count(*) from public.items where account = a and not deleted and id <> '__settings'),
    'devices', (select count(*) from public.push_subs where account = a));
end $$;

-- Lecture des éléments modifiés après (p_since, p_after_id), par pages de 500, dans l'ordre du serveur.
create or replace function public.pull_items(p_key text, p_since timestamptz default null, p_after_id text default '')
returns table (id text, updated_at bigint, deleted boolean, data text, modified_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.account_of(p_key);
begin
  return query
    select i.id, i.updated_at, i.deleted, i.data, i.modified_at from public.items i
     where i.account = a
       and (p_since is null or (i.modified_at, i.id) > (p_since, coalesce(p_after_id, '')))
     order by i.modified_at, i.id
     limit 500;
end $$;

-- Lecture de quelques éléments précis (versions plus récentes que celles de l'appareil).
create or replace function public.get_items(p_key text, p_ids text[])
returns table (id text, updated_at bigint, deleted boolean, data text, modified_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.account_of(p_key);
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'trop d''éléments à la fois'; end if;
  return query
    select i.id, i.updated_at, i.deleted, i.data, i.modified_at from public.items i
     where i.account = a and i.id = any(p_ids);
end $$;

-- Envoi : la version la plus récente (selon l'appareil) l'emporte. Renvoie les identifiants
-- refusés parce que le serveur a déjà plus récent : l'appareil les relit et fusionne.
create or replace function public.push_items(p_key text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.account_of(p_key); rej jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'trop d''éléments à la fois'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where (r->>'updated_at')::bigint > (extract(epoch from now()) * 1000)::bigint + 86400000) then
    raise exception 'horloge de l''appareil en avance de plus d''un jour : vérifiez la date et l''heure' using errcode = 'P0001';
  end if;
  if (select count(*) from public.items where account = a) > 50000
     or (select coalesce(sum(length(data)), 0) from public.items where account = a)
        + (select coalesce(sum(length(r->>'data')), 0) from jsonb_array_elements(p_rows) r) > 30000000 then
    raise exception 'limite de stockage atteinte' using errcode = 'P0001';
  end if;
  insert into public.items (account, id, updated_at, deleted, data, modified_at)
  select a, r->>'id', (r->>'updated_at')::bigint, coalesce((r->>'deleted')::boolean, false), r->>'data', clock_timestamp()
  from jsonb_array_elements(p_rows) r
  on conflict (account, id) do update
    set updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data, modified_at = clock_timestamp()
    where public.items.updated_at < excluded.updated_at;
  select coalesce(jsonb_agg(i.id), '[]'::jsonb) into rej
    from jsonb_array_elements(p_rows) r
    join public.items i on i.account = a and i.id = r->>'id'
   where i.updated_at > (r->>'updated_at')::bigint
      or (i.updated_at = (r->>'updated_at')::bigint and i.data is distinct from r->>'data');
  return jsonb_build_object('rejected', rej);
end $$;

-- Remplace la liste des rappels à venir (calculée sur l'appareil).
create or replace function public.set_reminders(p_key text, p_rows jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.account_of(p_key);
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'trop de rappels'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where r->>'task_id' is null or r->>'payload' is null or length(r->>'payload') >= 3000 or length(r->>'task_id') > 80) then
    raise exception 'rappel trop volumineux';
  end if;
  delete from public.reminders
   where account = a
     and task_id not in (select r->>'task_id' from jsonb_array_elements(p_rows) r);
  insert into public.reminders (account, task_id, fire_at, payload, sent_at)
  select a, r->>'task_id', to_timestamp((r->>'fire_at')::double precision / 1000), r->>'payload', null
  from jsonb_array_elements(p_rows) r
  on conflict (account, task_id) do update
    set payload = excluded.payload,
        sent_at = case when public.reminders.fire_at = excluded.fire_at then public.reminders.sent_at else null end,
        fire_at = excluded.fire_at;
end $$;

-- Abonnement de l'appareil aux notifications (services de notification connus seulement).
create or replace function public.register_push(p_key text, p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.account_of(p_key);
begin
  if length(p_endpoint) > 1000 or p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com)/' then
    raise exception 'service de notification inconnu';
  end if;
  if length(p_p256dh) > 200 or length(p_auth) > 100 then raise exception 'abonnement invalide'; end if;
  insert into public.push_subs (endpoint, account, p256dh, auth, label)
  values (p_endpoint, a, p_p256dh, p_auth, left(p_label, 80))
  on conflict (endpoint) do update set account = a, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, created_at = now()
    where public.push_subs.account = a or public.push_subs.auth = excluded.auth;
  -- 10 appareils au plus : les plus anciens sont retirés
  delete from public.push_subs where endpoint in (
    select endpoint from public.push_subs where account = a order by created_at desc offset 10);
end $$;

create or replace function public.unregister_push(p_key text, p_endpoint text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.account_of(p_key);
begin
  delete from public.push_subs where endpoint = p_endpoint and account = a;
end $$;

-- Supprime la liste du serveur (changement de code, ou arrêt de la synchronisation).
-- Les appareils qui utilisaient ce code sont aussitôt déconnectés ; leurs tâches restent chez eux.
create or replace function public.delete_account(p_key text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a text := private.key_hash(p_key);
begin
  insert into public.retired_accounts (id) values (a) on conflict (id) do nothing;
  delete from public.accounts where id = a;
end $$;

-- Clé publique d'envoi des notifications (créée automatiquement par la fonction d'envoi).
create or replace function public.vapid_public_key()
returns text language sql security definer set search_path = public, private stable as $$
  select (value::jsonb)->>'publicKey' from private.secrets where name = 'vapid';
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.create_account(text), public.account_info(text), public.pull_items(text, timestamptz, text), public.get_items(text, text[]),
  public.push_items(text, jsonb), public.set_reminders(text, jsonb), public.register_push(text, text, text, text, text),
  public.unregister_push(text, text), public.delete_account(text), public.vapid_public_key() from public;
grant execute on function public.create_account(text), public.account_info(text), public.pull_items(text, timestamptz, text), public.get_items(text, text[]),
  public.push_items(text, jsonb), public.set_reminders(text, jsonb), public.register_push(text, text, text, text, text),
  public.unregister_push(text, text), public.delete_account(text), public.vapid_public_key() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Fonctions réservées à la fonction d'envoi (clé de service)
-- ---------------------------------------------------------------------
create or replace function public.todo_secret(p_name text)
returns text language sql security definer set search_path = private stable as $$
  select value from private.secrets where name = p_name;
$$;
create or replace function public.todo_init_secret(p_name text, p_value text)
returns text language plpgsql security definer set search_path = private as $$
begin
  insert into private.secrets (name, value) values (p_name, p_value) on conflict (name) do nothing;
  return (select value from private.secrets where name = p_name);
end $$;

-- Réserve les rappels arrivés à échéance (un seul envoi même si deux exécutions se chevauchent).
-- user_id : identifiant du compte (nom conservé pour la fonction d'envoi).
create or replace function public.claim_due_reminders()
returns table (user_id text, task_id text, payload text, fire_at timestamptz, fresh boolean)
language sql security definer set search_path = public as $$
  update public.reminders r set sent_at = now()
   where (r.account, r.task_id) in (
     select q.account, q.task_id from public.reminders q
      where q.sent_at is null and q.fire_at <= now()
      order by q.fire_at limit 300 for update skip locked)
  returning r.account, r.task_id, r.payload, r.fire_at, (r.fire_at > now() - interval '12 hours') as fresh;
$$;
create or replace function public.subs_for(p_users text[])
returns table (endpoint text, user_id text, p256dh text, auth text)
language sql security definer set search_path = public stable as $$
  select s.endpoint, s.account, s.p256dh, s.auth from public.push_subs s where s.account = any(p_users);
$$;
create or replace function public.drop_sub(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint;
$$;
create or replace function public.mark_sub_ok(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  update public.push_subs set last_ok = now() where endpoint = p_endpoint;
$$;

revoke execute on function public.todo_secret(text), public.todo_init_secret(text, text), public.claim_due_reminders(),
  public.subs_for(text[]), public.drop_sub(text), public.mark_sub_ok(text) from public, anon, authenticated;
grant execute on function public.todo_secret(text), public.todo_init_secret(text, text), public.claim_due_reminders(),
  public.subs_for(text[]), public.drop_sub(text), public.mark_sub_ok(text) to service_role;

-- Les listes abandonnées (aucun appareil depuis un an) sont effacées par le ménage quotidien (cron.sql).
