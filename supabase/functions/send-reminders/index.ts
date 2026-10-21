// To do list : envoi des rappels (Web Push), appelée chaque minute par le cron de la base.
// Le contenu des rappels est chiffré sur l'appareil : cette fonction transmet un message illisible
// pour elle, que seul l'appareil de l'utilisateur sait déchiffrer.
//
// web-push est inclus dans ce dossier (web-push.js, versions figées et vérifiées) : rien n'est
// téléchargé au déploiement, aucune dépendance ne peut changer à notre insu.
import webpush from './web-push.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// Nouvelle clé secrète (sb_secret_…) si le projet en a une, sinon l'ancienne clé service_role.
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const k = keys.default ?? Object.values(keys)[0];
    if (typeof k === 'string' && k) return k;
  } catch { /* variable absente */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}
const SERVICE_KEY = serviceKey();
// Les nouvelles clés ne sont pas des JWT : elles passent uniquement dans l'en-tête apikey.
const AUTH_HEADERS: Record<string, string> = SERVICE_KEY.startsWith('sb_secret_')
  ? { apikey: SERVICE_KEY }
  : { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://kgrebachev-afk.github.io/to-do-list/';
const BUDGET_MS = 40_000;  // au-delà, on s'arrête : le reste est rendu et repris à l'exécution suivante
const MAX_SENDS = 400;     // envois au plus par exécution (temps de calcul limité de la fonction)

type Due = { user_id: string; task_id: string; payload: string; fire_at: string; fresh: boolean };
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name} : ${r.status} ${await r.text()}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

// Jeton du cron : gardé en mémoire 10 minutes. Une requête sans jeton bien formé est refusée
// sans aucun accès à la base (la fonction est joignable par tout le monde).
let cronCache: { v: string; at: number } | null = null;
async function same(p: string, q: string): Promise<boolean> {
  // comparaison en temps constant (empreintes de même longueur)
  const [a, b] = await Promise.all([p, q].map((s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function cronOk(req: Request): Promise<boolean> {
  const got = req.headers.get('x-cron-secret') ?? '';
  if (!/^[0-9a-f]{64}$/.test(got)) return false;
  const fresh = cronCache && Date.now() - cronCache.at < 600_000;
  if (fresh && await same(got, cronCache!.v)) return true;
  // pas encore lu, trop ancien, ou différent (jeton changé) : relu au plus une fois par minute
  if (cronCache && Date.now() - cronCache.at < 60_000) return false;
  const v = await rpc<string | null>('todo_secret', { p_name: 'cron' });
  if (!v) { cronCache = null; return false; }
  cronCache = { v, at: Date.now() };
  return same(got, v);
}

async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const stored = await rpc<string | null>('todo_secret', { p_name: 'vapid' });
  if (stored) return JSON.parse(stored);
  // Première exécution : la paire de clés est créée une fois pour toutes ; en cas d'exécutions
  // simultanées, la base garde la première et la renvoie à tout le monde.
  const k = webpush.generateVAPIDKeys();
  const kept = await rpc<string>('todo_init_secret', { p_name: 'vapid', p_value: JSON.stringify(k) });
  return JSON.parse(kept);
}

export async function handler(req: Request): Promise<Response> {
  const start = Date.now();
  if (!(await cronOk(req))) return new Response('refusé', { status: 401 });

  const keys = await vapidKeys();
  webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);

  // Les rappels réservés le restent 5 minutes. Chaque lot envoyé est aussitôt marqué « traité » :
  // une exécution interrompue ne renverra jamais deux fois le même rappel. Ce qui n'a pas pu être
  // envoyé dans les limites (temps, nombre d'envois) est rendu pour l'exécution suivante.
  const due = (await rpc<Due[]>('claim_due_reminders')) ?? [];
  const stale = due.filter((d) => !d.fresh); // trop anciens : abandonnés
  if (stale.length) await rpc('mark_sent', { p_users: stale.map((d) => d.user_id), p_tasks: stale.map((d) => d.task_id) });
  const fresh = due.filter((d) => d.fresh);
  let sent = 0, dropped = 0, failed = 0, deferred = 0, attempts = 0;
  const okEndpoints = new Set<string>();
  if (fresh.length) {
    const users = [...new Set(fresh.map((d) => d.user_id))];
    const subs = (await rpc<Sub[]>('subs_for', { p_users: users })) ?? [];
    const gone = new Set<string>();
    let i = 0;
    while (i < fresh.length) {
      if (Date.now() - start > BUDGET_MS || attempts >= MAX_SENDS) break;
      const batch: Due[] = [];
      let planned = 0;
      while (i < fresh.length && batch.length < 20) {
        const n = subs.filter((s) => s.user_id === fresh[i].user_id).length;
        if (batch.length && attempts + planned + n > MAX_SENDS) break;
        batch.push(fresh[i]); planned += n; i++;
      }
      attempts += planned;
      await Promise.all(batch.map(async (d) => {
        const body = JSON.stringify({ t: d.task_id, c: d.payload, at: new Date(d.fire_at).getTime() });
        for (const s of subs) {
          if (s.user_id !== d.user_id || gone.has(s.endpoint)) continue;
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 6 * 3600, urgency: 'high', timeout: 8000 });
            sent++; okEndpoints.add(s.endpoint);
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            const msg = String((e as Error).message ?? '');
            // abonnement expiré, refusé par le service, ou clés invalides : il ne pourra jamais aboutir
            if (code === 400 || code === 403 || code === 404 || code === 410 || (code === undefined && /p256dh|auth|public key|subscription/i.test(msg))) {
              gone.add(s.endpoint); dropped++;
              await rpc('drop_sub', { p_endpoint: s.endpoint }).catch(() => {});
            } else { failed++; console.error('envoi', code ?? '', msg.slice(0, 200)); }
          }
        }
      }));
      await rpc('mark_sent', { p_users: batch.map((d) => d.user_id), p_tasks: batch.map((d) => d.task_id) });
    }
    const rest = fresh.slice(i);
    deferred = rest.length;
    if (rest.length) await rpc('release_claims', { p_users: rest.map((d) => d.user_id), p_tasks: rest.map((d) => d.task_id) }).catch(() => {});
  }
  if (okEndpoints.size) await rpc('mark_subs_ok', { p_endpoints: [...okEndpoints] }).catch(() => {});
  return Response.json({ due: due.length, sent, dropped, failed, deferred });
}

if (!Deno.env.get('TODO_NO_SERVE')) {
  Deno.serve((req) => handler(req).catch((e) => {
    console.error(e); // détail dans les journaux de Supabase, jamais dans la réponse
    return new Response('erreur', { status: 500 });
  }));
}
