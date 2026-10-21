// Test de la fonction d'envoi : faux PostgREST + faux service push HTTPS, déchiffrement du message reçu.
import { createECDH, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import ece from 'npm:http_ece@1.2.0';
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let fails = 0;
const check = (n: string, c: boolean, i: unknown = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' — ' + JSON.stringify(i))); };

// --- faux PostgREST
const CRON = 'a'.repeat(32) + 'b'.repeat(32);
const secrets: Record<string, string> = { cron: CRON };
let restCalls = 0;
const reminders = [
  { user_id: 'A', task_id: 't1', payload: 'CIPHERTEXT-1', fire_at: new Date(Date.now() - 30000).toISOString(), fresh: true },
  { user_id: 'A', task_id: 'old', payload: 'X', fire_at: new Date(Date.now() - 86400000).toISOString(), fresh: false },
];
let claimed = false;
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const authSecret = randomBytes(16);
const subs = [
  { endpoint: 'https://127.0.0.1:9443/ok', user_id: 'A', p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authSecret) },
  { endpoint: 'https://127.0.0.1:9443/gone', user_id: 'A', p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authSecret) },
  { endpoint: 'https://127.0.0.1:9443/badkeys', user_id: 'A', p256dh: 'k', auth: 'a' },
];
const dropped: string[] = [], okMarked: string[] = [], markedSent: string[] = [];
const rest = Deno.serve({ port: 9001, onListen() {} }, async (req) => {
  const name = new URL(req.url).pathname.split('/').pop()!;
  restCalls++;
  const ok = req.headers.get('authorization') === 'Bearer service-key' || (req.headers.get('apikey') === 'sb_secret_test' && !req.headers.get('authorization'));
  if (!ok) return new Response('no', { status: 401 });
  const a = await req.json().catch(() => ({}));
  const J = (v: unknown) => Response.json(v);
  if (name === 'todo_secret') return J(secrets[a.p_name] ?? null);
  if (name === 'todo_init_secret') { secrets[a.p_name] ??= a.p_value; return J(secrets[a.p_name]); }
  if (name === 'claim_due_reminders') { const r = claimed ? [] : reminders; claimed = true; return J(r); }
  if (name === 'subs_for') return J(subs.filter((s) => a.p_users.includes(s.user_id)));
  if (name === 'drop_sub') { dropped.push(a.p_endpoint); return new Response(''); }
  if (name === 'mark_subs_ok') { okMarked.push(...a.p_endpoints); return new Response(''); }
  if (name === 'mark_sent') { markedSent.push(...a.p_tasks); return new Response(''); }
  if (name === 'release_claims') return new Response('');
  return new Response('?', { status: 404 });
});
// --- faux service push (HTTPS)
const received: { path: string; body: Uint8Array; headers: Headers }[] = [];
const push = Deno.serve({ port: 9443, cert: Deno.readTextFileSync(Deno.env.get('TEST_CERT') ?? 'cert.pem'), key: Deno.readTextFileSync(Deno.env.get('TEST_KEY') ?? 'key.pem'), onListen() {} }, async (req) => {
  const path = new URL(req.url).pathname;
  received.push({ path, body: new Uint8Array(await req.arrayBuffer()), headers: req.headers });
  return new Response('', { status: path === '/gone' ? 410 : 201 });
});

Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:9001');
if (Deno.env.get('TEST_NEW_KEYS')) Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_test' }));
else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('TODO_NO_SERVE', '1');
const { handler } = await import(new URL('../../supabase/functions/send-reminders/index.ts', import.meta.url).href);

let r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-cron-secret': 'faux' } }));
check('jeton cron mal formé : refusé sans aucun accès à la base', r.status === 401 && restCalls === 0, restCalls);
r = await handler(new Request('http://x/', { method: 'POST' }));
check('sans jeton : refusé sans aucun accès à la base', r.status === 401 && restCalls === 0, restCalls);
r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-cron-secret': 'c'.repeat(64) } }));
check('mauvais jeton bien formé : refusé', r.status === 401);
const before = restCalls;
r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-cron-secret': 'd'.repeat(64) } }));
check('jeton gardé en mémoire : pas de nouvelle lecture à chaque appel', r.status === 401 && restCalls === before, [before, restCalls]);
r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-cron-secret': CRON } }));
const out = await r.json();
check('réponse : 1 envoyé, 2 abonnements retirés (expiré, clés invalides)', out.sent === 1 && out.dropped === 2 && out.due === 2, out);
check('clés invalides : abonnement retiré', dropped.includes('https://127.0.0.1:9443/badkeys'));
check('rappels marqués traités (envoyé, et trop ancien abandonné)', markedSent.includes('t1') && markedSent.includes('old'), markedSent);
check('clés VAPID créées et gardées', !!secrets.vapid && JSON.parse(secrets.vapid).publicKey.length > 40);
const ok = received.find((x) => x.path === '/ok');
check('notification reçue par le service push', !!ok);
check('en-têtes Web Push (VAPID, chiffrement, TTL, urgence)', ok!.headers.get('content-encoding') === 'aes128gcm' && /^vapid t=/.test(ok!.headers.get('authorization') ?? '') && ok!.headers.get('ttl') === '21600' && ok!.headers.get('urgency') === 'high', Object.fromEntries(ok!.headers));
const plain = ece.decrypt(Buffer.from(ok!.body), { version: 'aes128gcm', privateKey: ecdh, authSecret });
const msg = JSON.parse(plain.toString());
check('message déchiffrable par l\'appareil, contenu transmis tel quel (chiffré)', msg.t === 't1' && msg.c === 'CIPHERTEXT-1' && typeof msg.at === 'number', msg);
check('rappel trop ancien (> 12 h) non envoyé', !received.some((x) => { try { return JSON.parse(ece.decrypt(Buffer.from(x.body), { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString()).t === 'old'; } catch { return false; } }));
check('abonnement expiré supprimé', dropped.includes('https://127.0.0.1:9443/gone'));
check('abonnement valide marqué', okMarked.includes('https://127.0.0.1:9443/ok'));
r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-cron-secret': CRON } }));
check('exécution suivante : rien à envoyer', (await r.json()).sent === 0);
await rest.shutdown(); await push.shutdown();
console.log(fails ? `${fails} ÉCHEC(S)` : 'tout est OK');
Deno.exit(fails ? 1 : 0);
