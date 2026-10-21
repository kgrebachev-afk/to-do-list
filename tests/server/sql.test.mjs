import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERREUR ' + e.message); process.exit(1); });
const ok = (n, c, i='') => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' — ' + JSON.stringify(i)));
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`);
await db.exec(readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(`grant all on all tables in schema public to service_role; grant usage on schema private to service_role; grant all on all tables in schema private to service_role;`);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);
const as = async (uid, sql, params) => {
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
};
const asRole = async (role, sql, params) => { await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','',false);`); try { return await db.query(sql, params); } finally { await db.exec('reset role;'); } };

// vault
await as(A, `insert into vault (salt, verifier) values ('s','v')`);
let r = await as(B, `select * from vault`); ok('RLS : B ne voit pas le coffre de A', r.rows.length === 0);
// push_items + LWW
r = await as(A, `select push_items($1::jsonb, 's') n`, [JSON.stringify([{ id: 't1', updated_at: 100, data: 'c1' }, { id: 't2', updated_at: 100, data: 'c2' }])]);
r = await as(A, `select count(*)::int n from items`); ok('push_items insère', r.rows[0].n === 2, r.rows);
r = await as(A, `select push_items($1::jsonb, 's') n`, [JSON.stringify([{ id: 't1', updated_at: 50, data: 'vieux' }])]);
ok('version plus ancienne ignorée et signalée comme refusée', JSON.stringify(r.rows[0].n.rejected) === '["t1"]', r.rows);
r = await as(A, `select data from items where id='t1'`); ok('… le serveur garde la plus récente', r.rows[0].data === 'c1');
let errSalt = null; try { await as(A, `select push_items($1::jsonb, 'autre-sel')`, [JSON.stringify([{ id: 't9', updated_at: 999, data: 'x' }])]); } catch (e) { errSalt = e; }
ok('envoi refusé si le coffre a changé (ancienne clé)', !!errSalt && /coffre changé/.test(errSalt.message), errSalt && errSalt.message);
r = await as(A, `select push_items($1::jsonb, 's') n`, [JSON.stringify([{ id: 't1', updated_at: 200, data: 'neuf' }, { id: 't2', updated_at: 300, deleted: true, data: null }])]);
ok('envoi accepté : aucun refus', JSON.stringify(r.rows[0].n.rejected) === '[]', r.rows);
r = await as(A, `select id, data, deleted from items order by id`);
ok('version plus récente et suppression appliquées', JSON.stringify(r.rows) === JSON.stringify([{ id: 't1', data: 'neuf', deleted: false }, { id: 't2', data: null, deleted: true }]), r.rows);
r = await as(B, `select * from items`); ok('RLS : B ne voit pas les tâches de A', r.rows.length === 0);
await as(B, `insert into vault (salt, verifier) values ('sb','v')`);
r = await as(B, `select push_items($1::jsonb, 'sb') n`, [JSON.stringify([{ id: 't1', updated_at: 999, data: 'pirate' }])]);
r = await as(A, `select data from items where id='t1'`); ok('B ne peut pas écraser la tâche de A (même id)', r.rows[0].data === 'neuf', r.rows);
let err = null; try { await as(B, `update items set data='x' where user_id='${A}'`); } catch (e) { err = e; }
r = await as(A, `select data from items where id='t1'`); ok('B ne peut pas modifier les lignes de A', r.rows[0].data === 'neuf');
err = null; try { await asRole('anon', `select * from items`); } catch (e) { err = e; } ok('anonyme : aucun accès', !!err);
// reminders
const F1 = Date.now() - 60000;
await as(A, `select set_reminders($1::jsonb, 's')`, [JSON.stringify([{ task_id: 't1', fire_at: F1, payload: 'p1' }, { task_id: 't3', fire_at: Date.now() + 3600000, payload: 'p3' }])]);
r = await as(A, `select task_id from reminders order by task_id`); ok('set_reminders enregistre', r.rows.map(x => x.task_id).join() === 't1,t3', r.rows);
r = await asRole('service_role', `select * from claim_due_reminders()`); ok('claim_due_reminders : seul le rappel échu', r.rows.length === 1 && r.rows[0].task_id === 't1' && r.rows[0].fresh === true, r.rows);
r = await asRole('service_role', `select * from claim_due_reminders()`); ok('pas de double envoi', r.rows.length === 0);
const t3 = (await as(A, `select fire_at from reminders where task_id='t3'`)).rows[0].fire_at;
await as(A, `select set_reminders($1::jsonb, 's')`, [JSON.stringify([{ task_id: 't1', fire_at: F1, payload: 'p1b' }, { task_id: 't3', fire_at: new Date(t3).getTime(), payload: 'p3b' }])]);
r = await as(A, `select task_id, sent_at is not null sent from reminders order by task_id`);
ok('heure inchangée : statut « envoyé » conservé', r.rows[0].sent === true, r.rows);
await as(A, `select set_reminders($1::jsonb, 's')`, [JSON.stringify([{ task_id: 't3', fire_at: Date.now() + 7200000, payload: 'p3c' }])]);
let errW = null; try { await as(A, `insert into reminders (task_id, fire_at, payload) values ('x', now(), 'p')`); } catch (e) { errW = e; }
ok('rappels : écriture directe interdite (seulement par set_reminders)', !!errW);
let errBig = null; try { await as(A, `select set_reminders($1::jsonb, 's')`, [JSON.stringify([{ task_id: 'big', fire_at: Date.now(), payload: 'x'.repeat(3000) }])]); } catch (e) { errBig = e; }
ok('rappel trop volumineux refusé', !!errBig);
r = await as(A, `select task_id, sent_at from reminders order by task_id`); ok('rappels retirés supprimés, heure changée remise à envoyer', r.rows.length === 1 && r.rows[0].task_id === 't3' && r.rows[0].sent_at === null, r.rows);
await as(B, `select set_reminders($1::jsonb, 'sb')`, [JSON.stringify([])]);
r = await as(A, `select count(*)::int n from reminders`); ok('set_reminders de B ne touche pas A', r.rows[0].n === 1);
// push subs
await as(A, `select register_push('https://fcm.googleapis.com/fcm/send/abc','k','a','PC')`);
await as(A, `select register_push('https://fcm.googleapis.com/fcm/send/abc','k2','a2','PC')`);
r = await asRole('service_role', `select * from subs_for(array['${A}']::uuid[])`); ok('abonnement unique par appareil, mis à jour', r.rows.length === 1 && r.rows[0].p256dh === 'k2');
err = null; try { await as(A, `select register_push('javascript:alert(1)','k','a','x')`); } catch (e) { err = e; } ok('adresse d\'abonnement non https refusée', !!err);
err = null; try { await as(A, `select register_push('https://evil.example/hook','k','a','x')`); } catch (e) { err = e; } ok('service de notification inconnu refusé (pas d\'envoi vers une adresse arbitraire)', !!err);
err = null; try { await as(A, `select register_push('https://fcm.googleapis.com.evil.example/x','k','a','x')`); } catch (e) { err = e; } ok('domaine imitant un service connu refusé', !!err);
for (const ep of ['https://web.push.apple.com/QW1', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://updates.push.services.mozilla.com/wpush/v2/x']) await as(A, `select register_push($1,'k','a','x')`, [ep]);
for (let i = 0; i < 12; i++) await as(A, `select register_push($1,'k','a','x')`, ['https://fcm.googleapis.com/fcm/send/n' + i]);
r = await asRole('service_role', `select count(*)::int n from push_subs where user_id='${A}'`); ok('10 appareils au plus par compte', r.rows[0].n === 10, r.rows);
err = null; try { await as(A, `select * from claim_due_reminders()`); } catch (e) { err = e; } ok('fonctions de service interdites aux utilisateurs', !!err);
err = null; try { await as(A, `select todo_secret('cron')`); } catch (e) { err = e; } ok('secrets inaccessibles aux utilisateurs', !!err);
err = null; try { await as(A, `select * from private.secrets`); } catch (e) { err = e; } ok('schéma privé inaccessible', !!err);
// vapid
await asRole('service_role', `select todo_init_secret('vapid', '{"publicKey":"PUB","privateKey":"PRIV"}')`);
r = await asRole('service_role', `select todo_init_secret('vapid', '{"publicKey":"X","privateKey":"Y"}') v`); ok('clés créées une seule fois', JSON.parse(r.rows[0].v).publicKey === 'PUB');
r = await as(A, `select vapid_public_key() k`); ok('clé publique lisible, pas la privée', r.rows[0].k === 'PUB');
// reset
await as(A, `select reset_cloud()`);
r = await asRole('service_role', `select (select count(*) from items where user_id='${A}')::int + (select count(*) from vault where user_id='${A}')::int n`); ok('reset_cloud efface tout pour A', r.rows[0].n === 0);
