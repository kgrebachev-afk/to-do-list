# Rappels : horloge simulée (Playwright clock), notifications Windows simulées
import sys as _sys, pathlib as _pl; _sys.path.insert(0, str(_pl.Path(__file__).resolve().parent)); from paths import ROOT, TMP, SHOTS
import pathlib, re, json
from playwright.sync_api import sync_playwright
ROOT=ROOT; URL=(ROOT/'dist/to-do-list.html').as_uri()
OUT=SHOTS
res=[]; errs=[]
def check(n,c,i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n+('' if c else f' — {i}'))
MOCK = """
window.__notes = []; window.__focus = true;
class FakeNotification { constructor(title, o) { this.title = title; this.o = o; window.__notes.push({ title, body: o.body, tag: o.tag, sticky: o.requireInteraction, silent: o.silent }); }
  close() { this.closed = true; } static get permission() { return window.__perm || 'granted'; } static requestPermission() { return Promise.resolve(window.__perm || 'granted'); } }
window.Notification = FakeNotification;
document.hasFocus = () => window.__focus;
"""
T0 = '2026-10-20T08:00:00+02:00'
def page(ctx, seed=True):
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(200)
    return pg
tasks = lambda pg: pg.evaluate('window.__odj.state().tasks')
task = lambda pg, title: [t for t in tasks(pg) if t['title']==title][0]
notes = lambda pg: pg.evaluate('window.__notes')
cards = lambda pg: pg.locator('#rcards .rcard .rtitle').all_inner_texts()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(locale='fr-FR', timezone_id='Europe/Paris', viewport={'width':1366,'height':820}, accept_downloads=True)
    ctx.add_init_script(MOCK)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.install(time=T0)
    pg.goto(URL); pg.wait_for_timeout(300)

    # --- 1. saisie rapide
    for t in ['Appeler la banque @14h30', 'Relancer achats @demain @9h', 'Point Marc @7h']:
        pg.fill('#qaInput', t); pg.press('#qaInput','Enter')
    t1, t2, t3 = task(pg,'Appeler la banque'), task(pg,'Relancer achats'), task(pg,'Point Marc')
    check('@14h30 → rappel aujourd\'hui 14:30', t1['remind'] and (t1['remind']['date'], t1['remind']['time'])==('2026-10-20','14:30'), t1['remind'])
    check('@demain @9h → échéance et rappel demain 9:00', t2['due']=='2026-10-21' and (t2['remind']['date'], t2['remind']['time'])==('2026-10-21','09:00'), t2)
    check('@7h déjà passé aujourd\'hui → demain 7:00', (t3['remind']['date'], t3['remind']['time'])==('2026-10-21','07:00'), t3['remind'])
    check('puce de rappel dans la liste', '14:30' in pg.locator('#list .row', has_text='Appeler la banque').inner_text())

    # --- 2. réglage dans le détail
    pg.locator('#list .row', has_text='Appeler la banque').click()
    pg.fill('#dRemTime', '08:20'); pg.locator('#dRemTime').dispatch_event('change')
    t1 = task(pg,'Appeler la banque')
    check('heure modifiée dans le détail', t1['remind']['time']=='08:20' and not t1['remind']['fired'], t1['remind'])
    check('texte d\'aide du rappel', "aujourd'hui à 08:20" in pg.locator('#dRemHint').inner_text(), pg.locator('#dRemHint').inner_text())
    check('tâche avec rappel du jour dans « Aujourd\'hui »', pg.locator('#count-today').inner_text()=='1', pg.locator('#count-today').inner_text())

    # --- 3. déclenchement, fenêtre en arrière-plan → notification Windows + carte
    pg.evaluate('window.__focus = false')
    pg.clock.run_for('20:30')  # 08:20:30
    pg.wait_for_timeout(100)
    n = notes(pg)
    check('notification Windows envoyée à l\'heure', len(n)==1 and n[0]['title']=='Appeler la banque' and n[0]['sticky'] is True, n)
    check('carte de rappel affichée', cards(pg)==['Appeler la banque'], cards(pg))
    check('titre de l\'onglet signale le rappel', pg.evaluate("new Promise(r=>setTimeout(()=>r(document.title),1400))") is not None)
    pg.clock.run_for(1400)
    check('titre clignote', pg.evaluate('document.title').startswith('🔔') or 'Rappel' in pg.evaluate('document.title'), pg.evaluate('document.title'))
    pg.screenshot(path=str(OUT/'30-reminder-card.png'))
    # pas de double déclenchement
    pg.clock.run_for('01:00'); pg.wait_for_timeout(50)
    check('pas de second déclenchement', len(notes(pg))==1, len(notes(pg)))

    # --- 4. annuler après déclenchement ne refait pas sonner
    pg.fill('#qaInput','Tâche tampon'); pg.press('#qaInput','Enter'); pg.locator('#list').focus()
    pg.keyboard.press('Control+z'); pg.clock.run_for('00:30'); pg.wait_for_timeout(50)
    check('Ctrl+Z après déclenchement : pas de nouvelle notification', len(notes(pg))==1, len(notes(pg)))

    # --- 5. reporter de 10 min
    pg.locator('#rcards .rcard', has_text='Appeler la banque').locator('[data-ract="snz:10m"]').click()
    check('report : carte masquée', cards(pg)==[], cards(pg))
    check('report : puce indique l\'heure reportée', '08:3' in pg.locator('#list .row', has_text='Appeler la banque').inner_text(), pg.locator('#list .row', has_text='Appeler la banque').inner_text())
    pg.clock.run_for('10:30'); pg.wait_for_timeout(50)
    check('report : nouveau rappel 10 min plus tard', len(notes(pg))==2 and cards(pg)==['Appeler la banque'], (len(notes(pg)), cards(pg)))

    # --- 6. Terminer depuis la carte
    pg.locator('#rcards [data-ract="done"]').click(); pg.wait_for_timeout(100)
    check('Terminer depuis la carte', task(pg,'Appeler la banque')['done'] and cards(pg)==[], cards(pg))
    check('titre normal une fois traité', 'To do list' in pg.evaluate('document.title') and '🔔' not in pg.evaluate('document.title'), pg.evaluate('document.title'))

    # --- 7. page au premier plan → pas de notification Windows, carte + son
    pg.evaluate('window.__focus = true')
    pg.locator('#list .row', has_text='Point Marc').click()
    pg.locator('[data-rem="1h"]').click()
    r = task(pg,'Point Marc')['remind']
    check('« Dans 1 h » arrondi aux 5 minutes', r['date']=='2026-10-20' and r['time'] in ('09:35','09:40'), r)
    pg.clock.run_for('01:10:00'); pg.wait_for_timeout(50)
    check('au premier plan : carte sans notification Windows', len(notes(pg))==2 and cards(pg)==['Point Marc'], (len(notes(pg)), cards(pg)))
    pg.locator('#rcards [data-ract="ok"]').first.click()
    check('fermer la carte', cards(pg)==[])

    # --- 8. heure passée : pas de déclenchement
    pg.locator('#list .row', has_text='Relancer achats').click()
    pg.fill('#dRemDate', '2026-10-20'); pg.locator('#dRemDate').dispatch_event('change')
    pg.fill('#dRemTime', '07:00'); pg.locator('#dRemTime').dispatch_event('change')
    check('heure passée signalée, pas de rappel', 'déjà passée' in pg.locator('#dRemHint').inner_text() and cards(pg)==[], pg.locator('#dRemHint').inner_text())

    # --- 9. l'échéance bouge, le rappel suit
    pg.locator('[data-rem="eve"]').click()
    r = task(pg,'Relancer achats')['remind']
    check('« La veille à 17 h »', (r['date'], r['time'])==('2026-10-20','17:00'), r)
    pg.fill('#dDue','2026-10-28'); pg.locator('#dDue').dispatch_event('change')
    r = task(pg,'Relancer achats')['remind']
    check('échéance décalée de 7 j → rappel décalé de 7 j', (r['date'], r['time'])==('2026-10-27','17:00'), r)

    # --- 10. récurrence : le rappel suit chaque occurrence
    pg.fill('#qaInput','Clôture J+3'); pg.press('#qaInput','Enter')
    pg.locator('#list .row', has_text='Clôture J+3').click()
    pg.locator('#dRepeat').select_option('nth'); pg.fill('#dNth','3'); pg.locator('#dNth').dispatch_event('input')
    pg.locator('[data-rem="eve"]').click()
    t = task(pg,'Clôture J+3')
    check('répétition + rappel la veille 17 h', t['due']=='2026-11-04' and (t['remind']['date'],t['remind']['time'])==('2026-11-03','17:00'), (t['due'], t['remind']))
    check('texte : suit chaque occurrence', 'la veille à 17 h' in pg.locator('#dRemHint').inner_text(), pg.locator('#dRemHint').inner_text())
    pg.locator('#dDone').check(); pg.wait_for_timeout(100)
    nxt = [x for x in tasks(pg) if x['title']=='Clôture J+3' and not x['done']][0]
    check('occurrence suivante : rappel la veille du 3 déc.', nxt['due']=='2026-12-03' and (nxt['remind']['date'],nxt['remind']['time'])==('2026-12-02','17:00') and not nxt['remind']['fired'], (nxt['due'], nxt['remind']))
    check('même série (seriesId)', nxt['seriesId']==t['id'], (nxt['seriesId'], t['id']))

    # --- 11. Outlook .ics
    pg.locator('#list .row', has_text='Clôture J+3').click()
    with pg.expect_download() as d: pg.locator('#dIcs').click()
    ics = open(d.value.path(), 'rb').read().decode('utf-8')
    check('fichier .ics téléchargé', d.value.suggested_filename=='rappel-cloture-j-3.ics', d.value.suggested_filename)
    check('.ics : CRLF et lignes ≤ 75 octets', '\r\n' in ics and all(len(l.encode())<=75 for l in ics.split('\r\n')), max(len(l.encode()) for l in ics.split('\r\n')))
    check('.ics : série Outlook « 3e jour de semaine du mois »', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=3' in ics, ics)
    check('.ics : début le 3 déc. 17:00 heure de Paris, alerte la veille', 'DTSTART;TZID=Europe/Paris:20261203T170000' in ics and 'TRIGGER:-P1D' in ics and 'BEGIN:VTIMEZONE' in ics, re.findall(r'DTSTART.*|TRIGGER.*', ics))
    check('.ics : UID stable de la série', f"UID:{t['id']}@ordre-du-jour" in ics)
    check('.ics : non bloquant dans l\'agenda', 'TRANSP:TRANSPARENT' in ics)

    # --- 12. rappel manqué pendant que la page était fermée
    pg.fill('#qaInput','Envoyer le pack @10h'); pg.press('#qaInput','Enter')
    pg.close()
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.install(time='2026-10-20T11:30:00+02:00')
    pg.goto(URL); pg.wait_for_timeout(400)
    pg.evaluate('window.__focus = false')
    pg.clock.run_for('00:20'); pg.wait_for_timeout(100)
    check('rappel manqué rattrapé à l\'ouverture', 'Envoyer le pack' in cards(pg), cards(pg))
    head = pg.locator('#rcards .rcard', has_text='Envoyer le pack').locator('.rhead').inner_text()
    check('retard indiqué sur la carte', '10:00' in head and 'il y a 1 h 30' in head, head)
    pg.screenshot(path=str(OUT/'31-missed.png'))
    # rechargement : la carte non traitée revient, sans nouvelle notification
    n_before = len(notes(pg)); pg.reload(); pg.wait_for_timeout(400); pg.clock.run_for('00:20')
    check('après rechargement : carte toujours là, pas de doublon', 'Envoyer le pack' in cards(pg) and len(notes(pg))==0, (cards(pg), notes(pg)))

    # --- 13. deux onglets : un seul sonne
    pg.locator('#rcards [data-ract="ok"]').first.click()
    pg2 = ctx.new_page(); pg2.clock.install(time='2026-10-20T11:31:00+02:00'); pg2.goto(URL); pg2.wait_for_timeout(300)
    pg.fill('#qaInput','Deux onglets @11h45'); pg.press('#qaInput','Enter'); pg.wait_for_timeout(200)
    pg2.reload(); pg2.wait_for_timeout(200)
    for x in (pg, pg2): x.evaluate('window.__focus=false')
    pg.clock.run_for('15:00'); pg2.clock.run_for('15:00'); pg.wait_for_timeout(300)
    total = len([n for n in notes(pg)+notes(pg2) if n['title']=='Deux onglets'])
    check('deux onglets ouverts : une seule notification', total==1, total)
    pg2.close()

    # --- 14. réglages
    pg.click('#btnSettings')
    check('réglages : état des notifications', 'activées' in pg.locator('#setRemText').inner_text(), pg.locator('#setRemText').inner_text())
    pg.screenshot(path=str(OUT/'32-settings-rem.png'))
    pg.click('[data-rset="test"]'); pg.keyboard.press('Escape')
    pg.clock.run_for(5500); pg.wait_for_timeout(100)
    check('rappel de test au bout de 5 s', 'Rappel de test' in cards(pg), cards(pg))
    pg.locator('#rcards [data-ract="ok"]').first.click()

    # --- 15. notifications refusées : carte + son quand même
    pg3 = ctx.new_page(); pg3.add_init_script('window.__perm="denied"'); pg3.clock.install(time='2026-10-20T12:00:00+02:00'); pg3.goto(URL); pg3.wait_for_timeout(300)
    pg.close()
    pg3.fill('#qaInput','Sans notifications @12h10'); pg3.press('#qaInput','Enter')
    pg3.locator('#list .row', has_text='Sans notifications').click()
    check('aide : notifications non activées', 'non activées' in pg3.locator('#dRemHint').inner_text(), pg3.locator('#dRemHint').inner_text())
    pg3.evaluate('window.__focus=false'); pg3.clock.run_for('10:30'); pg3.wait_for_timeout(100)
    check('notifications refusées : carte affichée, aucune notification', 'Sans notifications' in cards(pg3) and not [n for n in notes(pg3) if n['title']=='Sans notifications'], (cards(pg3), notes(pg3)))

    # --- 16. relecture : annuler après un report ne refait pas sonner
    for title in [c for c in cards(pg3) if c != 'Sans notifications']:
        pg3.locator('#rcards .rcard', has_text=title).locator('[data-ract="ok"]').first.click()
    pg3.locator('#rcards .rcard', has_text='Sans notifications').locator('[data-ract="snz:10m"]').click()
    pg3.fill('#qaInput','Tampon'); pg3.press('#qaInput','Enter')
    pg3.clock.run_for('10:30'); pg3.wait_for_timeout(50)
    pg3.locator('#rcards [data-ract="ok"]').first.click()
    pg3.locator('#list').focus(); pg3.keyboard.press('Control+z'); pg3.clock.run_for('00:30'); pg3.wait_for_timeout(50)
    check('annuler après report + fermeture : pas de nouvelle sonnerie', cards(pg3)==[], cards(pg3))
    # --- 17. clavier sur une carte : Suppr n'efface pas la tâche sélectionnée, Échap ferme la carte
    pg3.fill('#qaInput','Tampon'); pg3.press('#qaInput','Enter')
    pg3.fill('#qaInput','Carte clavier @12h40'); pg3.press('#qaInput','Enter')
    pg3.locator('#list .row', has_text='Tampon').click()
    pg3.clock.run_for('20:00'); pg3.wait_for_timeout(50)
    pg3.locator('#rcards [data-ract="open"]').first.focus(); pg3.keyboard.press('Delete')
    check('Suppr sur une carte : aucune tâche supprimée', 'Tampon' in [t['title'] for t in tasks(pg3)])
    pg3.locator('#rcards [data-ract="open"]').first.focus(); pg3.keyboard.press('Escape')
    check('Échap ferme la carte et rend le focus à la liste', cards(pg3)==[] and pg3.evaluate('document.activeElement.id')=='list', (cards(pg3), pg3.evaluate('document.activeElement.id')))
    # --- 18. .ics : point-virgule échappé
    ics = pg3.evaluate("""()=>window.__odj.buildIcs([{id:'a',title:'Réunion; budget, Q4',notes:'',steps:[],due:null,repeat:null,remind:{date:'2026-10-21',time:'10:00'}}]).text""")
    BS=chr(92); check('.ics : ; et , échappés', ('SUMMARY:Réunion'+BS+'; budget'+BS+', Q4') in ics, [l for l in ics.split(chr(13)+chr(10)) if l.startswith('SUMMARY')])
    # --- 19. restauration d'un point : un rappel déjà traité ne resonne pas
    pg3.evaluate("""()=>{ const s=window.__odj.state(); const t=s.tasks.find(x=>x.title==='Carte clavier'); const snap=JSON.parse(JSON.stringify(s.tasks)); snap.find(x=>x.id===t.id).remind={date:t.remind.date,time:t.remind.time,fired:false,ack:false,snooze:null,firedAt:null}; localStorage.setItem('odj.snapshots.v1', JSON.stringify([{day:'2026-10-20',at:Date.now(),tasks:snap}])); }""")
    pg3.click('#btnSettings'); pg3.locator('[data-snap="0"]').click(); pg3.locator('#dlgConfirm [data-choice="ok"]').click(); pg3.wait_for_timeout(100)
    pg3.clock.run_for('00:30'); pg3.wait_for_timeout(50)
    check('restauration : pas de rappel ressuscité', cards(pg3)==[], cards(pg3))
    b.close()
print('ERREURS:', errs or 'aucune'); print(f'{sum(res)}/{len(res)} OK')
