# Régressions issues de la relecture indépendante
import pathlib, subprocess, sys, time, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path('/home/claude/ordre-du-jour'); URL = (ROOT/'dist/to-do-list.html').as_uri()
res=[]; errs=[]
def check(n,c,i=''): res.append(c); print(('PASS ' if c else 'FAIL ')+n+('' if c else f' — {i}'))
titles = lambda pg: pg.evaluate("window.__odj.state().tasks.filter(t=>!t.done).sort((a,b)=>a.position-b.position).map(t=>t.title)")
srv = subprocess.Popen([sys.executable,'-m','http.server','8766','--bind','127.0.0.1','-d',str(ROOT/'dist')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width':1366,'height':820})
    # 1. annulation dans un onglet n'efface pas le travail de l'autre
    a=ctx.new_page(); a.on('pageerror', lambda e: errs.append(str(e))); a.goto(URL); a.wait_for_timeout(200)
    a.fill('#qaInput','Tâche A'); a.press('#qaInput','Enter'); a.wait_for_timeout(100)
    bb=ctx.new_page(); bb.goto(URL); bb.wait_for_timeout(200)
    bb.fill('#qaInput','Tâche B'); bb.press('#qaInput','Enter'); a.wait_for_timeout(300)
    a.locator('#list').focus(); a.keyboard.press('Control+z'); a.wait_for_timeout(300)
    check('Ctrl+Z après synchro entre onglets ne détruit rien', titles(a)==['Tâche A','Tâche B'] and titles(bb)==['Tâche A','Tâche B'], (titles(a), titles(bb)))
    bb.close()
    # 2. surlignage avec accents décomposés et ligatures
    a.evaluate("localStorage.clear()"); a.reload(); a.wait_for_timeout(200)
    for t in ['Révision décembre budget', 'Contrôler le cœur de métier']:
        a.fill('#qaInput', t); a.press('#qaInput','Enter')
    a.fill('#search','budget'); a.wait_for_timeout(250)
    check('surlignage juste sur texte décomposé', a.locator('#list mark').all_inner_texts()==['budget'], a.locator('#list mark').all_inner_texts())
    a.fill('#search','coeur'); a.wait_for_timeout(250)
    check('« coeur » trouve « cœur »', a.locator('#list mark').all_inner_texts()==['cœur'], a.locator('#list mark').all_inner_texts())
    a.fill('#search',''); a.press('#search','Escape')
    # 3. Ctrl+Z pendant l'animation de la case
    a.locator('#list .row').nth(0).click(); a.locator('#list').focus(); a.keyboard.press('x'); a.wait_for_timeout(100); a.keyboard.press('Control+z'); a.wait_for_timeout(900)
    check('Ctrl+Z pendant l\'animation empêche la complétion', all(not t['done'] for t in a.evaluate('window.__odj.state().tasks')))
    # 4. Suppr / x sur un contrôle du détail n'agit pas sur la tâche
    a.fill('#dAddStep','étape 1'); a.press('#dAddStep','Enter')
    a.locator('#dSteps input[type=checkbox]').first.focus(); a.keyboard.press('Delete'); a.keyboard.press('x'); a.wait_for_timeout(800)
    t=a.evaluate('window.__odj.state().tasks')
    check('Suppr et x dans le détail sans effet sur la tâche', len(t)==2 and not any(x['done'] for x in t), [(x['title'],x['done']) for x in t])
    # 5. savedAt toujours croissant même après chargement d'un fichier « du futur »
    a.evaluate("()=>{ window.__odj.state().savedAt = Date.now() + 600000; }")
    a.fill('#qaInput','Après décalage'); a.press('#qaInput','Enter')
    check('horodatage monotone', a.evaluate("window.__odj.state().savedAt > Date.now() + 590000"))
    a.close()

    # --- fichier lié (OPFS en http)
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto('http://127.0.0.1:8766/to-do-list.html'); pg.wait_for_timeout(300)
    link = """async()=>{const o=window.__odj; const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('f.json',{create:true}); o.fileSync.handle=h; o.fileSync.state='ok'; o.fileSync.lastModified=0; await o.idb.set('handle',h); await o.fileSync.writeNow({force:true});}"""
    readf = "async()=>{const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('f.json'); return JSON.parse(await (await h.getFile()).text())}"
    ext = lambda code: pg.evaluate("""async()=>{const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('f.json'); const j=JSON.parse(await (await h.getFile()).text()); %s; const w=await h.createWritable(); await w.write(JSON.stringify(j)); await w.close();}""" % code)
    for t in ['Un','Deux','Trois']:
        pg.fill('#qaInput',t); pg.press('#qaInput','Enter')
    pg.evaluate(link); pg.wait_for_timeout(100)
    # 6. modification extérieure pendant que la fenêtre reste au premier plan
    ext("j.tasks.push({id:'pc2',title:'Depuis PC2',position:9,updatedAt:Date.now()}); j.savedAt=Date.now()+1000")
    pg.fill('#qaInput','Quatre'); pg.press('#qaInput','Enter'); pg.wait_for_timeout(1200)
    f=pg.evaluate(readf)
    check('écriture : la modification de PC2 est conservée', {'Depuis PC2','Quatre'} <= {t['title'] for t in f['tasks']}, [t['title'] for t in f['tasks']])
    check('… et reprise dans la liste', 'Depuis PC2' in titles(pg), titles(pg))
    # 7. reconnexion : modifs des deux côtés fusionnées
    pg.evaluate("()=>{window.__odj.fileSync.state='permission'}")
    pg.fill('#qaInput','Local hors ligne'); pg.press('#qaInput','Enter'); pg.wait_for_timeout(200)
    ext("j.tasks.push({id:'pc2b',title:'PC2 hors ligne',position:10,updatedAt:Date.now()}); j.tasks.find(t=>t.title==='Un').title='Un (renommé sur PC2)'; j.tasks.find(t=>t.title.startsWith('Un')).updatedAt=Date.now(); j.savedAt=Date.now()+5000")
    pg.evaluate("async()=>{const fs=window.__odj.fileSync; fs.state='ok'; await fs.reconcile();}"); pg.wait_for_timeout(300)
    tl=titles(pg); f=pg.evaluate(readf); ft={t['title'] for t in f['tasks']}
    check('fusion : rien de perdu, renommage repris', {'Local hors ligne','PC2 hors ligne','Un (renommé sur PC2)'} <= set(tl) and {'Local hors ligne','PC2 hors ligne'} <= ft and 'Un' not in tl, (tl, ft))
    check('copies de sécurité avant fusion', pg.evaluate("!!localStorage.getItem('odj.backup.v1.fichier')"))
    # 8. une tâche supprimée ici ne réapparaît pas à la fusion ; une suppression faite sur PC2 est reprise
    pg.locator('#list .row', has_text='Deux').click(); pg.locator('#list').focus(); pg.keyboard.press('Delete'); pg.wait_for_timeout(900)
    pg.evaluate("()=>{window.__odj.fileSync.state='permission'}")
    ext("j.tasks.push({id:'x9',title:'Encore PC2',position:11,updatedAt:Date.now()}); const idT=j.tasks.find(t=>t.title==='Trois').id; j.tasks=j.tasks.filter(t=>t.id!==idT); j.deleted=Object.assign(j.deleted||{}, {[idT]:Date.now()+10}); j.tasks.push(...[]); j.savedAt=Date.now()+9000")
    # le fichier a encore « Deux » ? non : déjà écrit. On le remet pour simuler un fichier plus ancien.
    ext("j.tasks.push({id:'deux-old',title:'Deux-copie',position:2,updatedAt:1})")
    pg.evaluate("async()=>{const fs=window.__odj.fileSync; fs.state='ok'; await fs.reconcile();}"); pg.wait_for_timeout(300)
    tl=titles(pg)
    check('suppression faite sur PC2 reprise', 'Trois' not in tl and 'Encore PC2' in tl, tl)
    check('suppression locale non annulée par la fusion', 'Deux' not in tl, tl)
    # 9. erreur d'écriture passagère : nouvel essai automatique
    pg.evaluate("()=>{const fs=window.__odj.fileSync; const real=fs.handle; let n=0; fs.handle={name:real.name, getFile:()=>real.getFile(), createWritable:()=>{ if(n++<1){ const e=new Error('verrouillé'); e.name='NoModificationAllowedError'; return Promise.reject(e);} return real.createWritable(); }, queryPermission:()=>Promise.resolve('granted')}; window.__real=real;}")
    pg.fill('#qaInput','Pendant le verrou'); pg.press('#qaInput','Enter'); pg.wait_for_timeout(1500)
    st1=pg.locator('#status').inner_text()
    pg.wait_for_timeout(5500)
    f=pg.evaluate(readf)
    check('verrou temporaire : erreur affichée puis écriture réussie seule', 'impossible' in st1.lower() and 'Pendant le verrou' in {t['title'] for t in f['tasks']} and 'Sauvegarde automatique' in pg.locator('#status').inner_text(), (st1, pg.locator('#status').inner_text()))
    pg.close(); b.close()
finally:
    srv.terminate()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
