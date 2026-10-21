# Sauvegarde automatique : carte de mise en route, reprise au premier clic, fichier existant fusionné
import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS
import pathlib, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT=ROOT; URL=(ROOT/'dist/to-do-list.html').as_uri()
OUT=SHOTS
res=[]; errs=[]
def check(n,c,i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n+('' if c else f' — {i}'))
srv=subprocess.Popen([sys.executable,'-m','http.server','8771','--bind','127.0.0.1','-d',str(ROOT/'dist')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(0.8)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width':1366,'height':820})
    # 1. fichier : carte de mise en route visible tant qu'aucun fichier n'est choisi
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(URL); pg.wait_for_timeout(400)
    check('carte « Activer la sauvegarde automatique » au premier lancement', pg.locator('#setupCard').is_visible())
    pg.screenshot(path=str(OUT/'50-setup.png'))
    pg.click('[data-setup="later"]')
    check('« Plus tard » masque la carte', not pg.locator('#setupCard').is_visible())
    pg.reload(); pg.wait_for_timeout(300)
    check('… et elle ne revient pas au rechargement', not pg.locator('#setupCard').is_visible())
    check('barre du bas : bouton d\'activation', pg.locator('#status [data-status-act="create"]').count()==1)
    pg.close()

    # 2. http (OPFS) : reprise automatique au premier clic
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto('http://127.0.0.1:8771/to-do-list.html'); pg.wait_for_timeout(300)
    for t in ['Un','Deux']:
        pg.fill('#qaInput',t); pg.press('#qaInput','Enter')
    pg.evaluate("""async()=>{ const o=window.__odj, fs=o.fileSync; const d=await navigator.storage.getDirectory(); const real=await d.getFileHandle('a.json',{create:true});
      let perm='prompt'; window.__asked=0;
      fs.handle={ name:'ordre-du-jour.json', getFile:()=>real.getFile(), createWritable:()=> perm==='granted' ? real.createWritable() : Promise.reject(Object.assign(new Error('no'),{name:'NotAllowedError'})),
        queryPermission:()=>Promise.resolve(perm), requestPermission:()=>{ window.__asked++; perm='granted'; return Promise.resolve('granted'); } };
      fs.state='permission'; fs.armAutoReconnect(); document.querySelector('#status') && 0; }""")
    pg.evaluate("window.__odj.fileSync.status && null"); pg.wait_for_timeout(50)
    pg.evaluate("document.querySelector('#status').innerHTML=''"); pg.evaluate("window.dispatchEvent(new Event('noop'))")
    st0 = pg.evaluate("window.__odj.fileSync.status().text")
    check('statut « en pause, cliquez n\'importe où »', 'cliquez n\'importe où' in st0, st0)
    pg.keyboard.press('Shift')  # une touche de modification ne déclenche rien
    check('Maj seule : pas de demande', pg.evaluate('window.__asked')==0)
    pg.locator('#list .row').first.click(); pg.wait_for_timeout(400)
    check('premier clic : Chrome redemande l\'accès, sauvegarde reprise', pg.evaluate('window.__asked')==1 and pg.evaluate('window.__odj.fileSync.state')=='ok', (pg.evaluate('window.__asked'), pg.evaluate('window.__odj.fileSync.state')))
    n = pg.evaluate("async()=>{const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('a.json'); return JSON.parse(await (await h.getFile()).text()).tasks.length}")
    check('fichier écrit tout de suite après la reprise', n==2, n)
    pg.locator('#list .row').nth(1).click(); pg.wait_for_timeout(200)
    check('un seul appel (pas de redemande à chaque clic)', pg.evaluate('window.__asked')==1)
    # permission retirée en cours de route (onglet longtemps en arrière-plan) → réarmée
    pg.evaluate("""()=>{ const fs=window.__odj.fileSync; const h=fs.handle; let p='prompt'; h.createWritable=()=>Promise.reject(Object.assign(new Error('x'),{name:'NotAllowedError'})); }""")
    pg.fill('#qaInput','Trois'); pg.press('#qaInput','Enter'); pg.wait_for_timeout(900)
    check('accès retiré : sauvegarde en pause et réarmée', pg.evaluate('window.__odj.fileSync.state')=='permission' and pg.evaluate('window.__odj.fileSync.armed')==True, (pg.evaluate('window.__odj.fileSync.state'), pg.evaluate('window.__odj.fileSync.armed')))

    # 3. « Choisir l'emplacement » sur un fichier existant : fusion, pas d'écrasement
    pg.evaluate("""async()=>{ const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('old.json',{create:true}); const w=await h.createWritable();
      await w.write(JSON.stringify({app:'ordre-du-jour',schema:1,savedAt:1,tasks:[{id:'old1',title:'Ancienne tâche du fichier',position:0,updatedAt:1,createdAt:1}]})); await w.close();
      window.showSaveFilePicker = async()=>h; }""")
    pg.evaluate("window.__odj.fileSync.createNew()"); pg.wait_for_timeout(500)
    titles = pg.evaluate("window.__odj.state().tasks.map(t=>t.title)")
    f = pg.evaluate("async()=>{const d=await navigator.storage.getDirectory(); const h=await d.getFileHandle('old.json'); return JSON.parse(await (await h.getFile()).text()).tasks.map(t=>t.title)}")
    check('fichier existant choisi : rien d\'écrasé, tout fusionné', 'Ancienne tâche du fichier' in titles and {'Un','Deux','Trois','Ancienne tâche du fichier'} <= set(f), (titles, f))
    check('statut : sauvegarde automatique active', 'Sauvegarde automatique dans' in pg.locator('#status').inner_text(), pg.locator('#status').inner_text())
    b.close()
finally:
    srv.terminate()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
