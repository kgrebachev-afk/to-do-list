// To do list : envoi des rappels (Web Push), appelée chaque minute par le cron de la base.
// Le contenu des rappels est chiffré sur l'appareil : cette fonction transmet un message illisible
// pour elle, que seul l'appareil de l'utilisateur sait déchiffrer.
import webpush from 'npm:web-push@3.6.7';

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
  const secret = await rpc<string | null>('todo_secret', { p_name: 'cron' });
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('refusé', { status: 401 });

  const keys = await vapidKeys();
  webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);

  const due = (await rpc<Due[]>('claim_due_reminders')) ?? [];
  const fresh = due.filter((d) => d.fresh);
  if (!fresh.length) return Response.json({ due: due.length, sent: 0 });

  const users = [...new Set(fresh.map((d) => d.user_id))];
  const subs = (await rpc<Sub[]>('subs_for', { p_users: users })) ?? [];
  let sent = 0, dropped = 0, failed = 0;
  const okEndpoints = new Set<string>();

  const jobs = fresh.flatMap((d) => subs.filter((s) => s.user_id === d.user_id).map((s) => async () => {
    const body = JSON.stringify({ t: d.task_id, c: d.payload, at: new Date(d.fire_at).getTime() });
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 6 * 3600, urgency: 'high', timeout: 8000 });
      sent++; okEndpoints.add(s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { dropped++; await rpc('drop_sub', { p_endpoint: s.endpoint }).catch(() => {}); }
      else { failed++; console.error('envoi', code, (e as Error).message); }
    }
  }));
  // 20 envois à la fois au plus
  for (let i = 0; i < jobs.length; i += 20) await Promise.all(jobs.slice(i, i + 20).map((j) => j()));
  await Promise.all([...okEndpoints].map((ep) => rpc('mark_sub_ok', { p_endpoint: ep }).catch(() => {})));
  return Response.json({ due: due.length, sent, dropped, failed });
}

if (!Deno.env.get('TODO_NO_SERVE')) Deno.serve((req) => handler(req).catch((e) => { console.error(e); return new Response(String(e), { status: 500 }); }));
