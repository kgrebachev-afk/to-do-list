# Faux serveur Supabase (auth par code e-mail, PostgREST, RPC) pour les tests de synchronisation.
import json, re, threading, time, uuid, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.codes = {}      # email -> code
        self.users = {}      # email -> id
        self.tokens = {}     # access token -> user id
        self.refresh = {}    # refresh token -> user id
        self.vault = {}      # uid -> row
        self.items = {}      # (uid, id) -> row
        self.reminders = {}  # (uid, task_id) -> row
        self.subs = {}       # endpoint -> row
        self.calls = []
        self.expires_in = 3600
        self.down = False
        self.clock = 0
    def now_iso(self):
        # horloge du serveur strictement croissante
        self.clock = max(self.clock + 1, int(time.time() * 1e6))
        t = self.clock
        return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t // 1_000_000)) + '.%06d+00:00' % (t % 1_000_000)

S = State()

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
    def uid(self):
        a = self.headers.get('Authorization', '')
        return S.tokens.get(a[7:]) if a.startswith('Bearer ') else None
    def issue(self, uid, email):
        at, rt = 'at-' + uuid.uuid4().hex, 'rt-' + uuid.uuid4().hex
        S.tokens[at] = uid; S.refresh[rt] = uid
        return {'access_token': at, 'refresh_token': rt, 'expires_in': S.expires_in, 'token_type': 'bearer', 'user': {'id': uid, 'email': email}}

    def do_GET(self):
        if S.down: self.close_connection = True; return
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == '/__state':
            with S.lock: return self.reply(200, {'items': [dict(r, user_id=k[0]) for k, r in S.items.items()], 'vault': S.vault, 'reminders': [dict(r, user_id=k[0]) for k, r in S.reminders.items()], 'subs': list(S.subs.values()), 'calls': S.calls[-200:], 'codes': S.codes})
        if u.path == '/auth/v1/health': return self.reply(200, {'name': 'GoTrue'})
        uid = self.uid()
        S.calls.append(['GET', u.path])
        if not uid: return self.reply(401, {'message': 'JWT expired'})
        with S.lock:
            if u.path == '/rest/v1/vault':
                v = S.vault.get(uid); return self.reply(200, [v] if v else [])
            if u.path == '/rest/v1/items':
                mine = [r for (k, r) in S.items.items() if k[0] == uid]
                if 'id' in q:  # id=in.("a","b")
                    ids = set(x.strip('"') for x in re.match(r'in\.\((.*)\)', q['id'][0]).group(1).split(','))
                    return self.reply(200, [r for r in mine if r['id'] in ids])
                if 'or' in q:  # (modified_at.gt."X",and(modified_at.eq."X",id.gt."Y"))
                    m = re.match(r'\(modified_at\.gt\."([^"]+)",and\(modified_at\.eq\."([^"]+)",id\.gt\."([^"]+)"\)\)', q['or'][0])
                    x, y = m.group(1), m.group(3)
                    rows = [r for r in mine if r['modified_at'] > x or (r['modified_at'] == x and r['id'] > y)]
                else:
                    since = (q.get('modified_at') or ['gte.1970'])[0].split('.', 1)[1]
                    rows = [r for r in mine if r['modified_at'] >= since]
                rows.sort(key=lambda r: (r['modified_at'], r['id']))
                lim = int((q.get('limit') or ['500'])[0])
                return self.reply(200, rows[:lim])
        return self.reply(404, {'message': 'inconnu'})

    def do_POST(self):
        if S.down: self.close_connection = True; return
        u = urllib.parse.urlparse(self.path); b = self.body() or {}
        S.calls.append(['POST', u.path])
        with S.lock:
            if u.path == '/auth/v1/otp':
                S.codes[b['email']] = '482913'
                return self.reply(200, {})
            if u.path == '/auth/v1/verify':
                if S.codes.get(b.get('email')) != b.get('token'): return self.reply(403, {'error_code': 'otp_expired', 'msg': 'Token has expired or is invalid'})
                uid = S.users.setdefault(b['email'], str(uuid.uuid4()))
                return self.reply(200, self.issue(uid, b['email']))
            if u.path == '/auth/v1/token':
                uid = S.refresh.pop(b.get('refresh_token'), None)
                if not uid: return self.reply(400, {'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token'})
                email = next(e for e, i in S.users.items() if i == uid)
                return self.reply(200, self.issue(uid, email))
            uid = self.uid()
            if u.path == '/auth/v1/logout': return self.reply(204)
            if not uid: return self.reply(401, {'message': 'JWT expired'})
            if u.path == '/rest/v1/vault':
                if uid in S.vault: return self.reply(409, {'code': '23505', 'message': 'duplicate key'})
                S.vault[uid] = {'salt': b['salt'], 'verifier': b['verifier'], 'iterations': b.get('iterations', 310000)}
                return self.reply(201)
            m = re.match(r'/rest/v1/rpc/(\w+)', u.path)
            if not m: return self.reply(404, {})
            fn = m.group(1)
            if fn in ('push_items', 'set_reminders') and b.get('p_salt') is not None and (S.vault.get(uid) or {}).get('salt') != b['p_salt']:
                return self.reply(400, {'code': 'P0001', 'message': 'coffre changé'})
            if fn == 'push_items':
                rejected = []
                for r in b['rows']:
                    k = (uid, r['id']); cur = S.items.get(k)
                    if cur is None or cur['updated_at'] < r['updated_at']:
                        S.items[k] = {'id': r['id'], 'updated_at': r['updated_at'], 'deleted': bool(r.get('deleted')), 'data': r.get('data'), 'modified_at': S.now_iso()}
                    elif cur['updated_at'] > r['updated_at'] or cur['data'] != r.get('data'):
                        rejected.append(r['id'])
                return self.reply(200, {'rejected': rejected})
            if fn == 'set_reminders':
                keep = {r['task_id'] for r in b['rows']}
                for k in [k for k in S.reminders if k[0] == uid and k[1] not in keep]: del S.reminders[k]
                for r in b['rows']:
                    k = (uid, r['task_id']); cur = S.reminders.get(k)
                    sent = cur['sent_at'] if cur and cur['fire_at'] == r['fire_at'] else None
                    S.reminders[k] = {'task_id': r['task_id'], 'fire_at': r['fire_at'], 'payload': r['payload'], 'sent_at': sent}
                return self.reply(200, None) if False else self.reply(204)
            if fn == 'register_push':
                S.subs[b['p_endpoint']] = {'endpoint': b['p_endpoint'], 'user_id': uid, 'p256dh': b['p_p256dh'], 'auth': b['p_auth'], 'label': b['p_label']}
                return self.reply(204)
            if fn == 'unregister_push':
                S.subs.pop(b['p_endpoint'], None); return self.reply(204)
            if fn == 'vapid_public_key':
                return self.reply(200, 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
            if fn == 'reset_cloud':
                for d in (S.items, S.reminders):
                    for k in [k for k in d if k[0] == uid]: del d[k]
                S.vault.pop(uid, None)
                for e in [e for e, s in S.subs.items() if s['user_id'] == uid]: del S.subs[e]
                return self.reply(204)
        return self.reply(404, {})

def start(port):
    srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
