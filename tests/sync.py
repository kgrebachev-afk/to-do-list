# Synchronisation PC <-> téléphone (jumelage par QR code) avec un faux serveur Supabase
import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS, BUILD, test_build
import pathlib, subprocess, sys, time, json, os, shutil, urllib.request, io, re
from fake.supabase import start, S
from playwright.sync_api import sync_playwright
from PIL import Image

SCR = TMP / 'synctest'
OUT = SHOTS
API = 'http://127.0.0.1:8791'
shutil.rmtree(SCR, ignore_errors=True); (SCR / 'site').mkdir(parents=True)
env = dict(os.environ, CLOUD_URL=API, CLOUD_KEY='sb_publishable_test', OUT_DIR=str(SCR / 'build'), TEST_HOOKS='1', PAGES_URL='http://127.0.0.1:8790/to-do-list/')
subprocess.run(['node', str(ROOT / 'build.mjs')], env=env, check=True, capture_output=True)
shutil.copytree(SCR / 'build/web', SCR / 'site/to-do-list')
fake = start(8791)
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8790', '--bind', '127.0.0.1', '-d', str(SCR / 'site')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
URL = 'http://127.0.0.1:8790/to-do-list/'
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ('' if c else f' — {i}'))
def server(): return json.load(urllib.request.urlopen(API + '/__state'))
titles = lambda pg: pg.evaluate("window.__odj.state().tasks.filter(t=>!t.done).sort((a,b)=>a.position-b.position).map(t=>t.title)")
PUSH_MOCK = """
  (() => {
    const fake = { endpoint: 'https://fcm.googleapis.com/fcm/send/' + Math.random().toString(36).slice(2), toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) } }; }, unsubscribe: async () => true };
    let cur = null;
    if (self.PushManager) {
      PushManager.prototype.subscribe = async function () { cur = fake; return fake; };
      PushManager.prototype.getSubscription = async function () { return cur; };
    }
  })();
"""
ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36'
IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
def wait_js(pg, expr, timeout=10000):
    # attente par interrogations successives (la CSP de l'application interdit l'évaluation de chaînes)
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if pg.evaluate(expr): return True
        except Exception: pass
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)
def sync_now(pg):
    pg.evaluate("window.__odj.cloud.sync()"); pg.wait_for_timeout(400)
    wait_js(pg, "!window.__odj.cloud.running", 10000)
def phone_ctx(b, ua=ANDROID_UA, **kw):
    c = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, user_agent=ua, **kw)
    c.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;" + PUSH_MOCK)
    c.grant_permissions(['notifications'], origin='http://127.0.0.1:8790')
    return c
def write_y4m(png_bytes, path, w=640, h=480, frames=20):
    """Vidéo de caméra factice (format Y4M) montrant le QR code au centre."""
    qr = Image.open(io.BytesIO(png_bytes)).convert('RGB')
    side = 340; qr = qr.resize((side, side), Image.NEAREST)
    img = Image.new('RGB', (w, h), (235, 238, 240)); img.paste(qr, ((w - side) // 2, (h - side) // 2))
    y, cb, cr = img.convert('YCbCr').split()
    cb = cb.resize((w // 2, h // 2)); cr = cr.resize((w // 2, h // 2))
    with open(path, 'wb') as f:
        f.write(f'YUV4MPEG2 W{w} H{h} F10:1 Ip A1:1 C420jpeg\n'.encode())
        for _ in range(frames):
            f.write(b'FRAME\n'); f.write(y.tobytes()); f.write(cb.tobytes()); f.write(cr.tobytes())

try:
  with sync_playwright() as p:
    b = p.chromium.launch(channel='chromium')  # nouveau mode sans écran : notifications disponibles
    pc = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width': 1366, 'height': 820})
    pc.add_init_script(PUSH_MOCK)
    A = pc.new_page(); A.on('pageerror', lambda e: errs.append('PC ' + str(e)))
    A.goto(URL); A.wait_for_timeout(500)
    for t in ['Clôture J+3', 'Relancer les achats', 'Point atelier']:
        A.fill('#qaInput', t); A.press('#qaInput', 'Enter')

    # --- PC : première synchronisation, création du code
    A.click('#btnSettings')
    check('PC : section Synchronisation, sans e-mail ni mot de passe', A.locator('#setSyncSec').is_visible() and 'pas d\'e-mail' in A.locator('#setSyncText').inner_text())
    A.click('[data-syncset="open"]')
    A.locator('#dlgSyncTitle', has_text='Synchroniser mes appareils').wait_for()
    A.screenshot(path=str(OUT / '93-sync-start.png'))
    A.click('[data-sync="create"]')
    A.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=15000)
    wait_js(A, "!window.__odj.cloud.running", 10000)
    A.locator('#pairCodeTxt').wait_for(state='visible', timeout=8000)
    tok_txt = A.locator('#pairCodeTxt').inner_text()
    TOKEN = tok_txt.replace('-', '')
    CODE = A.evaluate("window.__odj.cloud.st.code")
    check('QR code à usage unique : code de 13 caractères au format XXXX-XXXX-XXXX-X', re.fullmatch(r'[0-9A-Z]{4}(-[0-9A-Z]{4}){2}-[0-9A-Z]', tok_txt) is not None, tok_txt)
    A.locator('#pairInfo', has_text='expire dans').wait_for(timeout=8000)
    check('QR code affiché, valable 10 minutes', A.locator('#syncQr svg').count() == 1 and 'expire dans 10 minutes' in A.locator('#pairInfo').inner_text(), A.locator('#pairInfo').inner_text())
    check('le code de secours n\'est pas affiché à l\'écran', CODE not in A.locator('#syncBody').inner_text().replace('-', ''))
    A.screenshot(path=str(OUT / '94-sync-qr.png'))
    st = server()
    items = [i for i in st['items'] if i['id'] != '__settings']
    check('serveur : 3 tâches envoyées', len(items) == 3, len(items))
    blob = json.dumps(st)
    check('serveur : aucun texte en clair, ni le code de secours ni le code du QR (chiffré de bout en bout)', all(w not in blob for w in ['Clôture', 'Relancer', 'atelier', CODE, TOKEN]))
    check('serveur : un compte, identifié par une empreinte', len(st['accounts']) == 1 and re.fullmatch(r'[0-9a-f]{64}', st['accounts'][0]))
    calls = [c for c in st['calls'] if c[1].startswith('/rest/v1/rpc/')]
    check('uniquement des appels de fonctions, sans session ni jeton', all('/auth/' not in c[1] for c in st['calls']) and len(calls) > 0)
    check('PC : barre d\'état « Synchronisé »', 'Synchronisé' in A.locator('#status').inner_text(), A.locator('#status').inner_text())
    # code de secours : flouté, révélé à la demande
    A.click('[data-sync="secret"]')
    check('code de secours : flouté par défaut, avec mise en garde', A.evaluate("document.querySelector('#secretTxt').classList.contains('masked')") and 'sans limite de durée' in A.locator('#syncBody').inner_text())
    A.click('[data-sync="secret-reveal"]')
    check('… affiché d\'un clic', A.locator('#secretTxt').inner_text().replace('-', '') == CODE and not A.evaluate("document.querySelector('#secretTxt').classList.contains('masked')"))
    A.screenshot(path=str(OUT / '94b-secret.png'))
    A.click('#syncFoot [data-sync="show"]'); A.locator('#pairCodeTxt').wait_for(state='visible', timeout=8000)
    tok_txt = A.locator('#pairCodeTxt').inner_text(); TOKEN = tok_txt.replace('-', '')

    # --- téléphone Android : saisie manuelle du code du QR (avec une faute, puis en minuscules avec espaces)
    ph = phone_ctx(b)
    P = ph.new_page(); P.on('pageerror', lambda e: errs.append('TEL ' + str(e)))
    P.goto(URL); P.wait_for_timeout(500)
    check('téléphone : carte « Retrouver vos tâches de l\'ordinateur » avec Scanner', P.locator('#syncCard').is_visible() and P.locator('[data-synccard="scan"]').is_visible())
    P.screenshot(path=str(OUT / '95-phone-card.png'))
    P.click('[data-synccard="code"]')
    check('saisie : mise en garde contre un code donné par quelqu\'un d\'autre', 'donné par quelqu\'un d\'autre' in P.locator('#syncBody').inner_text())
    wrong = TOKEN[:5] + ('2' if TOKEN[5] != '2' else '3') + TOKEN[6:]
    P.fill('#syncCodeInput', wrong); P.click('[data-sync="join-typed"]'); P.wait_for_timeout(200)
    check('faute de frappe détectée sans appeler le serveur', 'faute de frappe' in P.locator('#syncMsg').inner_text(), P.locator('#syncMsg').inner_text())
    typed = ' '.join([TOKEN[i:i + 3] for i in range(0, 13, 3)]).lower().replace('0', 'o')
    P.fill('#syncCodeInput', typed)
    check('saisie remise en forme (tirets, majuscules, O → 0)', P.locator('#syncCodeInput').input_value() == tok_txt, P.locator('#syncCodeInput').input_value())
    P.click('[data-sync="join-typed"]')
    P.locator('#syncInfo', has_text='tâches').wait_for(timeout=8000)
    check('saisie : confirmation obligatoire, avec le contenu de la liste', P.locator('#dlgSyncTitle', has_text='Connecter cet appareil').is_visible() and '3 tâches' in P.locator('#syncInfo').inner_text() and not P.evaluate("window.__odj.cloud.isOn()"))
    check('… bouton « Connecter » inactif un court instant (on lit avant de cliquer)', P.locator('[data-sync="join-pending"]').is_disabled())
    P.click('[data-sync="join-pending"]')
    P.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=15000)
    wait_js(P, "window.__odj.state().tasks.length === 3", 10000)
    check('téléphone : les 3 tâches du PC arrivent, dans le même ordre', titles(P) == ['Clôture J+3', 'Relancer les achats', 'Point atelier'], titles(P))
    A.locator('#qrState', has_text='Utilisé à').wait_for(timeout=8000)
    check('PC : le QR code indique qu\'il vient de servir (et invite à changer de code si ce n\'est pas vous)', 'Si ce n\'est pas vous' in A.locator('#pairInfo').inner_text() and A.locator('#pairLine').is_hidden())
    A.screenshot(path=str(OUT / '94c-qr-used.png'))
    A.click('#syncFoot [data-sync="cancel"]')
    check('téléphone : proposition d\'activer les notifications', P.locator('#syncBody [data-sync="push"]').count() == 1)
    P.click('#syncBody [data-sync="push"]'); P.wait_for_timeout(600)
    st = server()
    check('téléphone : abonnement aux notifications enregistré', len(st['subs']) == 1 and st['subs'][0]['label'] == 'Téléphone Android', st['subs'])
    P.screenshot(path=str(OUT / '96-phone-done.png'))
    P.click('#syncFoot [data-sync="cancel"]')

    # --- QR code déjà utilisé, puis code bien formé mais inconnu
    P3c = phone_ctx(b); P3 = P3c.new_page(); P3.goto(URL); P3.wait_for_timeout(400)
    P3.evaluate("window.__odj.syncUi.open('enter')")
    P3.fill('#syncCodeInput', TOKEN); P3.click('[data-sync="join-typed"]')
    P3.locator('#syncMsg').wait_for(state='visible', timeout=8000)
    check('QR code déjà utilisé : refusé (usage unique), appareil non connecté', 'déjà servi' in P3.locator('#syncMsg').inner_text() and not P3.evaluate("window.__odj.cloud.isOn()"), P3.locator('#syncMsg').inner_text())
    body = 'ABCDEFGHJKMNPQRSTVW'
    P3.fill('#syncCodeInput', body + P3.evaluate(f"window.__odj.syncCode.check('{body}')")); P3.click('[data-sync="join-typed"]')
    P3.locator('#syncMsg', has_text='valable').wait_for(state='visible', timeout=8000)
    check('code de secours bien formé mais inconnu : message clair, appareil non connecté', 'pas (ou plus) valable' in P3.locator('#syncMsg').inner_text() and not P3.evaluate("window.__odj.cloud.isOn()"), P3.locator('#syncMsg').inner_text())
    check('lien d\'un autre site refusé, lien de l\'application accepté', P3.evaluate(f"window.__odj.parsePairing('https://evil.example/to-do-list/#jumelage={TOKEN}') === null && window.__odj.parsePairing(location.origin + location.pathname + '#jumelage={TOKEN}').kind === 'token'"))
    P3c.close()

    def fresh_token():
        A.evaluate("window.__odj.syncUi.open('show')")
        A.locator('#pairCodeTxt').wait_for(state='visible', timeout=8000)
        t = A.locator('#pairCodeTxt').inner_text().replace('-', '')
        return t

    # --- QR code expiré : remplacé, puis nouveau d'un clic
    S.pair_ttl = 2
    fresh_token(); A.wait_for_timeout(3500)
    A.locator('#qrState', has_text='expiré').wait_for(timeout=8000)
    check('QR code expiré : masqué, « Nouveau QR code » proposé', A.locator('#pairLine').is_hidden() and A.evaluate("document.querySelector('#syncQrWrap').classList.contains('masked')"))
    A.screenshot(path=str(OUT / '94d-qr-expired.png'))
    S.pair_ttl = 600
    A.click('#qrState [data-sync="show"]'); A.locator('#pairCodeTxt').wait_for(state='visible', timeout=8000)
    A.locator('#pairInfo', has_text='expire dans').wait_for(timeout=8000)
    check('… nouveau QR code d\'un clic', 'expire dans' in A.locator('#pairInfo').inner_text())
    A.click('#syncFoot [data-sync="cancel"]')

    # --- lien (QR scanné avec l'appareil photo) : confirmation, puis connecté ; le code disparaît de l'adresse
    # QR code fermé sans avoir servi : annulé aussitôt (une photo prise entre-temps ne sert plus à rien)
    T1 = fresh_token(); A.click('#syncFoot [data-sync="cancel"]'); A.wait_for_timeout(500)
    X = phone_ctx(b); XP = X.new_page(); XP.goto(URL); XP.wait_for_timeout(400)
    XP.evaluate("window.__odj.syncUi.open('enter')"); XP.fill('#syncCodeInput', T1); XP.click('[data-sync="join-typed"]')
    XP.locator('#syncMsg').wait_for(state='visible', timeout=8000)
    check('QR code fermé sans servir : annulé, inutilisable ensuite', 'déjà servi' in XP.locator('#syncMsg').inner_text() and not XP.evaluate("window.__odj.cloud.isOn()"))
    X.close()
    T2 = fresh_token()
    L = phone_ctx(b); LP = L.new_page(); LP.on('pageerror', lambda e: errs.append('LIEN ' + str(e)))
    LP.goto(URL + '#jumelage=' + T2); LP.wait_for_timeout(600)
    check('lien : demande de confirmation avec mise en garde', LP.locator('#dlgSyncTitle', has_text='Connecter cet appareil').is_visible() and 'pas créé cette liste vous-même' in LP.locator('#syncBody').inner_text())
    check('lien : le code est retiré de l\'adresse', '#jumelage' not in LP.url, LP.url)
    LP.locator('#syncInfo', has_text='tâches').wait_for(timeout=8000)
    info = LP.locator('#syncInfo').inner_text()
    check('lien : contenu de la liste visée affiché (date, 3 tâches, 1 appareil)', 'Liste créée le' in info and '3 tâches' in info and '1 appareil' in info, info)
    LP.screenshot(path=str(OUT / '96b-link-confirm.png'))
    LP.click('[data-sync="join-pending"]'); LP.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=15000)
    wait_js(LP, "window.__odj.state().tasks.length === 3", 10000)
    check('lien : appareil connecté, tâches reçues', LP.evaluate("window.__odj.cloud.isOn()") and len(titles(LP)) == 3)
    L.close(); A.click('#syncFoot [data-sync="cancel"]')

    # --- iPhone dans Safari (pas installée) : explique l'installation sans consommer le QR code
    T3 = fresh_token()
    I = phone_ctx(b, ua=IPHONE_UA); IP = I.new_page(); IP.goto(URL + '#jumelage=' + T3); IP.wait_for_timeout(600)
    check('iPhone (Safari) : explique l\'installation sur l\'écran d\'accueil', IP.locator('#dlgSyncTitle', has_text="Installer sur l'iPhone").is_visible() and 'écran d\'accueil' in IP.locator('#syncBody').inner_text())
    check('… le QR code n\'est pas encore consommé', any(not x['taken'] for x in S.pairings.values()))
    IP.screenshot(path=str(OUT / '97-iphone-install.png'))
    IP.click('[data-sync="ios-anyway"]')
    check('iPhone : « Connecter Safari » passe aussi par la confirmation', IP.locator('#dlgSyncTitle', has_text='Connecter cet appareil').is_visible())
    IP.click('[data-sync="join-pending"]'); IP.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=15000)
    wait_js(IP, "window.__odj.state().tasks.length === 3", 10000)
    check('iPhone : « Connecter Safari » fonctionne aussi', len(titles(IP)) == 3)
    I.close(); A.click('#syncFoot [data-sync="cancel"]')

    # --- scanner intégré : caméra factice qui filme le QR code de l'écran du PC
    fresh_token(); qr_png = A.locator('#syncQr').screenshot()
    y4m = SCR / 'qr.y4m'; write_y4m(qr_png, y4m)
    b2 = p.chromium.launch(channel='chromium', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={y4m}'])
    C = phone_ctx(b2, permissions=['camera']); CP = C.new_page(); CP.on('pageerror', lambda e: errs.append('SCAN ' + str(e)))
    CP.goto(URL); CP.wait_for_timeout(500)
    CP.click('[data-synccard="scan"]')
    CP.wait_for_timeout(1500); CP.screenshot(path=str(OUT / '98-scanner.png'))
    try:
        CP.locator('#syncInfo', has_text='tâches').wait_for(timeout=20000)
    except Exception as e:
        print('scan :', CP.locator('#scanState').inner_text() if CP.locator('#scanState').count() else '?')
    check('scanner : le QR code filmé mène à la confirmation (même sans tâches sur l\'appareil)', CP.locator('#dlgSyncTitle', has_text='Connecter cet appareil').is_visible() and not CP.evaluate("window.__odj.cloud.isOn()"))
    check('scanner : caméra coupée après la lecture', CP.evaluate("window.__odj.scanner.stream === null"))
    CP.click('[data-sync="join-pending"]'); CP.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=15000)
    wait_js(CP, "window.__odj.cloud.isOn() && !window.__odj.cloud.running", 15000)
    check('scanner : appareil connecté', len(titles(CP)) == 3, titles(CP))
    C.close(); A.click('#syncFoot [data-sync="cancel"]')
    # fenêtre fermée (Échap) pendant que la caméra s'ouvre : elle doit s'éteindre quand même
    REC = "(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__streams = []; navigator.mediaDevices.getUserMedia = async (c) => { await new Promise(r => setTimeout(r, 700)); const s = await g(c); window.__streams.push(s); return s; }; })();"
    C = phone_ctx(b2, permissions=['camera']); C.add_init_script(REC); EP = C.new_page(); EP.goto(URL); EP.wait_for_timeout(500)
    EP.click('[data-synccard="scan"]'); EP.wait_for_timeout(150); EP.keyboard.press('Escape'); EP.wait_for_timeout(1500)
    live = EP.evaluate("window.__streams.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length")
    check('scanner fermé pendant l\'ouverture de la caméra : caméra éteinte', not EP.locator('#dlgSync').is_visible() and live == 0 and EP.evaluate("window.__odj.scanner.stream === null"), live)
    C.close(); b2.close()
    # appareil qui a déjà des tâches : elles rejoignent la liste après confirmation
    T4 = fresh_token()
    TPc = phone_ctx(b); TP = TPc.new_page(); TP.on('pageerror', lambda e: errs.append('TP ' + str(e))); TP.goto(URL); TP.wait_for_timeout(500)
    TP.fill('#qaInput', 'Tâche perso du téléphone'); TP.press('#qaInput', 'Enter'); TP.wait_for_timeout(300)
    TP.evaluate("window.__odj.syncUi.open('enter')"); TP.fill('#syncCodeInput', T4); TP.click('[data-sync="join-typed"]')
    TP.locator('#syncInfo', has_text='tâches').wait_for(timeout=8000)
    check('appareil avec des tâches : prévenu qu\'elles seront ajoutées', 'y seront ajoutées' in TP.locator('#syncBody').inner_text())
    TP.click('[data-sync="join-pending"]'); TP.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=15000)
    wait_js(TP, "window.__odj.cloud.isOn() && !window.__odj.cloud.running", 15000)
    check('… puis connecté, sa tâche ajoutée à la liste', len(titles(TP)) == 4 and any(i['id'] == TP.evaluate("window.__odj.state().tasks.find(t => t.title === 'Tâche perso du téléphone').id") for i in server()['items']), titles(TP))
    tp_id = TP.evaluate("window.__odj.state().tasks.find(t => t.title === 'Tâche perso du téléphone').id")
    TP.evaluate(f"window.__odj.select('{tp_id}')"); TP.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}))"); TP.wait_for_timeout(2400)
    TPc.close(); A.click('#syncFoot [data-sync="cancel"]')
    # affichée dans un cadre d'un autre site : refuse de s'afficher
    FR = b.new_context(); FP = FR.new_page(); FP.set_content(f'<iframe src="{URL}" width="600" height="400"></iframe>'); FP.wait_for_timeout(1500)
    fr = FP.frames[1]
    check('dans un cadre d\'un autre site : l\'application refuse de s\'afficher', 'propre onglet' in fr.inner_text('body') and fr.locator('#app').count() == 0, fr.inner_text('body')[:80])
    FR.close()

    # --- modifications dans les deux sens
    P.fill('#qaInput', 'Noté dans le train'); P.press('#qaInput', 'Enter'); P.wait_for_timeout(2200)
    sync_now(A)
    check('téléphone → PC : nouvelle tâche reçue', 'Noté dans le train' in titles(A), titles(A))
    A.locator('#list .row', has_text='Point atelier').click()
    A.locator('#dTitle').click(); A.keyboard.press('End'); A.keyboard.type(' (salle B)'); A.wait_for_timeout(2200)
    sync_now(P)
    check('PC → téléphone : titre modifié', 'Point atelier (salle B)' in titles(P), titles(P))
    P.evaluate("(() => { const t = window.__odj.state().tasks.find(t => t.title === 'Relancer les achats'); window.__odj.select(t.id); })()")
    P.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}))"); P.wait_for_timeout(2200)
    sync_now(A)
    check('suppression sur le téléphone → disparue sur le PC', 'Relancer les achats' not in titles(A), titles(A))
    A.keyboard.press('Escape'); A.locator('#list .row', has_text='Clôture J+3').click(); A.locator('#list').focus(); A.keyboard.press('Delete'); A.wait_for_timeout(300)
    A.keyboard.press('Control+z'); A.wait_for_timeout(2200)
    sync_now(P)
    check('PC : supprimer puis annuler → la tâche reste sur le téléphone', 'Clôture J+3' in titles(P), titles(P))
    S.down = True
    A.fill('#qaInput', 'Hors ligne PC'); A.press('#qaInput', 'Enter')
    P.fill('#qaInput', 'Hors ligne téléphone'); P.press('#qaInput', 'Enter')
    A.wait_for_timeout(2600)
    check('hors ligne : message clair, rien de perdu', 'Hors ligne' in A.locator('#status').inner_text(), A.locator('#status').inner_text())
    S.down = False
    A.evaluate("window.dispatchEvent(new Event('online'))"); P.evaluate("window.dispatchEvent(new Event('online'))"); A.wait_for_timeout(1500)
    sync_now(A); sync_now(P); sync_now(A)
    check('retour du réseau : les deux ajouts sont partout', {'Hors ligne PC', 'Hors ligne téléphone'} <= set(titles(A)) and set(titles(A)) == set(titles(P)), (titles(A), titles(P)))
    A.evaluate("window.__odj.setSetting('remindTime', '08:30')"); A.wait_for_timeout(2200)
    sync_now(P)
    check('réglage « heure par défaut » partagé', P.evaluate("window.__odj.state().settings.remindTime") == '08:30')

    # --- éléments fabriqués sans la clé de chiffrement (serveur malveillant) : ignorés
    ACCESS = A.evaluate(f"window.__odj.syncCode.keys('{CODE}').then(k => k.access)")
    def rpc(fn, args):
        req = urllib.request.Request(API + '/rest/v1/rpc/' + fn, data=json.dumps(args).encode(), headers={'apikey': 'sb_publishable_test', 'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req) as r: return r.status, (json.loads(r.read() or b'null'))
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
    ids = A.evaluate("Object.fromEntries(window.__odj.state().tasks.map(t => [t.title, t.id]))")
    st = server(); src_row = next(i for i in st['items'] if i['id'] == ids['Noté dans le train'])
    soon = int(time.time() * 1000) + 1500
    rpc('push_items', {'p_key': ACCESS, 'p_rows': [
        {'id': ids['Point atelier (salle B)'], 'updated_at': soon, 'deleted': True, 'data': None},
        {'id': ids['Clôture J+3'], 'updated_at': soon, 'deleted': False, 'data': src_row['data']}]})
    sync_now(A); sync_now(P)
    check('suppression fabriquée sans la clé : ignorée', 'Point atelier (salle B)' in titles(A) and 'Point atelier (salle B)' in titles(P), titles(A))
    check('contenu d\'une autre tâche recopié sous un autre identifiant : ignoré', 'Clôture J+3' in titles(A) and titles(A).count('Noté dans le train') == 1, titles(A))
    A.wait_for_timeout(1600)
    # --- serveur qui refuse un envoi puis renvoie une ancienne version authentique (et des éléments non demandés) : ignorés
    n_before = len(titles(A))
    old_row = dict(next(i for i in server()['items'] if i['id'] == ids['Noté dans le train']))
    settings_row = dict(next(i for i in server()['items'] if i['id'] == '__settings'))
    A.locator('#list .row', has_text='Noté dans le train').click()
    A.locator('#dTitle').fill('Noté dans le train (v2)'); A.locator('#dTitle').dispatch_event('input'); A.wait_for_timeout(2400); sync_now(A)
    S.reject_ids = {ids['Noté dans le train']}; S.evil_get = [old_row, settings_row, {**old_row, 'id': 'pas-demande'}]
    A.locator('#dTitle').fill('Noté dans le train (v3)'); A.locator('#dTitle').dispatch_event('input'); A.wait_for_timeout(2400); sync_now(A)
    S.reject_ids = set(); S.evil_get = None
    check('ancienne version rejouée par le serveur après un refus : ignorée (ni retour en arrière, ni tâche ajoutée)', 'Noté dans le train (v3)' in titles(A) and 'Noté dans le train' not in titles(A) and len(titles(A)) == n_before, titles(A))
    A.keyboard.press('Escape'); sync_now(A); sync_now(P)
    check('… et la bonne version repart au prochain envoi', 'Noté dans le train (v3)' in titles(P), titles(P))

    # --- rappels : planning chiffré envoyé au serveur, notification déchiffrée sur le téléphone
    A.locator('#list .row', has_text='Clôture J+3').click()
    A.locator('[data-rem="1h"]').click(); A.wait_for_timeout(2400)
    rem = server()['reminders']
    tid = A.evaluate("window.__odj.state().tasks.find(t => t.title === 'Clôture J+3').id")
    check('rappel planifié côté serveur, texte chiffré', len(rem) == 1 and rem[0]['task_id'] == tid and 'Clôture' not in rem[0]['payload'], rem)
    sync_now(P)
    cdp = ph.new_cdp_session(P)
    regs_list = []
    cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: regs_list.extend([r for r in e['registrations'] if r['scopeURL'].endswith('/to-do-list/') and not r.get('isDeleted')]))
    cdp.send('ServiceWorker.enable'); P.wait_for_timeout(600)
    payload = json.dumps({'t': tid, 'c': rem[0]['payload'], 'at': int(time.time() * 1000)})
    cdp.send('ServiceWorker.deliverPushMessage', {'origin': 'http://127.0.0.1:8790', 'registrationId': regs_list[0]['registrationId'], 'data': payload})
    P.wait_for_timeout(800)
    notes = P.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => ({title: n.title, body: n.body, tag: n.tag})))")
    check('notification push déchiffrée sur le téléphone (titre de la tâche)', any(n['title'] == 'Clôture J+3' and n['tag'] == f'odj-{tid}' for n in notes), notes)
    cdp.send('ServiceWorker.deliverPushMessage', {'origin': 'http://127.0.0.1:8790', 'registrationId': regs_list[0]['registrationId'], 'data': json.dumps({'t': 'x', 'c': 'v1.AAAA.BBBB'})})
    P.wait_for_timeout(600)
    notes = P.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => n.title))")
    check('message indéchiffrable : notification générique « Rappel »', 'Rappel' in notes, notes)
    old = P.evaluate(f"window.__odj.vault.encrypt(window.__odj.cloud.key, {{ title: 'Ancien rappel', body: 'x', at: Date.now() - 3 * 864e5 }}, 'rem:{tid}')")
    cdp.send('ServiceWorker.deliverPushMessage', {'origin': 'http://127.0.0.1:8790', 'registrationId': regs_list[0]['registrationId'], 'data': json.dumps({'t': tid, 'c': old})})
    P.wait_for_timeout(600)
    notes = P.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => n.title))")
    check('ancien rappel rejoué par le serveur : texte non affiché (notification générique)', 'Ancien rappel' not in notes, notes)
    A.locator('#dDone').check(); A.wait_for_timeout(2400)
    check('tâche terminée : rappel retiré du serveur', len(server()['reminders']) == 0, server()['reminders'])

    # --- rechargement : reste connecté indéfiniment, sans rien ressaisir
    P.reload(); P.wait_for_timeout(800)
    wait_js(P, "!window.__odj.cloud.running", 10000)
    check('téléphone rechargé : toujours synchronisé, rien à ressaisir', P.evaluate("window.__odj.cloud.status") == 'ready' and len(titles(P)) >= 4)

    # --- horloge d'un appareil en avance
    A.fill('#qaInput', 'Budget'); A.press('#qaInput', 'Enter'); A.wait_for_timeout(2200); sync_now(P)
    A.evaluate("(() => { const s = window.__odj.state(); const t = s.tasks.find(x => x.title === 'Budget'); t.title = 'Budget PC'; t.updatedAt = Date.now() + 3600000; })()")
    sync_now(A)
    P.evaluate("(() => { const s = window.__odj.state(); const t = s.tasks.find(x => x.title.startsWith('Budget')); t.title = 'Budget TEL'; t.updatedAt = Date.now(); })()")
    sync_now(P)
    tP = P.evaluate("window.__odj.state().tasks.find(x => x.title.startsWith('Budget')).title"); tA = A.evaluate("window.__odj.state().tasks.find(x => x.title.startsWith('Budget')).title")
    check('horloge décalée : envoi refusé puis version du serveur reprise, appareils identiques', tP == tA == 'Budget PC', (tP, tA))
    P.locator('#list .row', has_text='Budget PC').click(); P.locator('#dTitle').fill('Budget final'); P.locator('#dTitle').dispatch_event('input'); P.wait_for_timeout(2200)
    sync_now(A)
    check('… et la modification suivante sur l\'appareil en retard l\'emporte bien', 'Budget final' in titles(A), titles(A))
    P.keyboard.press('Escape'); P.wait_for_timeout(300)
    A.fill('#qaInput', 'Tâche PC à annuler'); A.press('#qaInput', 'Enter')
    P.fill('#qaInput', 'Ajout téléphone à garder'); P.press('#qaInput', 'Enter'); P.wait_for_timeout(2200)
    sync_now(A)
    A.locator('#list').focus(); A.keyboard.press('Control+z'); A.wait_for_timeout(2400); sync_now(P)
    check('Ctrl+Z après réception : l\'ajout du téléphone reste partout', 'Ajout téléphone à garder' in titles(A) and 'Ajout téléphone à garder' in titles(P), (titles(A), titles(P)))
    # --- report d'un rappel
    A.locator('#list .row', has_text='Point atelier').click(); A.locator('[data-rem="1h"]').click(); A.wait_for_timeout(2400)
    tid2 = A.evaluate("window.__odj.state().tasks.find(t => t.title.startsWith('Point atelier')).id")
    A.evaluate(f"(() => {{ const t = window.__odj.state().tasks.find(x => x.id === '{tid2}'); t.remind.fired = true; t.remind.firedAt = Date.now(); window.__odj.reminders.refresh(); }})()")
    A.wait_for_timeout(200); A.locator('#rcards [data-ract="snz:tomorrow"]').first.click(); A.wait_for_timeout(2400)
    rr = [r for r in server()['reminders'] if r['task_id'] == tid2]
    snz = A.evaluate(f"window.__odj.state().tasks.find(x => x.id === '{tid2}').remind.snooze")
    check('report : nouvelle heure envoyée au serveur', rr and rr[0]['fire_at'] == snz, (rr, snz))
    sync_now(P)
    check('report : synchronisé sur le téléphone', P.evaluate(f"window.__odj.state().tasks.find(x => x.id === '{tid2}').remind.snooze") == snz)
    # --- répétition terminée sur les deux appareils hors ligne
    A.keyboard.press('Escape')
    A.fill('#qaInput', 'Hebdo double'); A.press('#qaInput', 'Enter'); A.wait_for_timeout(300)
    A.locator('#list .row', has_text='Hebdo double').click(); A.locator('#dRepeat').select_option('weekly'); A.wait_for_timeout(2400); sync_now(P)
    S.down = True
    for pg in (A, P):
        pg.evaluate("(() => { const t = window.__odj.state().tasks.find(x => x.title === 'Hebdo double' && !x.done); window.__odj.select(t.id); })()")
        pg.evaluate("document.querySelector('#dDone') && (document.querySelector('#dDone').click())")
    A.wait_for_timeout(500); S.down = False
    sync_now(A); sync_now(P); sync_now(A)
    n_open = A.evaluate("window.__odj.state().tasks.filter(x => x.title === 'Hebdo double' && !x.done).length")
    check('répétition terminée sur 2 appareils hors ligne : une seule occurrence suivante', n_open == 1, n_open)
    A.keyboard.press('Escape')
    A.fill('#qaInput', 'é' * 480 + ' @demain @9h'); A.press('#qaInput', 'Enter'); A.wait_for_timeout(2400)
    check('titre très long avec rappel : synchronisation sans erreur', A.evaluate("window.__odj.cloud.status") == 'ready', A.evaluate("window.__odj.cloud.error"))
    # --- deux fenêtres sur le PC
    A2 = pc.new_page(); A2.goto(URL); A2.wait_for_timeout(800); wait_js(A2, "!window.__odj.cloud.running", 10000)
    sync_now(A); sync_now(A2)
    check('deux fenêtres : toutes deux synchronisées', A.evaluate("window.__odj.cloud.status") == 'ready' and A2.evaluate("window.__odj.cloud.status") == 'ready')
    A.evaluate("window.__odj.cloud.sync()"); A.fill('#qaInput', 'Pendant la synchro'); A.press('#qaInput', 'Enter'); A.wait_for_timeout(2600)
    wait_js(A, "!window.__odj.cloud.running", 10000)
    sync_now(P)
    check('ajout pendant une synchronisation : bien envoyé', 'Pendant la synchro' in titles(P), titles(P))
    # --- beaucoup de tâches : pages complètes
    A.evaluate("(() => { const s = window.__odj.state(); const now = Date.now(); for (let i = 0; i < 1050; i++) s.tasks.push({ id: 'bulk-' + String(i).padStart(4, '0'), title: 'Lot ' + i, notes: '', steps: [], done: false, doneAt: null, position: 1000 + i, due: null, repeat: null, createdAt: now, updatedAt: now + i, spawnedId: null, seriesId: null, remind: null, matrix: { important: null, urgent: null } }); })()")
    sync_now(A)
    P2 = ph.new_page(); P2.goto(URL); P2.wait_for_timeout(500)
    P2.evaluate("window.__odj.cloud.st.cursor = null; window.__odj.cloud.save()")
    sync_now(P2)
    nb = P2.evaluate("window.__odj.state().tasks.filter(t => t.id.startsWith('bulk-')).length")
    check('1 050 tâches : tout est relu, page par page', nb == 1050, nb)
    P2.close()

    # --- changer de code (téléphone perdu) : les autres appareils sont déconnectés et n'envoient plus rien
    A2.click('#btnSettings'); A2.click('[data-syncset="change"]')
    check('changer de code : avertissement clair', 'Tous vos autres appareils seront déconnectés' in A2.locator('#syncBody').inner_text())
    S.fail = {'delete_account'}  # le retrait de l'ancien code échoue une première fois
    A2.click('[data-sync="change-go"]')
    A2.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=20000)
    NEW = A2.evaluate("window.__odj.cloud.st.code")
    check('nouveau code différent', NEW != CODE)
    st = server()
    check('retrait de l\'ancien code en échec : gardé en attente, tâches déjà sur le nouveau', len(st['accounts']) == 2 and A2.evaluate("window.__odj.cloud.st.retire.length") == 1 and A2.evaluate("window.__odj.cloud.status") == 'ready')
    S.fail = set(); sync_now(A2)
    st = server()
    check('… retiré à la synchronisation suivante : un seul compte', len(st['accounts']) == 1 and A2.evaluate("window.__odj.cloud.st.retire.length") == 0 and len(st['retired']) == 1)
    check('ancien code retiré : impossible de le recréer', rpc('create_account', {'p_key': ACCESS})[1].get('message') == 'code retiré')
    A2.click('#syncFoot [data-sync="cancel"]'); A2.close()
    A.wait_for_timeout(300); sync_now(A)
    check('autre fenêtre du PC : passe au nouveau code toute seule', A.evaluate("window.__odj.cloud.st.code") == NEW and A.evaluate("window.__odj.cloud.status") == 'ready', A.evaluate("window.__odj.cloud.status"))
    P.fill('#qaInput', 'Après le changement de code'); P.press('#qaInput', 'Enter'); P.wait_for_timeout(2600)
    st = server()
    check('téléphone : déconnecté, invite à scanner le nouveau QR code', P.evaluate("window.__odj.cloud.isDead()") and 'nouveau QR code' in P.locator('#status').inner_text(), P.locator('#status').inner_text())
    check('… et rien envoyé (ancien code refusé)', all(i['id'] != P.evaluate("window.__odj.state().tasks.find(t=>t.title==='Après le changement de code').id") for i in st['items']))
    P.goto(URL + '#lien=' + NEW); P.wait_for_timeout(700)
    P.locator('#syncInfo', has_text='tâches').wait_for(timeout=8000)
    P.click('[data-sync="join-pending"]'); P.locator('#dlgSyncTitle', has_text='Ajouter un appareil').wait_for(timeout=20000)
    wait_js(P, "!window.__odj.cloud.running", 10000); P.click('#syncFoot [data-sync="cancel"]')
    sync_now(A)
    check('téléphone rescanné : sa tâche hors code est fusionnée et arrive sur le PC', 'Après le changement de code' in titles(A), titles(A)[:5])
    check('téléphone rescanné : notifications réabonnées au nouveau code', any(s['label'] == 'Téléphone Android' for s in server()['subs']), server()['subs'])
    # --- déconnexion
    P.click('#btnSettings'); P.click('[data-syncset="signout"]'); P.click('#dlgConfirm [data-choice="ok"]'); P.wait_for_timeout(700)
    check('déconnexion : tâches gardées sur l\'appareil, abonnement retiré', len(titles(P)) >= 4 and not P.evaluate("window.__odj.cloud.isOn()") and not any(s['label'] == 'Téléphone Android' for s in server()['subs']))
    F = pc.new_page(); F.goto((SCR / 'build/to-do-list.html').as_uri()); F.wait_for_timeout(300)
    F.click('#btnSettings')
    check('version fichier : pas de synchronisation (aucune connexion possible)', not F.locator('#setSyncSec').is_visible())
    b.close()
finally:
    web.terminate(); fake.shutdown()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
