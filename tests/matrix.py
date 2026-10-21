# Matrice urgent / important
import pathlib
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path('/home/claude/ordre-du-jour'); URL=(ROOT/'dist/to-do-list.html').as_uri()
OUT=pathlib.Path('/tmp/claude-0/-home-claude/59fdc690-8e41-50a4-81b9-8a7023412a59/scratchpad/shots')
res=[]; errs=[]
def check(n,c,i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n+('' if c else f' — {i}'))
SEED = """() => {
 const day=86400000, now=Date.now(), T=(o)=>Object.assign({id:crypto.randomUUID(),notes:'',steps:[],done:false,doneAt:null,due:null,repeat:null,createdAt:now-5*day,updatedAt:now-5*day},o);
 const tasks=[
  T({title:'Clôture octobre : J+3 reporting usine',position:0,due:'2026-10-22',matrix:{important:true,urgent:null},steps:[{id:'s1',text:'Extraire la balance',done:true},{id:'s2',text:'Pack CFO',done:false}]}),
  T({title:'Répondre aux achats sur les écarts de PPV',position:1,due:'2026-10-20',matrix:{important:false,urgent:null}}),
  T({title:'Préparer le budget atelier 2027',position:2,due:'2026-11-15',matrix:{important:true,urgent:null}}),
  T({title:'Former le nouvel arrivant sur Power BI',position:3,matrix:{important:true,urgent:null}}),
  T({title:'Trier les mails de la semaine',position:4,matrix:{important:false,urgent:null}}),
  T({title:'Mettre à jour l\\'estimate Q4',position:5,due:'2026-10-21'}),
  T({title:'Demander la licence Copilot à l\\'IT',position:6}),
  T({title:'Relire la note coûts de non-qualité',position:7,due:'2026-10-30'}),
  T({title:'Réserver la salle pour le point mensuel',position:8,due:'2026-10-23',matrix:{important:false,urgent:null}}),
 ];
 localStorage.setItem('odj.data.v1', JSON.stringify({app:'ordre-du-jour',schema:1,savedAt:now,settings:{},tasks}));
}"""
quad = lambda pg, q: pg.locator(f'[data-drop="{q}"] .mtitle').all_inner_texts()
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width':1366,'height':820})
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.clock.install(time='2026-10-21T09:00:00+02:00')
    pg.goto(URL); pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(300)
    pg.click('#tab-matrix'); pg.wait_for_timeout(200)
    check('Q1 : important + échéance proche', quad(pg,'q1')==['Clôture octobre : J+3 reporting usine'], quad(pg,'q1'))
    check('Q2 : important, échéance lointaine ou sans date', quad(pg,'q2')==['Préparer le budget atelier 2027','Former le nouvel arrivant sur Power BI'], quad(pg,'q2'))
    check('Q3 : pas important mais urgent (retard, J+2)', quad(pg,'q3')==['Répondre aux achats sur les écarts de PPV','Réserver la salle pour le point mensuel'], quad(pg,'q3'))
    check('Q4 : ni l\'un ni l\'autre', quad(pg,'q4')==['Trier les mails de la semaine'], quad(pg,'q4'))
    check('« À classer » : importance non renseignée', quad(pg,'inbox')==['Mettre à jour l\'estimate Q4','Demander la licence Copilot à l\'IT','Relire la note coûts de non-qualité'], quad(pg,'inbox'))
    check('onglet Matrice : compteur du cadran 1', pg.locator('#count-matrix').inner_text()=='1')
    pg.screenshot(path=str(OUT/'70-matrix.png'))
    # tri rapide
    pg.locator('.mcard', has_text='estimate Q4').locator('[data-tri="true"]').click(); pg.wait_for_timeout(100)
    check('« Important » sur une tâche due aujourd\'hui → Q1', 'Mettre à jour l\'estimate Q4' in quad(pg,'q1'), quad(pg,'q1'))
    check('ordre du cadran = ordre de la liste', quad(pg,'q1')==['Clôture octobre : J+3 reporting usine','Mettre à jour l\'estimate Q4'], quad(pg,'q1'))
    pg.locator('#list, body').first  # noop
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(100)
    check('Ctrl+Z annule le classement', 'Mettre à jour l\'estimate Q4' in quad(pg,'inbox'), quad(pg,'inbox'))
    # glisser-déposer vers un cadran
    src = pg.locator('.mcard', has_text='licence Copilot'); dst = pg.locator('[data-drop="q2"]')
    src.drag_to(dst); pg.wait_for_timeout(150)
    check('glisser dans Q2 : importante, urgence auto conservée', 'Demander la licence Copilot à l\'IT' in quad(pg,'q2') and pg.evaluate("window.__odj.state().tasks.find(t=>t.title.includes('Copilot')).matrix")=={'important':True,'urgent':None}, quad(pg,'q2'))
    # glisser Q2 → Q1 sans échéance : urgence forcée
    pg.locator('.mcard', has_text='Former le nouvel').drag_to(pg.locator('[data-drop="q1"]')); pg.wait_for_timeout(150)
    m = pg.evaluate("window.__odj.state().tasks.find(t=>t.title.startsWith('Former')).matrix")
    check('glisser dans Q1 une tâche sans date : urgence forcée', m=={'important':True,'urgent':True} and 'Former le nouvel arrivant sur Power BI' in quad(pg,'q1'), m)
    check('badge « Urgence forcée »', 'Urgence forcée' in pg.locator('.mcard', has_text='Former le nouvel').inner_text())
    # réordonner dans Q1 : glisser avant la première
    pg.locator('.mcard', has_text='Former le nouvel').drag_to(pg.locator('.mcard', has_text='Clôture octobre'), target_position={'x':60,'y':4}); pg.wait_for_timeout(150)
    check('réordonner dans un cadran (avant la 1re)', quad(pg,'q1')[0]=='Former le nouvel arrivant sur Power BI', quad(pg,'q1'))
    pg.click('#tab-todo'); pg.wait_for_timeout(100)
    first = pg.locator('#list .row .title').first.inner_text()
    check('… et l\'ordre de la liste suit', first=='Former le nouvel arrivant sur Power BI', first)
    pg.click('#tab-matrix'); pg.wait_for_timeout(100)
    # urgence automatique qui évolue avec le temps
    pg.clock.set_fixed_time('2026-11-13T09:00:00+01:00'); pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.evaluate("document.querySelector('#tab-todo').click(); document.querySelector('#tab-matrix').click()")
    check('Budget 2027 (échéance 15/11) passe seul dans Q1 deux jours avant', 'Préparer le budget atelier 2027' in quad(pg,'q1'), quad(pg,'q1'))
    pg.clock.set_fixed_time('2026-10-21T09:00:00+02:00'); pg.evaluate("document.querySelector('#tab-todo').click(); document.querySelector('#tab-matrix').click()")
    # détail en panneau latéral
    pg.locator('.mcard', has_text='Trier les mails').click(); pg.wait_for_timeout(300)
    check('clic : détail ouvert en panneau', pg.evaluate("document.querySelector('#app').classList.contains('detailOpen')") and pg.locator('#scrim').is_visible())
    pg.screenshot(path=str(OUT/'71-matrix-detail.png'))
    pg.locator('[data-urg="true"]').click(); pg.wait_for_timeout(100)
    check('détail : « Urgent » forcé → Q3', 'Trier les mails de la semaine' in quad(pg,'q3'), quad(pg,'q3'))
    check('texte d\'aide de la priorité', 'Urgent, pas important' in pg.locator('#dMxHint').inner_text(), pg.locator('#dMxHint').inner_text())
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Échap ferme le panneau', not pg.evaluate("document.querySelector('#app').classList.contains('detailOpen')") and not pg.locator('#scrim').is_visible())
    # raccourcis I et U
    pg.locator('.mcard', has_text='Relire la note').click(); pg.keyboard.press('Escape'); pg.wait_for_timeout(250)
    pg.keyboard.press('i'); pg.wait_for_timeout(100)
    check('touche I : importante', 'Relire la note coûts de non-qualité' in quad(pg,'q2'), quad(pg,'q2'))
    pg.keyboard.press('u'); pg.wait_for_timeout(100)
    check('touche U : urgence forcée', 'Relire la note coûts de non-qualité' in quad(pg,'q1'), quad(pg,'q1'))
    pg.keyboard.press('u'); pg.wait_for_timeout(100)
    check('touche U encore : retour à l\'automatique', 'Relire la note coûts de non-qualité' in quad(pg,'q2'), quad(pg,'q2'))
    # terminer depuis la matrice
    pg.locator('.mcard', has_text='Réserver la salle').locator('.check').click(); pg.wait_for_timeout(900)
    check('cocher dans la matrice termine la tâche', 'Réserver la salle pour le point mensuel' not in quad(pg,'q3') and pg.evaluate("window.__odj.state().tasks.find(t=>t.title.startsWith('Réserver')).done"))
    # récurrence : importance gardée, urgence remise en auto
    pg.locator('.mcard', has_text='Former le nouvel').click(); pg.wait_for_timeout(200)
    pg.fill('#dDue','2026-10-21'); pg.locator('#dDue').dispatch_event('change')
    pg.locator('#dRepeat').select_option('weekly'); pg.wait_for_timeout(50)
    pg.locator('#dDone').check(); pg.wait_for_timeout(200)
    nxt = pg.evaluate("window.__odj.state().tasks.filter(t=>t.title.startsWith('Former')&&!t.done).map(t=>[t.due,t.matrix])")
    check('occurrence suivante : importante, urgence automatique', nxt==[['2026-10-28',{'important':True,'urgent':None}]], nxt)
    pg.keyboard.press('Escape')
    # recherche depuis la matrice : résultats en liste
    pg.fill('#search','budget'); pg.wait_for_timeout(250)
    check('recherche : bascule en liste de résultats', pg.locator('#matrix').is_hidden() and pg.locator('#list .row').count()==1)
    pg.fill('#search',''); pg.press('#search','Escape'); pg.wait_for_timeout(150)
    check('après la recherche : retour à la matrice', pg.locator('#matrix').is_visible())
    # persistance
    pg.reload(); pg.wait_for_timeout(300)
    check('rechargement : classement conservé', pg.evaluate("window.__odj.state().tasks.find(t=>t.title.includes('Copilot')).matrix.important")==True)
    # fenêtre étroite
    pg.set_viewport_size({'width':700,'height':900}); pg.click('#tab-matrix'); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT/'72-matrix-narrow.png'))
    check('fenêtre étroite : cadrans empilés lisibles', pg.locator('[data-drop="q1"]').bounding_box()['width'] > 600)
    pg.set_viewport_size({'width':1366,'height':820})
    # sombre
    pg.emulate_media(color_scheme='dark'); pg.wait_for_timeout(150); pg.screenshot(path=str(OUT/'73-matrix-dark.png'))
    b.close()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
