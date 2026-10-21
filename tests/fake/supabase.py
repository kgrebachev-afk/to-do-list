# Faux serveur Supabase (fonctions de la base, schéma v2 : comptes par clé d'accès) pour les tests.
# Reproduit le comportement de supabase/schema.sql, vérifié par tests/server/sql.test.mjs.
import json, re, threading, time, hashlib, urllib.parse
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

class Unknown(Exception): pass

class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.accounts = {}   # empreinte -> {created}
        self.retired = set() # empreintes des codes retirés (« Changer de code »)
        self.items = {}      # (compte, id) -> row
        self.reminders = {}  # (compte, task_id) -> row
        self.subs = {}       # endpoint -> row
        self.pairings = {}   # id -> {account, blob, expires, taken}
        self.calls = []
        self.down = False
        self.fail = set()    # fonctions en panne (réponse 503)
        self.pair_ttl = 600  # durée de validité d'un QR code (s)
        self.reject_ids = set()  # serveur malveillant : envois refusés
        self.evil_get = None     # serveur malveillant : réponse imposée à get_items
        self.clock = 0
    def now_iso(self):
        # horloge du serveur strictement croissante, au format renvoyé par PostgREST
        self.clock = max(self.clock + 1, int(time.time() * 1e6))
        t = self.clock
        return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t // 1_000_000)) + '.%06d+00:00' % (t % 1_000_000)

S = State()

def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)

def key_hash(k):
    if not isinstance(k, str) or not re.fullmatch(r'[0-9a-f]{64}', k): raise ValueError('clé invalide')
    return hashlib.sha256(k.encode()).hexdigest()

def account_of(k):
    a = key_hash(k)
    if a not in S.accounts: raise Unknown()
    return a

PUSH_OK = re.compile(r'^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com)/')

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin') or '*')
        self.send_header('Access-Control-Allow-Headers', 'apikey, authorization, content-type, prefer, x-client-info')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    def reply(self, code, obj=None):
        body = b'' if obj is None else json.dumps(obj).encode()
        self.send_response(code); self.cors()
        if obj is not None: self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.send_header('Content-Length', '0'); self.end_headers()
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'null') if n else None

    def do_GET(self):
        if S.down: self.close_connection = True; return
        u = urllib.parse.urlparse(self.path)
        if u.path == '/__state':
            with S.lock:
                return self.reply(200, {'accounts': list(S.accounts), 'retired': list(S.retired), 'items': [dict(r, account=k[0]) for k, r in S.items.items()],
                                        'reminders': [dict(r, account=k[0]) for k, r in S.reminders.items()], 'subs': list(S.subs.values()), 'calls': S.calls[-300:]})
        return self.reply(404, {'message': 'inconnu'})

    def do_POST(self):
        if S.down: self.close_connection = True; return
        u = urllib.parse.urlparse(self.path); b = self.body() or {}
        S.calls.append(['POST', u.path, sorted(b.keys())])
        k = self.headers.get('apikey')
        if k not in ('anon-test', 'sb_publishable_test'): return self.reply(401, {'message': 'No API key found in request'})
        auth = self.headers.get('Authorization')
        # comme Supabase : une clé « sb_publishable_… » envoyée en Authorization est refusée (ce n'est pas un JWT)
        if auth and (k.startswith('sb_') or auth != 'Bearer ' + k): return self.reply(401, {'message': 'Invalid JWT'})
        m = re.match(r'/rest/v1/rpc/(\w+)$', u.path)
        if not m: return self.reply(404, {'message': 'inconnu'})
        fn = m.group(1)
        if fn in S.fail: return self.reply(503, {'message': 'service indisponible'})
        try:
            with S.lock: return self.rpc(fn, b)
        except Unknown:
            return self.reply(400, {'code': 'P0001', 'message': 'compte inconnu'})
        except ValueError as e:
            return self.reply(400, {'code': 'P0001', 'message': str(e)})

    def rpc(self, fn, b):
        if fn == 'create_account':
            h = key_hash(b['p_key'])
            if h in S.retired: raise ValueError('code retiré')
            S.accounts.setdefault(h, {'created': time.time()}); return self.reply(204)
        if fn == 'vapid_public_key':
            return self.reply(200, 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
        if fn == 'delete_account':
            a = key_hash(b['p_key'])
            if a in S.accounts: S.retired.add(a)
            S.accounts.pop(a, None)
            for i in [i for i, x in S.pairings.items() if x['account'] == a]: del S.pairings[i]
            for d in (S.items, S.reminders):
                for k in [k for k in d if k[0] == a]: del d[k]
            for e in [e for e, s in S.subs.items() if s['account'] == a]: del S.subs[e]
            return self.reply(204)
        if fn == 'pair_take':
            i = b.get('p_id')
            if not isinstance(i, str) or not re.fullmatch(r'[0-9a-f]{64}', i): raise ValueError('identifiant invalide')
            x = S.pairings.get(i)
            if not x or x['taken'] or x['expires'] <= time.time(): return self.reply(200, None)
            blob = x['blob']; x['taken'] = time.time(); x['blob'] = None
            return self.reply(200, blob)
        a = account_of(b.get('p_key'))
        if fn == 'pair_offer':
            i = b.get('p_id'); blob = b.get('p_blob')
            if not isinstance(i, str) or not re.fullmatch(r'[0-9a-f]{64}', i) or not isinstance(blob, str) or len(blob.encode()) > 400: raise ValueError('jumelage invalide')
            mine = sorted([(x['created'], k) for k, x in S.pairings.items() if x['account'] == a and not x['taken'] and x['expires'] > time.time()])
            for _, k in mine[:max(0, len(mine) - 4)]: del S.pairings[k]
            S.pairings.setdefault(i, {'account': a, 'blob': blob, 'created': time.time(), 'expires': time.time() + S.pair_ttl, 'taken': None})
            return self.reply(204)
        if fn == 'pair_status':
            x = S.pairings.get(b.get('p_id'))
            if not x or x['account'] != a: return self.reply(200, {'state': 'expired'})
            if x['taken']: return self.reply(200, {'state': 'used', 'at': datetime.fromtimestamp(x['taken'], timezone.utc).isoformat()})
            return self.reply(200, {'state': 'expired' if x['expires'] <= time.time() else 'pending'})
        if fn == 'account_info':
            created = datetime.fromtimestamp(S.accounts[a]['created'], timezone.utc).isoformat()
            tasks = sum(1 for (k, r) in S.items.items() if k[0] == a and not r['deleted'] and r['id'] != '__settings')
            devices = sum(1 for s in S.subs.values() if s['account'] == a)
            return self.reply(200, {'created_at': created, 'tasks': tasks, 'devices': devices})
        if fn == 'pull_items':
            mine = [r for (k, r) in S.items.items() if k[0] == a]
            since = b.get('p_since'); after = b.get('p_after_id') or ''
            if since:
                t = ts(since)
                mine = [r for r in mine if (ts(r['modified_at']), r['id']) > (t, after)]
            mine.sort(key=lambda r: (ts(r['modified_at']), r['id']))
            return self.reply(200, mine[:500])
        if fn == 'get_items':
            if len(b['p_ids']) > 500: raise ValueError('trop d\'éléments à la fois')
            if S.evil_get is not None: return self.reply(200, S.evil_get)
            ids = set(b['p_ids'])
            return self.reply(200, [r for (k, r) in S.items.items() if k[0] == a and r['id'] in ids])
        if fn == 'push_items':
            rows = b['p_rows']
            if len(rows) > 500: raise ValueError('trop d\'éléments à la fois')
            if any(int(r['updated_at']) > time.time() * 1000 + 86400000 for r in rows):
                raise ValueError("horloge de l'appareil en avance de plus d'un jour : vérifiez la date et l'heure")
            rejected = []
            for r in rows:
                k = (a, r['id']); cur = S.items.get(k)
                if r['id'] in S.reject_ids: rejected.append(r['id']); continue
                if cur is None or cur['updated_at'] < r['updated_at']:
                    S.items[k] = {'id': r['id'], 'updated_at': r['updated_at'], 'deleted': bool(r.get('deleted')), 'data': r.get('data'), 'modified_at': S.now_iso()}
                elif cur['updated_at'] > r['updated_at'] or cur['data'] != r.get('data'):
                    rejected.append(r['id'])
            return self.reply(200, {'rejected': rejected})
        if fn == 'set_reminders':
            rows = b['p_rows']
            if len(rows) > 300: raise ValueError('trop de rappels')
            if any(len(r['payload'].encode()) >= 3000 or not isinstance(r.get('fire_at'), (int, float)) for r in rows): raise ValueError('rappel invalide')
            keep = {r['task_id'] for r in rows}
            for k in [k for k in S.reminders if k[0] == a and k[1] not in keep]: del S.reminders[k]
            for r in rows:
                k = (a, r['task_id']); cur = S.reminders.get(k)
                past = r['fire_at'] < (time.time() - 300) * 1000  # passé de plus de 5 min : pas envoyé par le serveur
                sent = cur['sent_at'] if cur and cur['fire_at'] == r['fire_at'] else ('passé' if past else None)
                S.reminders[k] = {'task_id': r['task_id'], 'fire_at': r['fire_at'], 'payload': r['payload'], 'sent_at': sent}
            return self.reply(204)
        if fn == 'register_push':
            if not PUSH_OK.match(b['p_endpoint']) or not re.fullmatch(r"[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]*", b['p_endpoint'].split('/', 3)[3]): raise ValueError('service de notification inconnu')
            if not re.fullmatch(r'B[A-Za-z0-9_-]{86}={0,1}', b.get('p_p256dh') or '') or not re.fullmatch(r'[A-Za-z0-9_-]{22}={0,2}', b.get('p_auth') or ''): raise ValueError('abonnement invalide')
            S.subs[b['p_endpoint']] = {'endpoint': b['p_endpoint'], 'account': a, 'p256dh': b['p_p256dh'], 'auth': b['p_auth'], 'label': b['p_label']}
            return self.reply(204)
        if fn == 'unregister_push':
            s = S.subs.get(b['p_endpoint'])
            if s and s['account'] == a: del S.subs[b['p_endpoint']]
            return self.reply(204)
        return self.reply(404, {'message': 'fonction inconnue'})

def start(port):
    srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
