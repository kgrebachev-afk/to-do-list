# Mise à jour de l'application : rien n'est à refaire (synchronisation, sauvegarde, notifications, réglages)
import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS, BUILD, test_build
import subprocess, sys, time, json, shutil, urllib.request
from fake.supabase import start, S
from playwright.sync_api import sync_playwright
SCR = TMP / 'updtest'; shutil.rmtree(SCR, ignore_errors=True); (SCR / 'site').mkdir(parents=True)
API = 'http://127.0.0.1:8893'; BASE = 'http://127.0.0.1:8892/to-do-list/'
ENV = dict(CLOUD_URL=API, CLOUD_KEY='sb_publishable_test', PAGES_URL=BASE)
def publish(version):
    out = test_build('build-upd-' + version, APP_VERSION=version, **ENV)
    shutil.copytree(out / 'web', SCR / 'site/to-do-list', dirs_exist_ok=True)
publish('9.0.0')
fake = start(8893)
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8892', '--bind', '127.0.0.1', '-d', str(SCR / 'site')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ('' if c else f' — {i}'))
def server(): return json.load(urllib.request.urlopen(API + '/__state'))
def wait(pg, expr, t=10):
    end = time.time() + t
    while time.time() < end:
        try:
            if pg.evaluate(expr): return True
        except Exception: pass
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)
# abonnement push simulé, conservé d'un chargement à l'autre (comme un vrai abonnement)
PUSH = """(() => { if (!self.PushManager) return;
  const mk = (ep) => ({ endpoint: ep, toJSON() { return { endpoint: ep, keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) } }; }, unsubscribe: async () => { localStorage.removeItem('__push'); return true; } });
  PushManager.prototype.subscribe = async function () { const ep = 'https://fcm.googleapis.com/fcm/send/' + Math.random().toString(36).slice(2); localStorage.setItem('__push', ep); return mk(ep); };
  PushManager.prototype.getSubscription = async function () { const ep = localStorage.getItem('__push'); return ep ? mk(ep) : null; };
})();"""
try:
  with sync_playwright() as p:
    b = p.chromium.launch(channel='chromium')
    ctx = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width': 1366, 'height': 820})
    ctx.add_init_script(PUSH); ctx.grant_permissions(['notifications'], origin='http://127.0.0.1:8892')
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_timeout(800)
    wait(pg, "navigator.serviceWorker.controller !== null", 10)
    # réglages de départ : synchronisation, notifications, fichier de sauvegarde, préférences
    pg.fill('#qaInput', 'Avant la mise à jour'); pg.press('#qaInput', 'Enter')
    pg.evaluate("window.__odj.cloud.create()"); wait(pg, "window.__odj.cloud.isOn() && !window.__odj.cloud.running")
    pg.evaluate("window.__odj.cloud.enablePush()"); wait(pg, "window.__odj.cloud.pushActive()")
    pg.evaluate("""async () => { const o = window.__odj; const dir = await navigator.storage.getDirectory();
      const h = await dir.getFileHandle('sauvegarde.json', { create: true }); o.fileSync.handle = h; o.fileSync.state = 'ok';
      await o.idb.set('handle', h); await o.fileSync.writeNow(); }""")
    pg.evaluate("window.__odj.setSetting('recurLead', 3); window.__odj.setSetting('remindTime', '08:30')")
    pg.wait_for_timeout(2000)
    code = pg.evaluate("window.__odj.cloud.st.code")
    subs0 = server()['subs']
    check('avant : synchronisé, notifications actives, sauvegarde liée', pg.evaluate("window.__odj.cloud.status") == 'ready' and len(subs0) == 1 and pg.evaluate("window.__odj.fileSync.state") == 'ok')
    # --- nouvelle version publiée pendant qu'on travaille (application ouverte depuis un moment)
    wait(pg, "performance.now() > 16000", 20)
    publish('9.0.1')
    pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())"); pg.wait_for_timeout(1500)
    check('nouvelle version détectée', any('nouvelle version' in t for t in pg.locator('.toast').all_inner_texts()))
    # l'application passe en arrière-plan : la mise à jour s'installe toute seule
    pg.evaluate("Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))")
    wait(pg, "document.body.innerText.includes('Version 9.0.1') || (document.querySelector('.about') && document.querySelector('.about').textContent.includes('9.0.1'))", 15)
    pg.wait_for_timeout(1500)
    check('installée seule, sans clic, dès que l\'application est en arrière-plan', '9.0.1' in pg.content())
    toasts = pg.locator('.toast').all_inner_texts()
    check('message rassurant : rien à refaire', any('à jour (version 9.0.1)' in t and 'rien à refaire' in t for t in toasts), toasts)
    pg.screenshot(path=str(SHOTS / '80-apres-mise-a-jour.png'))
    wait(pg, "!window.__odj.cloud.running && window.__odj.cloud.status === 'ready'", 10)
    check('après : même liste synchronisée, sans rescanner', pg.evaluate("window.__odj.cloud.st.code") == code and pg.evaluate("window.__odj.cloud.isOn()"))
    check('après : notifications toujours actives (même abonnement)', pg.evaluate("window.__odj.cloud.pushActive()") and [s['endpoint'] for s in server()['subs']] == [s['endpoint'] for s in subs0], server()['subs'])
    wait(pg, "window.__odj.fileSync.state === 'ok'", 10)
    check('après : sauvegarde automatique toujours active, même fichier', pg.evaluate("window.__odj.fileSync.handle && window.__odj.fileSync.handle.name") == 'sauvegarde.json')
    check('après : préférences conservées', pg.evaluate("window.__odj.state().settings.recurLead") == 3 and pg.evaluate("window.__odj.state().settings.remindTime") == '08:30')
    check('après : tâches conservées', 'Avant la mise à jour' in pg.locator('#list').inner_text())
    pg.fill('#qaInput', 'Après la mise à jour'); pg.press('#qaInput', 'Enter'); pg.wait_for_timeout(2500)
    check('après : une nouvelle tâche part bien vers les autres appareils', len([i for i in server()['items'] if i['id'] != '__settings']) == 2)
    # --- fermée puis rouverte avec une mise à jour en attente
    publish('9.0.2')
    pg.close()
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(BASE)
    wait(pg, "document.querySelector('.about') && document.querySelector('.about').textContent.includes('9.0.2')", 20)
    wait(pg, "window.__odj && window.__odj.cloud.isOn() && window.__odj.cloud.status === 'ready'", 10)
    check('rouverte : nouvelle version appliquée, toujours synchronisée', pg.evaluate("window.__odj.cloud.st.code") == code)
    b.close()
finally:
    web.terminate(); fake.shutdown()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
