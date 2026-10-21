# Jumelage : réponses tardives et appareil déjà synchronisé (cas trouvés au contre-audit)
import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS, BUILD, test_build
import subprocess, sys, time, shutil
from fake.supabase import start, S
from playwright.sync_api import sync_playwright
SCR = TMP / 'pairrace'; shutil.rmtree(SCR, ignore_errors=True); (SCR / 'site').mkdir(parents=True)
API = 'http://127.0.0.1:8891'
shutil.copytree(test_build('build-pairrace', CLOUD_URL=API, CLOUD_KEY='sb_publishable_test', PAGES_URL='http://127.0.0.1:8890/to-do-list/') / 'web', SCR / 'site/to-do-list')
fake = start(8891)
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8890', '--bind', '127.0.0.1', '-d', str(SCR / 'site')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
URL = 'http://127.0.0.1:8890/to-do-list/'
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ('' if c else f' — {i}'))
def wait(pg, expr, t=10):
    end = time.time() + t
    while time.time() < end:
        try:
            if pg.evaluate(expr): return True
        except Exception: pass
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(channel='chromium')
    def dev():
        c = b.new_context(locale='fr-FR', timezone_id='Europe/Paris'); pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(URL); pg.wait_for_timeout(400); return pg
    own, att = dev(), dev()
    own.evaluate("window.__odj.cloud.create()"); wait(own, "window.__odj.cloud.isOn()")
    att.evaluate("window.__odj.cloud.create()"); wait(att, "window.__odj.cloud.isOn()")
    ownCode = own.evaluate("window.__odj.cloud.st.code"); attCode = att.evaluate("window.__odj.cloud.st.code")
    # 1. appareil déjà synchronisé qui scanne le QR code d'une autre liste : mise en garde explicite
    ph = dev(); ph.evaluate("window.__odj.cloud.create()"); wait(ph, "window.__odj.cloud.isOn()")
    tok = att.evaluate("window.__odj.cloud.offerPairing().then(o => o.token)")
    ph.evaluate(f"window.__odj.syncUi.joinWith({{kind:'token', v:'{tok}'}})")
    wait(ph, "!document.querySelector('#syncFoot [data-sync=\"join-pending\"]').disabled")
    check('déjà synchronisé + QR d\'une autre liste : « déjà synchronisé avec une autre liste »', 'déjà synchronisé avec une autre liste' in ph.locator('#syncBody').inner_text(), ph.locator('#syncBody').inner_text()[:120])
    ph.evaluate("window.__odj.syncUi.act('cancel')")
    # 2. réponse tardive d'un premier QR code (annulé) : ne doit jamais remplacer le second
    ph2 = dev()
    tA = att.evaluate("window.__odj.cloud.offerPairing().then(o => o.token)")
    tO = own.evaluate("window.__odj.cloud.offerPairing().then(o => o.token)")
    ph2.evaluate("(() => { const f = window.fetch; let n = 0; window.fetch = async (u, o) => { if (String(u).includes('pair_take') && n++ === 0) { const r = await f(u, o); await new Promise(z => setTimeout(z, 3000)); return r; } return f(u, o); }; })()")
    ph2.evaluate(f"window.__odj.syncUi.joinWith({{kind:'token', v:'{tA}'}})")
    ph2.wait_for_timeout(300)
    ph2.evaluate("window.__odj.syncUi.act('cancel')")
    ph2.evaluate(f"window.__odj.syncUi.joinWith({{kind:'token', v:'{tO}'}})")
    ph2.wait_for_timeout(4500)
    check('réponse tardive d\'un QR code abandonné : ignorée', ph2.evaluate("window.__odj.syncUi.pending") == ownCode)
    ph2.click('#syncFoot [data-sync="join-pending"]'); wait(ph2, "window.__odj.cloud.isOn()")
    check('… l\'appareil rejoint bien la liste du second QR code', ph2.evaluate("window.__odj.cloud.st.code") == ownCode)
    b.close()
finally:
    web.terminate(); fake.shutdown()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
