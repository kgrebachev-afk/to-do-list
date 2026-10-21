import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS, BUILD, test_build
import pathlib, json
from playwright.sync_api import sync_playwright
URL=((BUILD/'to-do-list.html')).as_uri()
OUT=SHOTS
SEED = """() => {
 const day=86400000, now=Date.now(), T=(o)=>Object.assign({id:crypto.randomUUID(),notes:'',steps:[],done:false,doneAt:null,due:null,repeat:null,createdAt:now-5*day,updatedAt:now-5*day},o);
 const st=(a)=>a.map(([text,done])=>({id:crypto.randomUUID(),text,done:!!done}));
 const tasks=[
  T({title:'Clôture octobre : J+3 reporting usine',position:0,due:'2026-11-04',repeat:{type:'nth',n:3},steps:st([['Extraire la balance comptable',1],['Contrôler les provisions et FNP',1],['Analyser les écarts vs estimate'],['Envoyer le pack à la direction']]),notes:'Fichier : X:\\\\Dossiers\\\\Projet\\\\2026\\\\Octobre\\\\Synthèse.xlsx\\nPack à envoyer avant 12h à Julie (comptabilité).\\nVoir la checklist SharePoint https://exemple.sharepoint.com/sites/equipe'}),
  T({title:'Répondre aux achats sur les écarts de prix',position:1,due:'2026-10-19',notes:'Thomas attend notre analyse depuis jeudi.'}),
  T({title:'Mettre à jour l\\'estimate Q4 avec les volumes moteurs',position:2,due:'2026-10-20',steps:st([['Récupérer les volumes S43'],['Mettre à jour le driver main d\\'œuvre']])}),
  T({title:'Vérifier les heures de la semaine',position:3,repeat:{type:'weekly',wd:5},due:'2026-10-23'}),
  T({title:'Préparer le point mensuel avec le responsable atelier',position:4,due:'2026-10-27'}),
  T({title:'Demander une licence logicielle à l\\'IT',position:5}),
  T({title:'Relire la note de synthèse sur les coûts de non-qualité',position:6,notes:'Version 2 dans Teams.'}),
  T({title:'Rapprochement bancaire',position:7,done:true,doneAt:now-2*3600000}),
  T({title:'Saisie des écritures de régularisation',position:8,done:true,doneAt:now-1*3600000}),
  T({title:'Clôture septembre : J+3',position:9,done:true,doneAt:now-8*day}),
  T({title:'Revue des stocks pièces de rechange',position:10,done:true,doneAt:now-7*day}),
  T({title:'Budget atelier 2027, première version',position:11,done:true,doneAt:now-1*day}),
 ];
 localStorage.setItem('odj.data.v1', JSON.stringify({app:'ordre-du-jour',schema:1,savedAt:now,settings:{theme:'auto',addTo:'bottom',holidays:true,doneTodayOpen:false},tasks}));
}"""
with sync_playwright() as p:
    b=p.chromium.launch()
    def shot(name, w=1366, h=820, scheme='light', actions=None):
        ctx=b.new_context(viewport={'width':w,'height':h}, locale='fr-FR', timezone_id='Europe/Paris', color_scheme=scheme)
        pg=ctx.new_page(); pg.goto(URL); pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(300)
        if actions: actions(pg)
        pg.wait_for_timeout(250)
        pg.screenshot(path=str(OUT/name)); ctx.close()
    shot('10-main.png')
    shot('11-dark.png', scheme='dark')
    shot('12-today.png', actions=lambda pg: pg.click('#tab-today'))
    shot('13-done.png', actions=lambda pg: pg.click('#tab-done'))
    shot('14-search.png', actions=lambda pg: (pg.click('#search'), pg.keyboard.type('julie')))
    shot('15-settings.png', actions=lambda pg: pg.click('#btnSettings'))
    shot('16-shortcuts.png', actions=lambda pg: pg.click('#btnShortcuts'))
    shot('17-narrow-list.png', w=640, h=800)
    shot('18-narrow-detail.png', w=640, h=800, actions=lambda pg: pg.locator('#list .row').nth(0).click())
    shot('19-quickadd.png', actions=lambda pg: (pg.click('#qaInput'), pg.keyboard.type('Appeler le contrôle de gestion groupe @ven')))
    shot('20-empty.png', actions=lambda pg: (pg.evaluate("localStorage.clear()"), pg.reload()))
    shot('21-recurring-done.png', actions=lambda pg: (pg.locator('#list .row').nth(1).locator('.check').click(), pg.wait_for_timeout(900), pg.locator('[data-toggle]').click()))
    b.close()
