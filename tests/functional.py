import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS
import json, pathlib, re, time
from playwright.sync_api import sync_playwright, expect
ROOT = ROOT
URL = (ROOT/'dist/to-do-list.html').as_uri()
OUT = SHOTS
results=[]; errors=[]
def check(name, cond, info=''):
    results.append((name, bool(cond), info)); print(('PASS ' if cond else 'FAIL ')+name+(' — '+str(info) if (info and not cond) else ''))

def tasks(pg): return pg.evaluate('window.__odj.state().tasks')
def open_titles(pg): return pg.evaluate("window.__odj.state().tasks.filter(t=>!t.done).sort((a,b)=>a.position-b.position).map(t=>t.title)")
def visible_titles(pg): return pg.locator('#list .row .title').all_inner_texts()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':1366,'height':820}, locale='fr-FR', timezone_id='Europe/Paris', accept_downloads=True)
    ctx.grant_permissions(['clipboard-read','clipboard-write'])
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error',) else None)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.goto(URL); pg.wait_for_timeout(300)

    # --- logique pure
    h = pg.evaluate("[...window.__odj.holidays(2026)].sort()")
    check('jours fériés 2026 (Pâques, Ascension, Pentecôte)', '2026-04-06' in h and '2026-05-14' in h and '2026-05-25' in h and len(h)==11, h)
    nth = pg.evaluate("window.__odj.nextOccurrence({type:'nth',n:3},'2026-10-20',true)")
    check('3e jour ouvré après le 20/10 = 4 nov.', nth=='2026-11-04', nth)
    nth2 = pg.evaluate("window.__odj.nextOccurrence({type:'nth',n:3},'2026-11-04')")
    check('3e jour ouvré suivant = 3 déc.', nth2=='2026-12-03', nth2)
    last = pg.evaluate("window.__odj.nextOccurrence({type:'last'},'2026-10-20',true)")
    check('dernier jour ouvré oct. 2026 = 30/10', last=='2026-10-30', last)
    mon = pg.evaluate("window.__odj.nextOccurrence({type:'monthly',dom:31},'2026-01-31')")
    check('mensuel le 31 → 28 févr.', mon=='2026-02-28', mon)
    mon2 = pg.evaluate("window.__odj.nextOccurrence({type:'monthly',dom:31},'2026-02-28')")
    check('mensuel le 31 → 31 mars ensuite', mon2=='2026-03-31', mon2)
    wd = pg.evaluate("window.__odj.nextOccurrence({type:'workday'},'2026-10-30')")
    check('jour ouvré après ven. 30/10 = lun. 2/11 (1er nov. dimanche)', wd=='2026-11-02', wd)
    wd2 = pg.evaluate("window.__odj.nextOccurrence({type:'workday'},'2026-11-10')")
    check('jour ouvré après 10/11 = 12/11 (11 nov. férié)', wd2=='2026-11-12', wd2)
    pq = pg.evaluate("[window.__odj.parseQuick('Appeler Marc @ven'), window.__odj.parseQuick('Budget @25/10 ok'), window.__odj.parseQuick('mail à paul@exemple.fr'), window.__odj.parseQuick('Stock @01/01'), window.__odj.parseQuick('Test @31/02')]")
    check('saisie @ven → vendredi 23/10', (pq[0]['title'],pq[0]['due'])==('Appeler Marc','2026-10-23'), pq[0])
    check('saisie @25/10', (pq[1]['title'],pq[1]['due'])==('Budget ok','2026-10-25'), pq[1])
    check('adresse mail non interprétée', (pq[2]['title'],pq[2]['due'],pq[2]['remind'])==('mail à paul@exemple.fr',None,None), pq[2])
    check('@01/01 → année suivante', pq[3]['due']=='2027-01-01', pq[3])
    check('@31/02 invalide laissé dans le titre', (pq[4]['title'],pq[4]['due'])==('Test @31/02',None), pq[4])

    # --- ajout
    qa = pg.locator('#qaInput')
    for t in ['Clôture J+3','Relancer achats fournisseurs','Estimate Q4 @ven','Heures atelier','Point atelier']:
        qa.fill(t); qa.press('Enter')
    check('5 tâches ajoutées en bas, dans l\'ordre', open_titles(pg)==['Clôture J+3','Relancer achats fournisseurs','Estimate Q4','Heures atelier','Point atelier'], open_titles(pg))
    qa.fill('Urgent : appeler la banque'); qa.press('Alt+Enter')
    check('Alt+Entrée ajoute en haut', open_titles(pg)[0]=='Urgent : appeler la banque', open_titles(pg))
    check('rang 1 affiché en tête', pg.locator('#list .row').first.locator('.num').inner_text()=='1')

    # --- clavier : sélection et déplacement
    pg.locator('#list').focus()
    sel0 = pg.evaluate('window.__odj.ui.selectedId')
    pg.keyboard.press('Escape')
    pg.locator('#list .row').nth(0).click()
    pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowDown')
    sel = pg.evaluate("window.__odj.state().tasks.find(t=>t.id===window.__odj.ui.selectedId).title")
    check('flèches : sélection sur la 3e', sel=='Relancer achats fournisseurs', sel)
    pg.keyboard.press('Alt+ArrowUp')
    check('Alt+↑ monte la tâche', open_titles(pg)[1]=='Relancer achats fournisseurs', open_titles(pg))
    pg.keyboard.press('Alt+Shift+ArrowUp')
    check('Alt+Maj+↑ met en tête', open_titles(pg)[0]=='Relancer achats fournisseurs', open_titles(pg))
    pg.keyboard.press('Control+z')
    check('Ctrl+Z annule les déplacements (regroupés)', open_titles(pg)[2]=='Relancer achats fournisseurs', open_titles(pg))
    pg.keyboard.press('Control+y')
    check('Ctrl+Y rétablit', open_titles(pg)[0]=='Relancer achats fournisseurs', open_titles(pg))

    # --- terminer au clavier avec animation, sélection avance
    pg.keyboard.press('Home')
    pg.keyboard.press('Space'); pg.wait_for_timeout(800)
    t = [x for x in tasks(pg) if x['title']=='Relancer achats fournisseurs'][0]
    check('Espace termine la tâche', t['done'] is True)
    sel = pg.evaluate("window.__odj.state().tasks.find(t=>t.id===window.__odj.ui.selectedId).title")
    check('la sélection passe à la suivante', sel=='Urgent : appeler la banque', sel)
    check('groupe « Terminées aujourd\'hui » visible (replié)', pg.locator('[data-toggle="doneToday"]').count()==1 and pg.locator('[data-toggle="doneToday"]').get_attribute('aria-expanded')=='false')
    pg.keyboard.press('Control+z')
    t = [x for x in tasks(pg) if x['title']=='Relancer achats fournisseurs'][0]
    check('Ctrl+Z rouvre la tâche', t['done'] is False)

    # --- clic sur case (souris) puis double clic pendant l'animation annule
    row = pg.locator('#list .row', has_text='Heures atelier')
    row.locator('.check').click(); pg.wait_for_timeout(100); row.locator('.check').click(); pg.wait_for_timeout(900)
    t = [x for x in tasks(pg) if x['title']=='Heures atelier'][0]
    check('second clic pendant l\'animation annule', t['done'] is False)

    # --- suppression + annulation
    pg.locator('#list .row', has_text='Point atelier').click()
    pg.locator('#list').focus(); pg.keyboard.press('Delete')
    check('Suppr supprime', 'Point atelier' not in open_titles(pg))
    pg.locator('.toast button', has_text='Annuler').last.click()
    check('Annuler du toast restaure', 'Point atelier' in open_titles(pg))

    # --- glisser-déposer souris : "Point atelier" (dernier) vers le haut
    rows = pg.locator('#list .section.sortable .row')
    src = rows.nth(rows.count()-1).bounding_box(); dst = rows.nth(0).bounding_box()
    pg.mouse.move(src['x']+200, src['y']+src['height']/2); pg.mouse.down()
    for i in range(1,16):
        pg.mouse.move(src['x']+200, src['y']+src['height']/2 + (dst['y']+8 - (src['y']+src['height']/2))*i/15); pg.wait_for_timeout(16)
    pg.screenshot(path=str(OUT/'03-dragging.png'))
    pg.mouse.up(); pg.wait_for_timeout(200)
    check('glisser-déposer place la tâche en tête', open_titles(pg)[0]=='Point atelier', open_titles(pg))

    # --- détail : titre, étapes, collage, notes, liens
    pg.locator('#list .row', has_text='Clôture J+3').click()
    title = pg.locator('#dTitle'); title.click(); pg.keyboard.press('End'); pg.keyboard.type(' octobre')
    check('titre modifié dans la liste en direct', 'Clôture J+3 octobre' in visible_titles(pg), visible_titles(pg))
    add = pg.locator('#dAddStep'); add.click()
    for s in ['Extraire la balance comptable','Contrôler les provisions']:
        pg.keyboard.type(s); pg.keyboard.press('Enter')
    pg.evaluate("""() => { const el = document.querySelector('#dAddStep'); el.focus(); const dt = new DataTransfer(); dt.setData('text/plain', '- Envoyer le reporting\\n- [ ] Valider avec la direction\\n3. Archiver'); el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true})); }""")
    t = [x for x in tasks(pg) if x['title'].startswith('Clôture')][0]
    check('étapes ajoutées (Entrée + collage multi-lignes nettoyé)', [s['text'] for s in t['steps']]==['Extraire la balance comptable','Contrôler les provisions','Envoyer le reporting','Valider avec la direction','Archiver'], [s['text'] for s in t['steps']])
    # Entrée au milieu d'une étape la coupe ; Alt+↓ déplace
    first = pg.locator('.stepText').first; first.click(); pg.keyboard.press('End')
    pg.keyboard.press('Alt+ArrowDown')
    t = [x for x in tasks(pg) if x['title'].startswith('Clôture')][0]
    check('Alt+↓ déplace une étape', t['steps'][1]['text']=='Extraire la balance comptable', [s['text'] for s in t['steps']])
    pg.locator('.step .check').first.click()
    pg.locator('.step .check').nth(1).click()
    check('compteur étapes 2 sur 5', pg.locator('#dStepsN').inner_text()=='2 sur 5', pg.locator('#dStepsN').inner_text())
    check('puce 2/5 dans la liste', '2/5' in pg.locator('#list .row', has_text='Clôture J+3').inner_text())
    notes = pg.locator('#dNotes'); notes.click()
    pg.keyboard.type('Fichier : X:\\Dossiers\\Projet\\2026\\Suivi oct.xlsx\nVoir https://exemple.sharepoint.com/sites/equipe/dossier\nContact : Julie (comptabilité)')
    pg.wait_for_timeout(400)
    chips = pg.locator('#dLinks .linkChip').all_inner_texts()
    check('liens et chemins détectés dans les notes', len(chips)==2 and 'X:\\Dossiers\\Projet\\2026\\Suivi oct.xlsx' in chips, chips)
    pg.locator('#dLinks .linkChip', has_text='X:\\').click(); pg.wait_for_timeout(200)
    clip = pg.evaluate('navigator.clipboard.readText()')
    check('clic sur un chemin le copie', clip=='X:\\Dossiers\\Projet\\2026\\Suivi oct.xlsx', clip)
    check('icône notes dans la liste', pg.locator('#list .row', has_text='Clôture J+3').locator('.mini').count()>=1)

    # --- répétition : 3e jour ouvré
    pg.locator('#dRepeat').select_option('nth')
    pg.locator('#dNth').fill('3'); pg.locator('#dNth').dispatch_event('input')
    t = [x for x in tasks(pg) if x['title'].startswith('Clôture')][0]
    check('répétition Nᵉ jour ouvré : échéance 4 nov.', t['due']=='2026-11-04' and t['repeat']=={'type':'nth','n':3}, (t['due'], t['repeat']))
    pg.screenshot(path=str(OUT/'04-detail.png'))
    pg.locator('#dDone').check(); pg.wait_for_timeout(200)
    ts = [x for x in tasks(pg) if x['title'].startswith('Clôture')]
    nxt = [x for x in ts if not x['done']]
    check('terminer une tâche répétée crée la suivante au 3 déc., étapes décochées, notes gardées',
          len(ts)==2 and len(nxt)==1 and nxt[0]['due']=='2026-12-03' and all(not s['done'] for s in nxt[0]['steps']) and 'Julie' in nxt[0]['notes'], [(x['done'],x['due']) for x in ts])
    pg.locator('#dDone').uncheck(); pg.wait_for_timeout(200)
    ts = [x for x in tasks(pg) if x['title'].startswith('Clôture')]
    check('rouvrir supprime l\'occurrence suivante non modifiée', len(ts)==1 and not ts[0]['done'], len(ts))

    # --- recherche
    pg.keyboard.press('Escape')
    pg.keyboard.press('Control+f'); pg.keyboard.type('julie'); pg.wait_for_timeout(250)
    check('recherche dans les notes', visible_titles(pg)==['Clôture J+3 octobre'], visible_titles(pg))
    check('extrait surligné', pg.locator('#list .snippet mark').count()==1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check('Échap vide la recherche', len(visible_titles(pg))>=5)

    # --- vues
    pg.locator('#list').focus(); pg.keyboard.press('Shift+Digit2'); pg.wait_for_timeout(100)
    check('Maj+2 → Aujourd\'hui vide', pg.locator('.empty h2').inner_text()=="Rien pour aujourd'hui")
    pg.keyboard.press('Shift+Digit1')

    # --- persistance après rechargement
    before = open_titles(pg)
    pg.reload(); pg.wait_for_timeout(300)
    check('rechargement : tâches et ordre conservés', open_titles(pg)==before, open_titles(pg))

    # --- export / import
    with pg.expect_download() as d: pg.evaluate("document.querySelector('#btnExportJson').click()")
    path = d.value.path(); data = json.loads(open(path).read())
    check('export JSON valide', data['app']=='ordre-du-jour' and len(data['tasks'])==len(tasks(pg)), d.value.suggested_filename)
    with pg.expect_download() as d2: pg.evaluate("document.querySelector('#btnExportMd').click()")
    md = open(d2.value.path()).read()
    check('export texte lisible', md.startswith('# To do list') and '- [x] Contrôler les provisions' in md or '- [x]' in md, md[:200])
    # import en remplaçant par un fichier modifié
    data['tasks'] = data['tasks'][:2]; imp = OUT/'import.json'; imp.write_text(json.dumps(data))
    pg.locator('#importFile').set_input_files(str(imp)); pg.wait_for_timeout(200)
    check('dialogue d\'import ouvert', pg.locator('#dlgConfirm').is_visible())
    pg.locator('#dlgConfirm [data-choice="replace"]').click(); pg.wait_for_timeout(200)
    check('import remplace (2 tâches)', len(tasks(pg))==2, len(tasks(pg)))
    pg.locator('#list').focus(); pg.keyboard.press('Control+z')
    check('import annulable', len(tasks(pg))==len(json.loads(open(path).read())['tasks']), len(tasks(pg)))

    # --- terminées : récap hebdo
    pg.evaluate("""()=>{ const s=window.__odj.state(); const day=86400000; const base=new Date(2026,9,20,10).getTime();
      const mk=(title,offset)=>({id:crypto.randomUUID(),title,notes:'',steps:[],done:true,doneAt:base-offset*day,position:0,due:null,repeat:null,createdAt:base-30*day,updatedAt:base-offset*day});
      s.tasks.push(mk('Rapprochement bancaire',1), mk('Clôture septembre',8), mk('Revue des stocks',9), mk('Budget atelier',16));
      localStorage.setItem('odj.data.v1', window.__odj.serialize()); }""")
    pg.reload(); pg.wait_for_timeout(300)
    pg.locator('#tab-done').click(); pg.wait_for_timeout(150)
    heads = pg.locator('.secHead > span:first-child').all_inner_texts()
    check('terminées groupées par semaine', heads[:3]==['Cette semaine','Semaine dernière','Semaine 41'], heads)
    pg.locator('[data-recap]').nth(1).click(); pg.wait_for_timeout(200)
    clip = pg.evaluate('navigator.clipboard.readText()')
    check('récap de la semaine copié', clip.startswith('Semaine 42 (du 12 au 18 octobre) : 1 tâche terminée') and '- Clôture septembre' in clip, clip)
    pg.screenshot(path=str(OUT/'05-done.png'))

    # --- fichier de sauvegarde (OPFS sert de faux fichier OneDrive ; OPFS exige une origine http)
    import subprocess, sys
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', str(ROOT/'dist')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    main_pg = pg
    pg = ctx.new_page(); pg.goto('http://127.0.0.1:8765/to-do-list.html'); pg.wait_for_timeout(300)
    for t in ['Un','Deux']:
        pg.fill('#qaInput', t); pg.press('#qaInput', 'Enter')
    r = pg.evaluate("""async () => {
      const o = window.__odj;
      const dir = await navigator.storage.getDirectory();
      const h = await dir.getFileHandle('ordre-du-jour.json', {create:true});
      o.fileSync.handle = h; o.fileSync.state = 'ok';
      await o.idb.set('handle', h);
      await o.fileSync.writeNow();
      const txt = await (await h.getFile()).text();
      return {ok: o.fileSync.state, n: JSON.parse(txt).tasks.length, status: document.querySelector('#status').innerText};
    }""")
    check('écriture dans le fichier lié', r['ok']=='ok' and r['n']==len(tasks(pg)) and 'Sauvegarde automatique dans ordre-du-jour.json' in r['status'], r)
    pg.locator('#qaInput').fill('Tâche écrite dans le fichier'); pg.locator('#qaInput').press('Enter'); pg.wait_for_timeout(900)
    n = pg.evaluate("async()=>{const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('ordre-du-jour.json'); return JSON.parse(await (await h.getFile()).text()).tasks.length}")
    check('sauvegarde automatique après modification', n==len(tasks(pg)), (n, len(tasks(pg))))
    # le fichier est plus récent (modifié sur un autre poste) → rechargé au retour
    pg.evaluate("""async()=>{const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('ordre-du-jour.json'); const j=JSON.parse(await (await h.getFile()).text()); j.tasks.push({id:'ext-1',title:'Ajoutée sur un autre PC',position:99}); j.savedAt=Date.now()+5000; const w=await h.createWritable(); await w.write(JSON.stringify(j)); await w.close(); window.__odj.fileSync.lastModified=0; await window.__odj.fileSync.checkExternal();}""")
    pg.wait_for_timeout(200)
    check('fichier plus récent rechargé automatiquement', 'Ajoutée sur un autre PC' in open_titles(pg), open_titles(pg))
    # au rechargement de la page, la poignée est retrouvée (autorisation déjà donnée pour OPFS)
    pg.reload(); pg.wait_for_timeout(600)
    st = pg.locator('#status').inner_text()
    check('fichier retrouvé après rechargement', 'ordre-du-jour.json' in st, st)

    pg.close(); pg = main_pg; srv.terminate()

    # --- deux onglets
    pg.locator('#tab-todo').click()
    pg2 = ctx.new_page(); pg2.goto(URL); pg2.wait_for_timeout(300)
    pg2.locator('#qaInput').fill('Depuis le 2e onglet'); pg2.locator('#qaInput').press('Enter'); pg2.wait_for_timeout(300)
    check('synchronisation entre onglets', 'Depuis le 2e onglet' in open_titles(pg), open_titles(pg))
    pg2.close()

    print()
    print('ERREURS CONSOLE:', errors or 'aucune')
    fails=[r for r in results if not r[1]]
    print(f'{len(results)-len(fails)}/{len(results)} OK')
    b.close()
