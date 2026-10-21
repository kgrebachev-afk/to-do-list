-- =====================================================================
-- To do list : synchronisation chiffrée de bout en bout + rappels push
-- À coller tel quel dans Supabase : SQL Editor > New query > Run.
-- Le serveur ne stocke que du contenu chiffré sur l'appareil : il ne peut
-- lire ni les tâches, ni les notes, ni le texte des rappels.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Secrets internes (clés d'envoi des notifications, jeton du cron) : jamais exposés à l'API.
create table if not exists private.secrets (
  name  text primary key,
  value text not null
);

-- Une ligne par utilisateur : de quoi vérifier la phrase secrète (sans la connaître).
create table if not exists public.vault (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  salt       text not null,
  verifier   text not null,
  iterations integer not null default 310000,
  created_at timestamptz not null default now()
);

-- Les tâches (et les réglages), chiffrées. updated_at : horloge de l'appareil, pour la fusion.
-- modified_at : horloge du serveur, pour ne télécharger que ce qui a changé.
create table if not exists public.items (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id          text not null check (length(id) between 1 and 80),
  updated_at  bigint not null,
  deleted     boolean not null default false,
  data        text check (data is null or length(data) < 300000),
  modified_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
create index if not exists items_user_modified on public.items (user_id, modified_at);

-- Abonnements aux notifications (un par appareil).
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  label      text,
  created_at timestamptz not null default now(),
  last_ok    timestamptz
);
create index if not exists push_subs_user on public.push_subs (user_id);

-- Prochains rappels à envoyer. payload : titre du rappel, chiffré.
create table if not exists public.reminders (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id  text not null,
  fire_at  timestamptz not null,
  payload  text not null check (length(payload) < 3000),
  sent_at  timestamptz,
  primary key (user_id, task_id)
);
create index if not exists reminders_due on public.reminders (fire_at) where sent_at is null;

-- ---------------------------------------------------------------------
-- Sécurité : chacun ne voit que ses propres lignes.
-- ---------------------------------------------------------------------
alter table public.vault     enable row level security;
alter table public.items     enable row level security;
alter table public.push_subs enable row level security;
alter table public.reminders enable row level security;

drop policy if exists own_vault on public.vault;
create policy own_vault on public.vault for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_items on public.items;
create policy own_items on public.items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_reminders on public.reminders;
create policy own_reminders on public.reminders for select to authenticated using (user_id = auth.uid());
drop policy if exists own_push on public.push_subs;
create policy own_push on public.push_subs for select to authenticated using (user_id = auth.uid());

revoke all on public.vault, public.items, public.push_subs, public.reminders from anon;
grant select, insert, update, delete on public.vault, public.items to authenticated;
grant select on public.reminders, public.push_subs to authenticated;

-- ---------------------------------------------------------------------
-- Fonctions appelées par l'application
-- ---------------------------------------------------------------------

-- Vérifie que l'appareil chiffre avec le coffre actuel (sinon ses données seraient illisibles pour les autres).
create or replace function public.check_vault(p_salt text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_salt is not null and not exists (select 1 from public.vault where user_id = auth.uid() and salt = p_salt) then
    raise exception 'coffre changé' using errcode = 'P0001';
  end if;
end $$;

-- Envoi de tâches : la version la plus récente (selon l'appareil) l'emporte. Renvoie les identifiants
-- refusés parce que le serveur a déjà plus récent : l'appareil les relit et fusionne.
drop function if exists public.push_items(jsonb);
create or replace function public.push_items(rows jsonb, p_salt text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare rej jsonb;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  perform public.check_vault(p_salt);
  if jsonb_array_length(rows) > 500 then raise exception 'trop d''éléments à la fois'; end if;
  if (select count(*) from public.items where user_id = auth.uid()) > 50000 then raise exception 'limite de stockage atteinte'; end if;
  insert into public.items (user_id, id, updated_at, deleted, data, modified_at)
  select auth.uid(), r->>'id', (r->>'updated_at')::bigint, coalesce((r->>'deleted')::boolean, false), r->>'data', clock_timestamp()
  from jsonb_array_elements(rows) r
  on conflict (user_id, id) do update
    set updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data, modified_at = clock_timestamp()
    where public.items.updated_at < excluded.updated_at;
  select coalesce(jsonb_agg(i.id), '[]'::jsonb) into rej
    from jsonb_array_elements(rows) r
    join public.items i on i.user_id = auth.uid() and i.id = r->>'id'
   where i.updated_at > (r->>'updated_at')::bigint
      or (i.updated_at = (r->>'updated_at')::bigint and i.data is distinct from r->>'data');
  return jsonb_build_object('rejected', rej);
end $$;

-- Remplace la liste des rappels à venir (calculée sur l'appareil).
drop function if exists public.set_reminders(jsonb);
create or replace function public.set_reminders(rows jsonb, p_salt text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if p_salt is not null and not exists (select 1 from public.vault where user_id = auth.uid() and salt = p_salt) then
    raise exception 'coffre changé' using errcode = 'P0001';
  end if;
  if jsonb_array_length(rows) > 500 then raise exception 'trop de rappels'; end if;
  if exists (select 1 from jsonb_array_elements(rows) r where length(r->>'payload') >= 3000 or length(r->>'task_id') > 80) then
    raise exception 'rappel trop volumineux';
  end if;
  delete from public.reminders
   where user_id = auth.uid()
     and task_id not in (select r->>'task_id' from jsonb_array_elements(rows) r);
  insert into public.reminders (user_id, task_id, fire_at, payload, sent_at)
  select auth.uid(), r->>'task_id', to_timestamp((r->>'fire_at')::double precision / 1000), r->>'payload', null
  from jsonb_array_elements(rows) r
  on conflict (user_id, task_id) do update
    set payload = excluded.payload,
        sent_at = case when public.reminders.fire_at = excluded.fire_at then public.reminders.sent_at else null end,
        fire_at = excluded.fire_at;
end $$;
-- les rappels ne s'écrivent que par set_reminders (limites contrôlées)
revoke insert, update, delete on public.reminders from authenticated;
drop policy if exists own_reminders_write on public.reminders;

-- Abonnement de l'appareil aux notifications.
create or replace function public.register_push(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if length(p_endpoint) > 1000 or p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com)/' then
    raise exception 'service de notification inconnu';
  end if;
  if length(p_p256dh) > 200 or length(p_auth) > 100 then raise exception 'abonnement invalide'; end if;
  insert into public.push_subs (endpoint, user_id, p256dh, auth, label)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_label, 80))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, created_at = now();
  -- 10 appareils au plus : les plus anciens sont retirés
  delete from public.push_subs where endpoint in (
    select endpoint from public.push_subs where user_id = auth.uid() order by created_at desc offset 10);
end $$;

create or replace function public.unregister_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Clé publique d'envoi des notifications (créée automatiquement par la fonction d'envoi).
create or replace function public.vapid_public_key()
returns text language sql security definer set search_path = public, private stable as $$
  select (value::jsonb)->>'publicKey' from private.secrets where name = 'vapid';
$$;

-- Phrase secrète oubliée : tout effacer côté serveur (les copies sur les appareils restent).
create or replace function public.reset_cloud()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  delete from public.items where user_id = auth.uid();
  delete from public.reminders where user_id = auth.uid();
  delete from public.push_subs where user_id = auth.uid();
  delete from public.vault where user_id = auth.uid();
end $$;

revoke execute on function public.push_items(jsonb, text), public.set_reminders(jsonb, text), public.check_vault(text), public.register_push(text, text, text, text),
  public.unregister_push(text), public.vapid_public_key(), public.reset_cloud() from public, anon;
grant execute on function public.push_items(jsonb, text), public.set_reminders(jsonb, text), public.check_vault(text), public.register_push(text, text, text, text),
  public.unregister_push(text), public.vapid_public_key(), public.reset_cloud() to authenticated;

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
create or replace function public.claim_due_reminders()
returns table (user_id uuid, task_id text, payload text, fire_at timestamptz, fresh boolean)
language sql security definer set search_path = public as $$
  update public.reminders r set sent_at = now()
   where (r.user_id, r.task_id) in (
     select q.user_id, q.task_id from public.reminders q
      where q.sent_at is null and q.fire_at <= now()
      order by q.fire_at limit 300 for update skip locked)
  returning r.user_id, r.task_id, r.payload, r.fire_at, (r.fire_at > now() - interval '12 hours') as fresh;
$$;
create or replace function public.subs_for(p_users uuid[])
returns setof public.push_subs language sql security definer set search_path = public stable as $$
  select * from public.push_subs where user_id = any(p_users);
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
  public.subs_for(uuid[]), public.drop_sub(text), public.mark_sub_ok(text) from public, anon, authenticated;
grant execute on function public.todo_secret(text), public.todo_init_secret(text, text), public.claim_due_reminders(),
  public.subs_for(uuid[]), public.drop_sub(text), public.mark_sub_ok(text) to service_role;
