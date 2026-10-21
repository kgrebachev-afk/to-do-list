// Tests de la base (schéma v2, comptes par clé d'accès) avec PGlite.
// Lancer : copier dans un dossier où @electric-sql/pglite est installé, avec SCHEMA=chemin/vers/schema.sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

process.on('unhandledRejection', (e) => { console.log('ERREUR ' + e.message); process.exit(1); });
let fails = 0;
const ok = (n, c, i = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' — ' + JSON.stringify(i))); };
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
`);
const schema = readFileSync(process.env.SCHEMA || new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
await db.exec(schema);
// défauts de Supabase : la clé de service a accès à tout
await db.exec(`grant usage on schema private to service_role; grant all on all tables in schema private to service_role; grant all on all tables in schema public to service_role;`);
// réexécution : le script doit être rejouable sans erreur
await db.exec(schema);
ok('schéma réexécutable', true);

const as = async (role, sql, params) => { await db.exec(`reset role; set role ${role};`); try { return await db.query(sql, params); } finally { await db.exec('reset role;'); } };
const anon = (sql, params) => as('anon', sql, params);
const svc = (sql, params) => as('service_role', sql, params);
const key = () => randomBytes(32).toString('hex');
const hash = (k) => createHash('sha256').update(k, 'utf8').digest('hex');
const A = key(), B = key();

// --- comptes
await anon(`select create_account($1)`, [A]);
await anon(`select create_account($1)`, [A]); // idempotent
await anon(`select create_account($1)`, [B]);
let r = await svc(`select id from accounts order by created_at`);
ok('compte créé, identifié par l\'empreinte de la clé (jamais la clé)', r.rows.some((x) => x.id === hash(A)) && !r.rows.some((x) => x.id === A), r.rows);
ok('création idempotente', r.rows.length === 2, r.rows.length);
let e = await rejects(() => anon(`select create_account('pas-une-cle')`));
ok('clé mal formée refusée', !!e && /clé invalide/.test(e.message), e && e.message);
e = await rejects(() => anon(`select * from pull_items($1)`, [key()]));
ok('clé inconnue : « compte inconnu »', !!e && /compte inconnu/.test(e.message), e && e.message);

// --- accès direct aux tables interdit
for (const t of ['accounts', 'items', 'reminders', 'push_subs']) {
  e = await rejects(() => anon(`select * from ${t}`));
  ok(`anonyme : lecture directe de ${t} interdite`, !!e);
}
e = await rejects(() => anon(`insert into items (account, id, updated_at) values ($1, 'x', 1)`, [hash(A)]));
ok('anonyme : écriture directe interdite', !!e);
e = await rejects(() => anon(`select private.key_hash($1)`, [A]));
ok('fonctions internes inaccessibles', !!e);

// --- envoi / lecture
r = await anon(`select push_items($1, $2::jsonb) res`, [A, JSON.stringify([{ id: 't1', updated_at: 100, data: 'c1' }, { id: 't2', updated_at: 100, data: 'c2' }])]);
ok('push_items : aucun refus', JSON.stringify(r.rows[0].res.rejected) === '[]', r.rows);
r = await anon(`select * from pull_items($1)`, [A]);
ok('pull_items : tout relire', r.rows.map((x) => x.id).join() === 't1,t2', r.rows);
r = await anon(`select push_items($1, $2::jsonb) res`, [A, JSON.stringify([{ id: 't1', updated_at: 50, data: 'vieux' }])]);
ok('version plus ancienne refusée et signalée', JSON.stringify(r.rows[0].res.rejected) === '["t1"]', r.rows);
r = await anon(`select data from get_items($1, $2)`, [A, ['t1']]);
ok('get_items : le serveur garde la plus récente', r.rows[0].data === 'c1', r.rows);
await anon(`select push_items($1, $2::jsonb)`, [A, JSON.stringify([{ id: 't1', updated_at: 200, data: 'neuf' }, { id: 't2', updated_at: 300, deleted: true, data: null }])]);
r = await anon(`select id, data, deleted from pull_items($1)`, [A]);
ok('version récente et suppression appliquées', JSON.stringify(r.rows) === JSON.stringify([{ id: 't1', data: 'neuf', deleted: false }, { id: 't2', data: null, deleted: true }]), r.rows);
r = await anon(`select * from pull_items($1)`, [B]);
ok('B ne voit pas les tâches de A', r.rows.length === 0);
await anon(`select push_items($1, $2::jsonb)`, [B, JSON.stringify([{ id: 't1', updated_at: 999, data: 'autre compte' }])]);
r = await anon(`select data from get_items($1, $2)`, [A, ['t1']]);
ok('même identifiant de tâche chez B : aucun effet sur A', r.rows[0].data === 'neuf', r.rows);

// --- pages : 1 200 éléments, lecture par curseur (date serveur, identifiant)
const rows = Array.from({ length: 1200 }, (_, i) => ({ id: 'n' + String(i).padStart(4, '0'), updated_at: 1, data: 'x' }));
for (let i = 0; i < rows.length; i += 500) await anon(`select push_items($1, $2::jsonb)`, [A, JSON.stringify(rows.slice(i, i + 500))]);
let seen = new Set(), since = null, after = '', pages = 0;
for (;;) {
  const p = since ? await anon(`select id, modified_at from pull_items($1, $2, $3)`, [A, since, after]) : await anon(`select id, modified_at from pull_items($1)`, [A]);
  pages++;
  for (const x of p.rows) seen.add(x.id);
  if (p.rows.length < 500) break;
  const last = p.rows[p.rows.length - 1]; since = last.modified_at; after = last.id;
}
ok('pagination : 1 202 éléments en 3 pages', seen.size === 1202 && pages === 3, [seen.size, pages]);
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [A, JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ id: 'z' + i, updated_at: 1, data: 'x' })))]));
ok('plus de 500 éléments par envoi refusé', !!e);

// --- rappels
const F1 = Date.now() - 60000;
await anon(`select set_reminders($1, $2::jsonb)`, [A, JSON.stringify([{ task_id: 't1', fire_at: F1, payload: 'p1' }, { task_id: 't3', fire_at: Date.now() + 3600000, payload: 'p3' }])]);
r = await svc(`select task_id from reminders order by task_id`);
ok('set_reminders enregistre', r.rows.map((x) => x.task_id).join() === 't1,t3', r.rows);
r = await svc(`select * from claim_due_reminders()`);
ok('claim_due_reminders : seul le rappel échu, avec le compte', r.rows.length === 1 && r.rows[0].task_id === 't1' && r.rows[0].user_id === hash(A) && r.rows[0].fresh === true, r.rows);
r = await svc(`select * from claim_due_reminders()`);
ok('pas de double envoi (réservé 5 minutes)', r.rows.length === 0);
await svc(`select mark_sent(array[$1], array['t1'])`, [hash(A)]);
await anon(`select set_reminders($1, $2::jsonb)`, [A, JSON.stringify([{ task_id: 't1', fire_at: F1, payload: 'p1b' }, { task_id: 't3', fire_at: Date.now() + 3600000, payload: 'p3' }])]);
r = await svc(`select task_id, sent_at is not null sent from reminders order by task_id`);
ok('heure inchangée : statut « envoyé » conservé', r.rows[0].sent === true, r.rows);
await anon(`select set_reminders($1, $2::jsonb)`, [A, JSON.stringify([{ task_id: 't3', fire_at: Date.now() + 7200000, payload: 'p3c' }])]);
r = await svc(`select task_id, sent_at from reminders order by task_id`);
ok('rappel retiré supprimé, heure changée remise à envoyer', r.rows.length === 1 && r.rows[0].task_id === 't3' && r.rows[0].sent_at === null, r.rows);
await anon(`select set_reminders($1, $2::jsonb)`, [B, '[]']);
r = await svc(`select count(*)::int n from reminders where account = $1`, [hash(A)]);
ok('set_reminders de B ne touche pas A', r.rows[0].n === 1);
e = await rejects(() => anon(`select set_reminders($1, $2::jsonb)`, [A, JSON.stringify([{ task_id: 'big', fire_at: Date.now(), payload: 'x'.repeat(3000) }])]));
ok('rappel trop volumineux refusé', !!e);

// --- abonnements
const P1 = 'B' + 'A'.repeat(86), P2 = 'B' + 'C'.repeat(86), AU1 = 'A'.repeat(22), AU2 = 'D'.repeat(22);
await anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/abc', $2, $3, 'PC')`, [A, P1, AU1]);
await anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/abc', $2, $3, 'PC')`, [A, P2, AU1]);
r = await svc(`select * from subs_for(array[$1]::text[])`, [hash(A)]);
ok('abonnement unique par appareil, mis à jour', r.rows.length === 1 && r.rows[0].p256dh === P2 && r.rows[0].user_id === hash(A), r.rows);
for (const ep of ['javascript:alert(1)', 'https://evil.example/hook', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com@evil.example/x', 'https://fcm.googleapis.com/x\r\nHost: evil']) {
  e = await rejects(() => anon(`select register_push($1, $2, $3, $4, 'x')`, [A, ep, P1, AU1]));
  ok(`adresse refusée : ${JSON.stringify(ep)}`, !!e);
}
for (const [k, au] of [['k', AU1], [P1, 'a'], [P1 + 'xx', AU1], [null, AU1]]) {
  e = await rejects(() => anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/kk', $2, $3, 'x')`, [A, k, au]));
  ok(`clés d'abonnement mal formées refusées (${String(k).slice(0, 6)}…/${String(au).slice(0, 4)}…)`, !!e && /abonnement invalide/.test(e.message), e && e.message);
}
for (const ep of ['https://web.push.apple.com/QW1', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://updates.push.services.mozilla.com/wpush/v2/x']) await anon(`select register_push($1, $2, $3, $4, 'x')`, [A, ep, P1, AU1]);
for (let i = 0; i < 12; i++) await anon(`select register_push($1, $2, $3, $4, 'x')`, [A, 'https://fcm.googleapis.com/fcm/send/n' + i, P1, AU1]);
r = await svc(`select count(*)::int n from push_subs where account = $1`, [hash(A)]);
ok('6 appareils au plus par compte', r.rows[0].n === 6, r.rows);
await anon(`select unregister_push($1, 'https://fcm.googleapis.com/fcm/send/n11')`, [B]);
r = await svc(`select count(*)::int n from push_subs where endpoint = 'https://fcm.googleapis.com/fcm/send/n11'`);
ok('B ne peut pas désabonner un appareil de A', r.rows[0].n === 1);

// --- fonctions de service
for (const f of [`select * from claim_due_reminders()`, `select todo_secret('cron')`, `select * from subs_for(array['x'])`, `select drop_sub('x')`]) {
  e = await rejects(() => anon(f));
  ok(`réservé au serveur : ${f.slice(7, 40)}`, !!e);
}
e = await rejects(() => anon(`select * from private.secrets`));
ok('schéma privé inaccessible', !!e);
await svc(`select todo_init_secret('vapid', '{"publicKey":"PUB","privateKey":"PRIV"}')`);
r = await svc(`select todo_init_secret('vapid', '{"publicKey":"X","privateKey":"Y"}') v`);
ok('clés de notification créées une seule fois', JSON.parse(r.rows[0].v).publicKey === 'PUB');
r = await anon(`select vapid_public_key() k`);
ok('clé publique lisible, pas la privée', r.rows[0].k === 'PUB');

// --- description d'une liste (confirmation avant de la rejoindre)
await anon(`select push_items($1, $2::jsonb)`, [B, JSON.stringify([{ id: '__settings', updated_at: 5, data: 'r' }, { id: 'gone', updated_at: 5, deleted: true, data: 'tomb' }])]);
r = await anon(`select account_info($1) i`, [B]);
ok('account_info : tâches (hors réglages et suppressions), appareils, date', r.rows[0].i.tasks === 1 && r.rows[0].i.devices === 0 && !!r.rows[0].i.created_at, r.rows[0].i);
e = await rejects(() => anon(`select account_info($1)`, [key()]));
ok('account_info : code inconnu refusé', !!e && /compte inconnu/.test(e.message), e && e.message);

// --- dates venues du futur et volumes
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [B, JSON.stringify([{ id: 'futur', updated_at: Date.now() + 2 * 86400000, data: 'x' }])]));
ok('date de modification à plus d\'un jour dans le futur refusée', !!e && /horloge/.test(e.message), e && e.message);
await anon(`select push_items($1, $2::jsonb)`, [B, JSON.stringify([{ id: 'presque', updated_at: Date.now() + 3600000, data: 'x' }])]);
ok('… une heure d\'avance reste acceptée', true);
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [B, JSON.stringify([{ id: 'enorme', updated_at: 1, data: 'x'.repeat(200001) }])]));
ok('élément de plus de 200 000 caractères refusé', !!e);
const Q = key(); await anon(`select create_account($1)`, [Q]);
const big = 'y'.repeat(199000);
let stored = 0; e = null;
for (let i = 0; i < 80 && !e; i += 10) {
  e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [Q, JSON.stringify(Array.from({ length: 10 }, (_, j) => ({ id: 'q' + (i + j), updated_at: 1, data: big })))]));
  if (!e) stored += 10;
}
ok('quota de stockage (10 Mo par liste) : envoi refusé au-delà', !!e && /limite de stockage/.test(e.message) && stored === 50, [stored, e && e.message]);
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [Q, JSON.stringify(Array.from({ length: 10 }, (_, j) => ({ id: 'q' + j, updated_at: 2, data: big })))]));
ok('liste pleine : modifier des éléments existants reste possible (la taille remplacée est déduite)', !e, e && e.message);
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [key(), '[]']));
const astral = String.fromCodePoint(0x1F600).repeat(60000); // 60 000 caractères, 240 000 octets
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [B, JSON.stringify([{ id: 'emoji', updated_at: 1, data: astral }])]));
ok('taille comptée en octets (caractères de 4 octets) : élément trop gros refusé', !!e, e && e.message);
for (const bad of [[1], [{ id: 5, updated_at: 1, data: 'x' }], [{ id: 'x', updated_at: '1', data: 'x' }], [{ id: 'x', updated_at: 1, data: { a: 1 } }]]) {
  e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [B, JSON.stringify(bad)]));
  ok(`élément mal formé refusé : ${JSON.stringify(bad)}`, !!e);
}
e = await rejects(() => anon(`select * from get_items($1, $2::text[])`, [B, '{{' + Array.from({ length: 600 }, (_, i) => 'i' + i).join(',') + '}}']));
ok('get_items : 500 identifiants au plus, même en tableau à 2 dimensions', !!e, e && e.message);
await anon(`select delete_account($1)`, [Q]);

// --- abonnement d'un appareil : pas de détournement par un autre compte
const KA = 'B' + 'a'.repeat(86), KB = 'B' + 'b'.repeat(86), KA2 = 'B' + 'c'.repeat(86), AA = 'a'.repeat(22), AB = 'b'.repeat(22);
await anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/vole', $2, $3, 'A')`, [A, KA, AA]);
await anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/vole', $2, $3, 'B')`, [B, KB, AB]);
r = await svc(`select account, p256dh from push_subs where endpoint = 'https://fcm.googleapis.com/fcm/send/vole'`);
ok('adresse d\'un appareil de A annoncée par B (autres clés) : ignorée', r.rows[0].account === hash(A) && r.rows[0].p256dh === KA, r.rows);
await anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/vole', $2, $3, 'A')`, [B, KA2, AA]);
r = await svc(`select account from push_subs where endpoint = 'https://fcm.googleapis.com/fcm/send/vole'`);
ok('… le même appareil (mêmes clés) peut passer sur le nouveau code', r.rows[0].account === hash(B), r.rows);

// --- créations en masse depuis une même adresse
await db.exec(`select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}', false)`);
let made = 0, lastErr = null;
for (let i = 0; i < 31; i++) { try { await anon(`select create_account($1)`, [key()]); made++; } catch (err) { lastErr = err; } }
ok('30 créations par heure et par adresse, puis refus', made === 30 && /trop de créations/.test(lastErr && lastErr.message), [made, lastErr && lastErr.message]);
await db.exec(`select set_config('request.headers', '{"x-forwarded-for":"1.2.3.4, 10.0.0.1"}', false)`);
e = await rejects(() => anon(`select create_account($1)`, [key()]));
ok('… première adresse de X-Forwarded-For falsifiée : sans effet (c\'est la dernière qui compte)', !!e && /trop de créations/.test(e.message), e && e.message);
await db.exec(`select set_config('request.headers', '{"x-forwarded-for":"10.0.0.1","cf-connecting-ip":"198.51.100.7"}', false)`);
await anon(`select create_account($1)`, [key()]);
ok('… une autre adresse réelle (cf-connecting-ip) n\'est pas bloquée', true);
await db.exec(`select set_config('request.headers', '{"cf-connecting-ip":"2001:db8:1:2:aaaa::1"}', false)`);
await anon(`select create_account($1)`, [key()]);
r = await svc(`select ip from private.creations order by at desc limit 1`);
ok('IPv6 regroupée par /64', r.rows[0].ip === '2001:db8:1:2::/64', r.rows);
await db.exec(`select set_config('request.headers', '', false)`);

// --- suppression du compte (changement de code)
await anon(`select delete_account($1)`, [A]);
r = await svc(`select (select count(*) from items where account = $1)::int + (select count(*) from reminders where account = $1)::int + (select count(*) from push_subs where account = $1)::int + (select count(*) from accounts where id = $1)::int n`, [hash(A)]);
ok('delete_account efface tout pour A', r.rows[0].n === 0, r.rows);
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [A, JSON.stringify([{ id: 'apres', updated_at: 1, data: 'x' }])]));
ok('après suppression : l\'ancien code ne peut plus rien envoyer', !!e && /compte inconnu/.test(e.message), e && e.message);
r = await anon(`select count(*)::int n from pull_items($1)`, [B]);
ok('le compte B est intact', r.rows[0].n === 4, r.rows);
e = await rejects(() => anon(`select create_account($1)`, [A]));
ok('ancien code retiré : impossible de le recréer', !!e && /code retiré/.test(e.message), e && e.message);
r = await svc(`select count(*)::int n from retired_accounts`);
const nRet = r.rows[0].n;
for (let i = 0; i < 20; i++) await anon(`select delete_account($1)`, [key()]);
r = await svc(`select count(*)::int n from retired_accounts`);
ok('delete_account d\'une liste inexistante : rien n\'est stocké (pas de remplissage anonyme)', r.rows[0].n === nRet, [nRet, r.rows[0].n]);
await anon(`select delete_account($1)`, [A]);
ok('retirer deux fois : sans erreur', true);

// --- QR code à usage unique
const C = key(), D = key(); await anon(`select create_account($1)`, [C]); await anon(`select create_account($1)`, [D]);
const pid = randomBytes(32).toString('hex');
await anon(`select pair_offer($1, $2, 'v1.iv.ct')`, [C, pid]);
r = await anon(`select pair_status($1, $2) s`, [C, pid]);
ok('QR code : en attente', r.rows[0].s.state === 'pending', r.rows);
r = await anon(`select pair_status($1, $2) s`, [D, pid]);
ok('QR code : état invisible pour une autre liste', r.rows[0].s.state === 'expired', r.rows);
r = await anon(`select pair_take($1) b`, [pid]);
ok('QR code : retiré une fois (sans clé de liste)', r.rows[0].b === 'v1.iv.ct', r.rows);
r = await anon(`select pair_take($1) b`, [pid]);
ok('QR code : seconde utilisation refusée', r.rows[0].b === null, r.rows);
r = await anon(`select pair_status($1, $2) s`, [C, pid]);
ok('QR code : « utilisé », avec l\'heure', r.rows[0].s.state === 'used' && !!r.rows[0].s.at, r.rows);
r = await svc(`select blob from pairings where id = $1`, [pid]);
ok('QR code utilisé : contenu effacé du serveur', r.rows[0].blob === null, r.rows);
const pid2 = randomBytes(32).toString('hex');
await anon(`select pair_offer($1, $2, 'v1.x.y')`, [C, pid2]);
await svc(`update pairings set expires_at = now() - interval '1 second' where id = $1`, [pid2]);
r = await anon(`select pair_take($1) b`, [pid2]);
ok('QR code expiré : refusé', r.rows[0].b === null, r.rows);
const ids8 = Array.from({ length: 8 }, () => randomBytes(32).toString('hex'));
for (const i of ids8) await anon(`select pair_offer($1, $2, 'v1.x.y')`, [C, i]);
r = await svc(`select id from pairings where account = $1 and taken_at is null`, [hash(C)]);
ok('un seul QR code valide à la fois (le nouveau annule le précédent)', r.rows.length === 1 && r.rows[0].id === ids8[7], r.rows);
await anon(`select pair_cancel($1, $2)`, [D, ids8[7]]);
r = await anon(`select pair_take($1) b`, [ids8[7]]);
ok('annulation par une autre liste : sans effet', r.rows[0].b === 'v1.x.y', r.rows);
const pid3 = randomBytes(32).toString('hex');
await anon(`select pair_offer($1, $2, 'v1.z.z')`, [C, pid3]);
await anon(`select pair_cancel($1, $2)`, [C, pid3]);
r = await anon(`select pair_take($1) b`, [pid3]);
ok('QR code annulé (fenêtre fermée) : inutilisable', r.rows[0].b === null, r.rows);
e = await rejects(() => anon(`select pair_offer($1, $2, $3)`, [C, randomBytes(32).toString('hex'), 'x'.repeat(401)]));
ok('QR code : contenu trop gros refusé', !!e);
e = await rejects(() => anon(`select pair_take('nimporte')`));
ok('QR code : identifiant mal formé refusé', !!e);

// --- rappels : un compte ne peut pas accaparer l'envoi ; rappels passés non réarmables
await svc(`delete from reminders`);
const V = key(), X = key(); await anon(`select create_account($1)`, [V]); await anon(`select create_account($1)`, [X]);
await anon(`select set_reminders($1, $2::jsonb)`, [V, JSON.stringify([{ task_id: 'v1', fire_at: Date.now() - 30000, payload: 'p' }])]);
const flood = (base) => JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ task_id: 'x' + i, fire_at: base + i, payload: 'p' })));
await anon(`select set_reminders($1, $2::jsonb)`, [X, flood(Date.now() - 60000)]);
r = await svc(`select * from claim_due_reminders()`);
ok('300 rappels échus d\'un compte : celui de la victime part quand même', r.rows.some((x) => x.task_id === 'v1') && r.rows.filter((x) => x.user_id === hash(X)).length === 20, r.rows.length);
await svc(`delete from reminders`);
await anon(`select set_reminders($1, $2::jsonb)`, [X, flood(1000)]);
r = await svc(`select count(*)::int n from reminders where account = $1 and sent_at is null`, [hash(X)]);
ok('rappels datés de 1970 : enregistrés comme déjà passés (jamais envoyés)', r.rows[0].n === 0, r.rows);
e = await rejects(() => anon(`select set_reminders($1, $2::jsonb)`, [X, JSON.stringify(Array.from({ length: 301 }, (_, i) => ({ task_id: 'y' + i, fire_at: Date.now() + 9e5, payload: 'p' })))]));
ok('301 rappels : refusés', !!e);
for (const bad of [[{ task_id: 'a', fire_at: '-Infinity', payload: 'p' }], [{ task_id: 'a', fire_at: 1e300, payload: 'p' }], [{ task_id: 1, fire_at: 1, payload: 'p' }], ['x']]) {
  e = await rejects(() => anon(`select set_reminders($1, $2::jsonb)`, [X, JSON.stringify(bad)]));
  ok(`rappel mal formé refusé : ${JSON.stringify(bad)}`, !!e);
}
// réservation reprise si la fonction d'envoi s'interrompt
await svc(`delete from reminders`);
await anon(`select set_reminders($1, $2::jsonb)`, [V, JSON.stringify([{ task_id: 'v2', fire_at: Date.now() - 1000, payload: 'p' }])]);
r = await svc(`select * from claim_due_reminders()`);
await svc(`update reminders set claimed_at = now() - interval '6 minutes'`);
r = await svc(`select * from claim_due_reminders()`);
ok('rappel réservé mais jamais marqué envoyé : repris 5 minutes après', r.rows.length === 1 && r.rows[0].task_id === 'v2', r.rows);
await svc(`select mark_sent(array[$1], array['v2'])`, [hash(V)]);
await svc(`update reminders set claimed_at = now() - interval '6 minutes'`);
r = await svc(`select * from claim_due_reminders()`);
ok('… et plus jamais une fois marqué envoyé', r.rows.length === 0, r.rows);
for (const f of [`select mark_sent(array['a'], array['b'])`, `select mark_subs_ok(array['x'])`, `select release_claims(array['a'], array['b'])`]) {
  e = await rejects(() => anon(f));
  ok(`réservé au serveur : ${f.slice(7, 30)}`, !!e);
}
// futurs objets du schéma public : fermés à l'API par défaut
await db.exec(`create table public.futur (x int);`);
e = await rejects(() => anon(`select * from public.futur`));
ok('nouvelle table du schéma public : inaccessible à l\'API par défaut', !!e, e && e.message);
await db.exec(`drop table public.futur;`);
// rappel réservé puis rendu (limite d'envois par passage) : repris tout de suite
await svc(`delete from reminders`);
await anon(`select set_reminders($1, $2::jsonb)`, [V, JSON.stringify([{ task_id: 'v3', fire_at: Date.now() - 1000, payload: 'p' }])]);
await svc(`select * from claim_due_reminders()`);
await svc(`select release_claims(array[$1], array['v3'])`, [hash(V)]);
r = await svc(`select * from claim_due_reminders()`);
ok('rappel rendu : repris à l\'exécution suivante', r.rows.length === 1 && r.rows[0].task_id === 'v3', r.rows);

console.log(fails ? `${fails} ÉCHEC(S)` : 'tout est OK');
process.exit(fails ? 1 : 0);
