# Synchronisation PC <-> téléphone avec un faux serveur Supabase
import pathlib, subprocess, sys, time, json, os, shutil, urllib.request, base64
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from fake.supabase import start, S
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path('/home/claude/ordre-du-jour')
SCR = pathlib.Path('/tmp/claude-0/-home-claude/59fdc690-8e41-50a4-81b9-8a7023412a59/scratchpad/synctest')
OUT = pathlib.Path('/tmp/claude-0/-home-claude/59fdc690-8e41-50a4-81b9-8a7023412a59/scratchpad/shots')
API = 'http://127.0.0.1:8791'
shutil.rmtree(SCR, ignore_errors=True); (SCR / 'site').mkdir(parents=True)
env = dict(os.environ, CLOUD_URL=API, CLOUD_KEY='anon-test', OUT_DIR=str(SCR / 'build'))
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
    const fake = { endpoint: 'https://push.example/' + Math.random().toString(36).slice(2), toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPk', auth: 'au' } }; }, unsubscribe: async () => true };
    let cur = null;
    if (self.PushManager) {
      PushManager.prototype.subscribe = async function () { cur = fake; return fake; };
      PushManager.prototype.getSubscription = async function () { return cur; };
    }
  })();
"""
def sync_now(pg):
    pg.evaluate("window.__odj.cloud.sync()"); pg.wait_for_timeout(400)
    pg.wait_for_function("!window.__odj.cloud.running", timeout=8000)

def connect(pg, pass_, first=False, wrong=None):
    pg.locator('#dlgSync').wait_for(state='visible')
    pg.fill('#syncEmail', 'kostadin@example.com'); pg.click('[data-sync="send"]')
    pg.locator('#syncCode').wait_for()
    code = server()['codes']['kostadin@example.com']
    pg.fill('#syncCode', '000000'); pg.click('[data-sync="verify"]'); pg.wait_for_timeout(300)
    bad_code = pg.locator('#syncMsg').inner_text()
    pg.fill('#syncCode', code); pg.click('[data-sync="verify"]')
    pg.locator('#syncPass').wait_for()
    if first:
        pg.fill('#syncPass', 'court'); pg.fill('#syncPass2', 'court'); pg.click('[data-sync="create"]')
        short = pg.locator('#syncMsg').inner_text()
        pg.fill('#syncPass', pass_); pg.fill('#syncPass2', pass_); pg.click('[data-sync="create"]')
        need_check = pg.locator('#syncMsg').inner_text()
        pg.check('#syncNoted'); pg.click('[data-sync="create"]')
        return bad_code, short, need_check
    if wrong:
        pg.fill('#syncPass', wrong); pg.click('[data-sync="unlock"]'); pg.locator('#syncMsg').wait_for(state='visible', timeout=10000)
        wrong_msg = pg.locator('#syncMsg').inner_text()
        pg.fill('#syncPass', pass_); pg.click('[data-sync="unlock"]')
        return bad_code, wrong_msg

PASS = 'cheval batterie agrafe correcte'
try:
  with sync_playwright() as p:
    b = p.chromium.launch(channel='chromium')  # nouveau mode sans écran : notifications disponibles
    pc = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width': 1366, 'height': 820})
    pc.add_init_script(PUSH_MOCK)
    ph = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                       user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36')
    ph.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;" + PUSH_MOCK)
    ph.grant_permissions(['notifications'], origin='http://127.0.0.1:8790')
    A = pc.new_page(); A.on('pageerror', lambda e: errs.append('PC ' + str(e)))
    A.goto(URL); A.wait_for_timeout(500)
    for t in ['Clôture J+3', 'Relancer les achats', 'Point atelier']:
        A.fill('#qaInput', t); A.press('#qaInput', 'Enter')
    A.click('#btnSettings')
    check('PC : section Synchronisation dans les réglages', A.locator('#setSyncSec').is_visible())
    A.click('[data-syncset="open"]')
    bad_code, short, need_check = connect(A, PASS, first=True)
    check('code faux refusé avec un message clair', 'incorrect ou expiré' in bad_code, bad_code)
    check('phrase trop courte refusée', '12 caractères' in short, short)
    check('confirmation « j\'ai noté » exigée', 'Cochez' in need_check, need_check)
    A.locator('#dlgSyncTitle', has_text="C'est prêt").wait_for(timeout=15000)
    A.screenshot(path=str(OUT / '90-sync-done.png'))
    check('PC : QR code pour ajouter le téléphone', A.locator('#syncQr svg').count() == 1)
    A.click('#syncFoot [data-sync="cancel"]')
    A.wait_for_function("!window.__odj.cloud.running", timeout=8000)
    st = server()
    items = [i for i in st['items'] if i['id'] != '__settings']
    check('serveur : 3 tâches envoyées', len(items) == 3, len(items))
    blob = json.dumps(st)
    check('serveur : aucun texte en clair (chiffré de bout en bout)', all(w not in blob for w in ['Clôture', 'Relancer', 'atelier', PASS]))
    check('serveur : coffre créé (sel + vérificateur)', len(st['vault']) == 1)
    check('PC : barre d\'état « Synchronisé »', 'Synchronisé' in A.locator('#status').inner_text(), A.locator('#status').inner_text())

    # --- téléphone
    P = ph.new_page(); P.on('pageerror', lambda e: errs.append('TEL ' + str(e)))
    P.goto(URL); P.wait_for_timeout(500)
    check('téléphone : carte « Retrouver vos tâches de l\'ordinateur »', P.locator('#syncCard').is_visible())
    P.screenshot(path=str(OUT / '91-phone-card.png'))
    P.click('[data-synccard="go"]')
    _, wrong_msg = connect(P, PASS, wrong='mauvaise phrase secrète')
    check('téléphone : mauvaise phrase secrète refusée', 'incorrecte' in wrong_msg, wrong_msg)
    P.locator('#dlgSyncTitle', has_text="C'est prêt").wait_for(timeout=15000)
    P.wait_for_function("window.__odj.state().tasks.length === 3", timeout=8000)
    check('téléphone : les 3 tâches du PC arrivent, dans le même ordre', titles(P) == ['Clôture J+3', 'Relancer les achats', 'Point atelier'], titles(P))
    check('téléphone : proposition d\'activer les notifications', P.locator('#syncBody [data-sync="push"]').count() == 1)
    P.click('#syncBody [data-sync="push"]'); P.wait_for_timeout(500)
    st = server()
    check('téléphone : abonnement aux notifications enregistré', len(st['subs']) == 1 and st['subs'][0]['label'] == 'Téléphone Android', st['subs'])
    P.screenshot(path=str(OUT / '92-phone-done.png'))
    P.click('#syncFoot [data-sync="cancel"]')

    # --- modifications dans les deux sens
    P.fill('#qaInput', 'Noté dans le train'); P.press('#qaInput', 'Enter'); P.wait_for_timeout(2200)
    sync_now(A)
    check('téléphone → PC : nouvelle tâche reçue', 'Noté dans le train' in titles(A), titles(A))
    A.locator('#list .row', has_text='Point atelier').click()
    A.locator('#dTitle').click(); A.keyboard.press('End'); A.keyboard.type(' (salle B)'); A.wait_for_timeout(2200)
    sync_now(P)
    check('PC → téléphone : titre modifié', 'Point atelier (salle B)' in titles(P), titles(P))
    # suppression sur le téléphone, puis annulation sur le PC d'une autre suppression
    P.evaluate("(() => { const t = window.__odj.state().tasks.find(t => t.title === 'Relancer les achats'); window.__odj.select(t.id); })()")
    P.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}))"); P.wait_for_timeout(2200)
    sync_now(A)
    check('suppression sur le téléphone → disparue sur le PC', 'Relancer les achats' not in titles(A), titles(A))
    A.keyboard.press('Escape'); A.locator('#list .row', has_text='Clôture J+3').click(); A.locator('#list').focus(); A.keyboard.press('Delete'); A.wait_for_timeout(300)
    A.keyboard.press('Control+z'); A.wait_for_timeout(2200)
    sync_now(P)
    check('PC : supprimer puis annuler → la tâche reste sur le téléphone', 'Clôture J+3' in titles(P), titles(P))
    # modifications simultanées hors connexion sur deux tâches différentes
    S.down = True
    A.fill('#qaInput', 'Hors ligne PC'); A.press('#qaInput', 'Enter')
    P.fill('#qaInput', 'Hors ligne téléphone'); P.press('#qaInput', 'Enter')
    A.wait_for_timeout(2600)
    check('hors ligne : message clair, rien de perdu', 'Hors ligne' in A.locator('#status').inner_text(), A.locator('#status').inner_text())
    S.down = False
    A.evaluate("window.dispatchEvent(new Event('online'))"); P.evaluate("window.dispatchEvent(new Event('online'))"); A.wait_for_timeout(1500)
    sync_now(A); sync_now(P); sync_now(A)
    check('retour du réseau : les deux ajouts sont partout', {'Hors ligne PC', 'Hors ligne téléphone'} <= set(titles(A)) and set(titles(A)) == set(titles(P)), (titles(A), titles(P)))
    # réglage partagé
    A.evaluate("window.__odj.setSetting('remindTime', '08:30')"); A.wait_for_timeout(2200)
    sync_now(P)
    check('réglage « heure par défaut » partagé', P.evaluate("window.__odj.state().settings.remindTime") == '08:30')

    # --- rappels : planning chiffré envoyé au serveur, notification déchiffrée sur le téléphone
    A.locator('#list .row', has_text='Clôture J+3').click()
    A.locator('[data-rem="1h"]').click(); A.wait_for_timeout(2400)
    st = server()
    rem = [r for r in st['reminders']]
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
    # message illisible (autre clé) : notification générique, pas d'erreur
    cdp.send('ServiceWorker.deliverPushMessage', {'origin': 'http://127.0.0.1:8790', 'registrationId': regs_list[0]['registrationId'], 'data': json.dumps({'t': 'x', 'c': 'v1.AAAA.BBBB'})})
    P.wait_for_timeout(600)
    notes = P.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => n.title))")
    check('message indéchiffrable : notification générique « Rappel »', 'Rappel' in notes, notes)
    # tâche terminée → rappel retiré du serveur
    A.locator('#dDone').check(); A.wait_for_timeout(2400)
    check('tâche terminée : rappel retiré du serveur', len(server()['reminders']) == 0, server()['reminders'])

    # --- session : renouvellement automatique du jeton
    n_before = len([c for c in server()['calls'] if c[1] == '/auth/v1/token'])
    A.evaluate("(() => { const c = window.__odj.cloud; c.st.session.expires_at = Date.now(); c.save(); })()")
    sync_now(A)
    n_after = len([c for c in server()['calls'] if c[1] == '/auth/v1/token'])
    check('jeton expiré : renouvelé tout seul', n_after == n_before + 1 and A.evaluate("window.__odj.cloud.status") == 'ready')
    # rechargement : reste connecté, clé conservée
    P.reload(); P.wait_for_timeout(800)
    P.wait_for_function("!window.__odj.cloud.running", timeout=8000)
    check('téléphone rechargé : toujours synchronisé, sans ressaisir la phrase', P.evaluate("window.__odj.cloud.status") == 'ready' and len(titles(P)) >= 4)

    # --- relecture : horloge d'un appareil en avance, l'autre modifie après → la modification la plus récente gagne partout
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
    # --- annulation après une synchronisation : ne défait pas le travail de l'autre appareil
    A.fill('#qaInput', 'Tâche PC à annuler'); A.press('#qaInput', 'Enter')
    P.fill('#qaInput', 'Ajout téléphone à garder'); P.press('#qaInput', 'Enter'); P.wait_for_timeout(2200)
    sync_now(A)
    A.locator('#list').focus(); A.keyboard.press('Control+z'); A.wait_for_timeout(2400); sync_now(P)
    check('Ctrl+Z après réception : l\'ajout du téléphone reste partout', 'Ajout téléphone à garder' in titles(A) and 'Ajout téléphone à garder' in titles(P), (titles(A), titles(P)))
    # --- report d'un rappel : synchronisé et transmis au serveur
    A.locator('#list .row', has_text='Point atelier').click(); A.locator('[data-rem="1h"]').click(); A.wait_for_timeout(2400)
    tid2 = A.evaluate("window.__odj.state().tasks.find(t => t.title.startsWith('Point atelier')).id")
    A.evaluate(f"(() => {{ const t = window.__odj.state().tasks.find(x => x.id === '{tid2}'); t.remind.fired = true; t.remind.firedAt = Date.now(); window.__odj.reminders.refresh(); }})()")
    A.wait_for_timeout(200); A.locator('#rcards [data-ract="snz:tomorrow"]').first.click(); A.wait_for_timeout(2400)
    rr = [r for r in server()['reminders'] if r['task_id'] == tid2]
    snz = A.evaluate(f"window.__odj.state().tasks.find(x => x.id === '{tid2}').remind.snooze")
    check('report : nouvelle heure envoyée au serveur', rr and rr[0]['fire_at'] == snz, (rr, snz))
    sync_now(P)
    check('report : synchronisé sur le téléphone', P.evaluate(f"window.__odj.state().tasks.find(x => x.id === '{tid2}').remind.snooze") == snz)
    # --- tâche répétée terminée sur les deux appareils hors ligne : une seule occurrence suivante
    A.keyboard.press('Escape')
    A.fill('#qaInput', 'Hebdo double'); A.press('#qaInput', 'Enter'); A.wait_for_timeout(300)
    A.locator('#list .row', has_text='Hebdo double').click(); A.locator('#dRepeat').select_option('weekly'); A.wait_for_timeout(2400); sync_now(P)
    S.down = True
    for pg in (A, P):
        pg.evaluate("(() => { const t = window.__odj.state().tasks.find(x => x.title === 'Hebdo double' && !x.done); document.querySelector('#app'); window.__odj.select(t.id); })()")
        pg.evaluate("document.querySelector('#dDone') && (document.querySelector('#dDone').click())")
    A.wait_for_timeout(500); S.down = False
    sync_now(A); sync_now(P); sync_now(A)
    n_open = A.evaluate("window.__odj.state().tasks.filter(x => x.title === 'Hebdo double' && !x.done).length")
    check('répétition terminée sur 2 appareils hors ligne : une seule occurrence suivante', n_open == 1, n_open)
    # --- très longue tâche avec rappel : ne bloque pas la synchronisation des rappels
    A.keyboard.press('Escape')
    A.fill('#qaInput', 'é' * 480 + ' @demain @9h'); A.press('#qaInput', 'Enter'); A.wait_for_timeout(2400)
    check('titre très long avec rappel : synchronisation sans erreur', A.evaluate("window.__odj.cloud.status") == 'ready', A.evaluate("window.__odj.cloud.error"))
    # --- deux fenêtres sur le PC : pas de déconnexion mutuelle
    A2 = pc.new_page(); A2.goto(URL); A2.wait_for_timeout(800); A2.wait_for_function("!window.__odj.cloud.running", timeout=8000)
    A.evaluate("(() => { const c = window.__odj.cloud; c.st.session.expires_at = Date.now(); c.save(); })()")
    sync_now(A); sync_now(A2)
    check('deux fenêtres : renouvellement partagé, aucune déconnexion', A.evaluate("window.__odj.cloud.status") == 'ready' and A2.evaluate("window.__odj.cloud.status") == 'ready', (A.evaluate("window.__odj.cloud.status"), A2.evaluate("window.__odj.cloud.status")))
    A2.close()
    # --- modification faite pendant une synchronisation : envoyée quand même
    A.evaluate("window.__odj.cloud.sync()"); A.fill('#qaInput', 'Pendant la synchro'); A.press('#qaInput', 'Enter'); A.wait_for_timeout(2600)
    A.wait_for_function("!window.__odj.cloud.running", timeout=8000)
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
    # --- phrase secrète changée sur un appareil : l'autre se bloque au lieu d'envoyer avec l'ancienne clé
    A.evaluate("window.__odj.cloud.resetCloud()"); A.wait_for_timeout(500)
    A.evaluate(f"window.__odj.cloud.unlock('nouvelle phrase secrète solide', null)"); A.wait_for_timeout(2500)
    A.wait_for_function("!window.__odj.cloud.running", timeout=15000)
    P.fill('#qaInput', 'Après changement de phrase'); P.press('#qaInput', 'Enter'); P.wait_for_timeout(2600)
    st = server()
    check('autre appareil : bloqué, demande la nouvelle phrase', P.evaluate("window.__odj.cloud.status") == 'locked', P.evaluate("window.__odj.cloud.status"))
    check('… et n\'a rien envoyé avec l\'ancienne clé', 'Après changement de phrase' not in json.dumps(st) and all(i['id'] != P.evaluate("window.__odj.state().tasks.find(t=>t.title==='Après changement de phrase').id") for i in st['items']))
    # déconnexion
    P.click('#btnSettings'); P.click('[data-syncset="signout"]'); P.click('#dlgConfirm [data-choice="ok"]'); P.wait_for_timeout(600)
    dbg = (len(titles(P)), P.evaluate("window.__odj.cloud.isOn()"), server()['subs'], P.evaluate("JSON.stringify(window.__odj.cloud.st)"))
    check('déconnexion : tâches gardées sur l\'appareil, abonnement retiré', dbg[0] >= 4 and dbg[1] is False and len(dbg[2]) == 0, dbg)
    # le fichier unique (sans Internet) n'expose rien de tout ça
    F = pc.new_page(); F.goto((SCR / 'build/to-do-list.html').as_uri()); F.wait_for_timeout(300)
    F.click('#btnSettings')
    check('version fichier : pas de synchronisation (aucune connexion possible)', not F.locator('#setSyncSec').is_visible())
    b.close()
finally:
    web.terminate(); fake.shutdown()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
