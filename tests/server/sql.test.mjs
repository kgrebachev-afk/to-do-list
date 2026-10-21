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
ok('pas de double envoi', r.rows.length === 0);
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
await anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/abc', 'k', 'a', 'PC')`, [A]);
await anon(`select register_push($1, 'https://fcm.googleapis.com/fcm/send/abc', 'k2', 'a2', 'PC')`, [A]);
r = await svc(`select * from subs_for(array[$1]::text[])`, [hash(A)]);
ok('abonnement unique par appareil, mis à jour', r.rows.length === 1 && r.rows[0].p256dh === 'k2' && r.rows[0].user_id === hash(A), r.rows);
for (const ep of ['javascript:alert(1)', 'https://evil.example/hook', 'https://fcm.googleapis.com.evil.example/x']) {
  e = await rejects(() => anon(`select register_push($1, $2, 'k', 'a', 'x')`, [A, ep]));
  ok(`adresse refusée : ${ep}`, !!e);
}
for (const ep of ['https://web.push.apple.com/QW1', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://updates.push.services.mozilla.com/wpush/v2/x']) await anon(`select register_push($1, $2, 'k', 'a', 'x')`, [A, ep]);
for (let i = 0; i < 12; i++) await anon(`select register_push($1, $2, 'k', 'a', 'x')`, [A, 'https://fcm.googleapis.com/fcm/send/n' + i]);
r = await svc(`select count(*)::int n from push_subs where account = $1`, [hash(A)]);
ok('10 appareils au plus par compte', r.rows[0].n === 10, r.rows);
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

// --- suppression du compte (changement de code)
await anon(`select delete_account($1)`, [A]);
r = await svc(`select (select count(*) from items where account = $1)::int + (select count(*) from reminders where account = $1)::int + (select count(*) from push_subs where account = $1)::int + (select count(*) from accounts where id = $1)::int n`, [hash(A)]);
ok('delete_account efface tout pour A', r.rows[0].n === 0, r.rows);
e = await rejects(() => anon(`select push_items($1, $2::jsonb)`, [A, JSON.stringify([{ id: 'apres', updated_at: 1, data: 'x' }])]));
ok('après suppression : l\'ancien code ne peut plus rien envoyer', !!e && /compte inconnu/.test(e.message), e && e.message);
r = await anon(`select count(*)::int n from pull_items($1)`, [B]);
ok('le compte B est intact', r.rows[0].n === 1);

console.log(fails ? `${fails} ÉCHEC(S)` : 'tout est OK');
process.exit(fails ? 1 : 0);
