# Onglet Récurrentes : les tâches répétées sont rangées jusqu'à leur échéance
import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS, BUILD, test_build
from playwright.sync_api import sync_playwright
URL = (BUILD / 'to-do-list.html').as_uri()
OUT = SHOTS
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ('' if c else f' — {i}'))
SEED = """() => {
 const day=86400000, now=Date.now(), T=(o)=>Object.assign({id:crypto.randomUUID(),notes:'',steps:[],done:false,doneAt:null,due:null,repeat:null,createdAt:now-5*day,updatedAt:now-5*day},o);
 const tasks=[
  T({title:'Tâche normale',position:0}),
  T({title:'Point hebdo du lundi',position:1,due:'2026-10-26',repeat:{type:'weekly',wd:1}}),
  T({title:'Clôture mensuelle',position:2,due:'2026-11-05',repeat:{type:'monthly',dom:5},remind:{date:'2026-11-04',time:'17:00',fired:false,ack:false,snooze:null,firedAt:null}}),
  T({title:'Rapport du mardi',position:3,due:'2026-10-20',repeat:{type:'weekly',wd:2}}),
  T({title:'Préparer le jeudi',position:4,due:'2026-10-22',repeat:{type:'weekly',wd:4},remind:{date:'2026-10-20',time:'07:00',fired:true,ack:true,snooze:null,firedAt:Date.now()-3600000}}),
  T({title:'Échéance simple dans 5 jours',position:5,due:'2026-10-25'}),
 ];
 localStorage.setItem('odj.data.v1', JSON.stringify({app:'ordre-du-jour',schema:1,savedAt:now,settings:{},tasks}));
}"""
titles = lambda pg: pg.locator('#list .row .title').all_inner_texts()
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width': 1366, 'height': 820})
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.clock.install(time='2026-10-20T08:00:00+02:00')
    pg.goto(URL); pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(300)
    t = titles(pg)
    check('À faire : tâches récurrentes lointaines rangées', 'Point hebdo du lundi' not in t and 'Clôture mensuelle' not in t, t)
    check('… celles du jour, ou dont le rappel est passé, restent visibles', {'Tâche normale', 'Rapport du mardi', 'Préparer le jeudi', 'Échéance simple dans 5 jours'} <= set(t), t)
    check('lien « 2 tâches récurrentes à venir »', '2 tâches récurrentes à venir' in pg.locator('.parkedLink').inner_text(), pg.locator('.parkedLink').inner_text() if pg.locator('.parkedLink').count() else '')
    check('compteurs : À faire 4, Récurrentes 4', pg.locator('#count-todo').inner_text() == '4' and pg.locator('#count-recur').inner_text() == '4', (pg.locator('#count-todo').inner_text(), pg.locator('#count-recur').inner_text()))
    pg.screenshot(path=str(OUT / '70-todo-sans-recurrentes.png'))
    pg.click('.parkedLink'); pg.wait_for_timeout(200)
    check('le lien ouvre l\'onglet Récurrentes', pg.locator('#tab-recur').get_attribute('aria-selected') == 'true')
    heads = pg.locator('#list .secHead').all_inner_texts()
    t = titles(pg)
    check('Récurrentes : toutes, par prochaine échéance, en deux groupes', t == ['Rapport du mardi', 'Préparer le jeudi', 'Point hebdo du lundi', 'Clôture mensuelle'] and 'Cette semaine' in heads[0] and 'Plus tard' in heads[1], (t, heads))
    subs = pg.locator('#list .rsub').all_inner_texts()
    check('rythme et rappel affichés sous chaque tâche', 'Chaque lundi' in subs and any('Chaque mois, le 5' in x and 'la veille à 17 h' in x for x in subs), subs)
    pg.screenshot(path=str(OUT / '71-onglet-recurrentes.png'))
    # saisie dans l'onglet : tâche récurrente chaque semaine dès aujourd'hui
    pg.fill('#qaInput', 'Relevé des heures'); pg.press('#qaInput', 'Enter'); pg.wait_for_timeout(200)
    nt = pg.evaluate("window.__odj.state().tasks.find(t => t.title === 'Relevé des heures')")
    check('ajout dans Récurrentes : chaque semaine, à partir d\'aujourd\'hui', nt['repeat'] == {'type': 'weekly', 'wd': 2} and nt['due'] == '2026-10-20' and 'Relevé des heures' in titles(pg), nt)
    # cocher une occurrence du jour : la suivante se range
    pg.click('#tab-todo'); pg.wait_for_timeout(150)
    pg.locator('#list .row', has_text='Rapport du mardi').locator('.check').click(); pg.wait_for_timeout(1500)
    t = titles(pg)
    nxt = pg.evaluate("window.__odj.state().tasks.find(t => t.title === 'Rapport du mardi' && !t.done)")
    check('occurrence cochée : la suivante (mardi prochain) est rangée', nxt['due'] == '2026-10-27' and not any(x == 'Rapport du mardi' for x in pg.locator('[data-section="open"] .row .title').all_inner_texts()), (nxt['due'], t))
    # matrice : mêmes règles
    pg.click('#tab-matrix'); pg.wait_for_timeout(200)
    mx = pg.locator('#matrix .mtitle').all_inner_texts()
    check('matrice : récurrentes lointaines rangées aussi', 'Point hebdo du lundi' not in mx and 'Tâche normale' in mx, mx)
    # réglage : 1 semaine avant / toujours
    pg.evaluate("window.__odj.setSetting('recurLead', 7)"); pg.click('#tab-todo'); pg.wait_for_timeout(200)
    t = titles(pg)
    check('réglage « 1 semaine avant » : la tâche de lundi revient dans À faire', 'Point hebdo du lundi' in t and 'Clôture mensuelle' not in t, t)
    pg.evaluate("window.__odj.setSetting('recurLead', -1)"); pg.wait_for_timeout(200)
    t = titles(pg)
    check('réglage « Toujours » : plus rien n\'est rangé', 'Clôture mensuelle' in t and pg.locator('.parkedLink').count() == 0, t)
    pg.evaluate("window.__odj.setSetting('recurLead', 0)"); pg.wait_for_timeout(200)
    # raccourci clavier
    pg.locator('#list').focus(); pg.keyboard.press('Shift+Digit4'); pg.wait_for_timeout(150)
    check('Maj+4 : onglet Récurrentes', pg.locator('#tab-recur').get_attribute('aria-selected') == 'true')
    # la date avance : lundi, la tâche revient d'elle-même
    pg.clock.set_system_time('2026-10-26T08:00:00+02:00'); pg.reload(); pg.wait_for_timeout(300)
    pg.click('#tab-todo'); pg.wait_for_timeout(150)
    check('le jour J : la tâche récurrente apparaît dans À faire', 'Point hebdo du lundi' in titles(pg), titles(pg))
    # téléphone : onglets lisibles
    m = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    mp = m.new_page(); mp.clock.install(time='2026-10-20T08:00:00+02:00'); mp.goto(URL); mp.evaluate(SEED); mp.reload(); mp.wait_for_timeout(300)
    mp.locator('#tab-recur').scroll_into_view_if_needed(); mp.click('#tab-recur'); mp.wait_for_timeout(200)
    check('téléphone : onglet Récurrentes accessible', len(mp.locator('#list .row').all()) == 4)
    mp.screenshot(path=str(OUT / '72-recurrentes-telephone.png'))
    b.close()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
