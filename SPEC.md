# Ordre du jour — spécification commune (Bureau et Mobile)

Deux applications séparées, sans données partagées, qui respectent le même cahier des charges.
Ce document est le « contrat » : la version Mobile devra le suivre à l'identique.

## Principe
- L'ordre de la liste est la priorité. Pas de champ « priorité ».
- Une tâche se crée en une ligne, se détaille ensuite (étapes, notes, échéance, répétition).

## Fonctionnalités (v1)
| Fonction | Règle |
|---|---|
| Ajout rapide | Entrée = ajouter (en bas par défaut, réglable) ; Alt+Entrée = autre bout. Jetons `@auj`, `@demain`, `@apres-demain`, `@lun`…`@dim` (prochain jour, jamais aujourd'hui), `@sem-pro`, `@25/10`, `@25/10/2027` (date passée sans année → année suivante). |
| Classement | Glisser-déposer ; Alt+↑/↓ ; Alt+Maj+↑/↓ = tête/fin de liste. Rang affiché 1, 2, 3… |
| Terminer | Case à cocher ; annulation possible. Tâche répétée → l'occurrence suivante est créée, étapes décochées, notes conservées. Rouvrir supprime l'occurrence suivante si elle n'a pas été modifiée. |
| Détail | Titre, échéance (raccourcis Aujourd'hui / Demain / Lundi prochain / Sans date), répétition, étapes (Entrée = nouvelle étape, coller plusieurs lignes = plusieurs étapes), notes libres avec détection des liens web et chemins Windows. |
| Répétitions | Chaque jour ouvré ; chaque semaine (même jour) ; chaque mois même date (31 → dernier jour du mois) ; chaque mois Nᵉ jour ouvré ; chaque mois dernier jour ouvré. Jours ouvrés = lun-ven hors fériés français (option). |
| Vues | À faire (+ « Terminées aujourd'hui » repliable) ; Aujourd'hui (échéance ≤ aujourd'hui, ordre de priorité) ; Terminées (par semaine ISO, récap copiable). |
| Onglet Récurrentes | Les tâches qui se répètent sont rangées dans un onglet à part, triées par prochaine échéance (« Cette semaine et en retard », « Plus tard »), avec leur rythme et leur rappel. Elles reviennent dans À faire (et la matrice) le jour de l'échéance, dès que leur rappel est passé, ou plus tôt selon le réglage (1 jour, 3 jours, 1 semaine avant, ou toujours). Lien « N tâches récurrentes à venir » en bas d'À faire ; saisie dans l'onglet = tâche hebdomadaire dès aujourd'hui. Raccourci Maj+4 (Terminées : Maj+5). |
| Mises à jour | Automatiques : appliquées à l'ouverture, ou dès que l'application passe en arrière-plan (proposées si une saisie est en cours). Tâches, synchronisation, sauvegarde automatique, notifications et préférences sont conservées ; un message le confirme après la mise à jour. |
| Rappels | Optionnels, par tâche : date + heure. Raccourcis « Dans 1 h », « Demain à 9 h », « Le jour J à 9 h », « La veille à 17 h » ; jeton `@14h`, `@9h30` à la saisie. Si l'échéance bouge, le rappel garde le même écart. Tâche répétée : le rappel se règle par rapport à chaque occurrence (« Le jour même », « La veille », « 2 ou 3 jours avant », « 1 semaine avant » + heure), sans date à choisir ; chaque occurrence reçoit son rappel et le prochain est annoncé. Au déclenchement : notification système + carte avec Ouvrir, Terminer, Reporter (10 min, 1 h, demain). Un rappel réglé dans le passé ne sonne pas. Rappels manqués (appareil éteint) affichés au retour avec leur retard. |
| Matrice | Onglet « Matrice » (urgent / important, méthode Eisenhower) : 4 cadrans (urgent et important = à faire maintenant ; important pas urgent = à planifier ; urgent pas important = à expédier ou déléguer ; ni l'un ni l'autre = plus tard) + colonne « À classer ». L'importance se décide à la main (boutons, glisser-déposer, touche I). L'urgence est automatique selon l'échéance (seuil réglable, 2 jours par défaut ; un rappel en attente rend urgent), avec possibilité de la forcer (touche U, glisser-déposer). Une tâche « à planifier » passe seule en « à faire maintenant » quand son échéance approche. Dans chaque cadran, l'ordre est celui de la liste ; glisser une tâche avant ou après une autre change aussi son rang dans la liste. Occurrence suivante d'une tâche répétée : importance conservée, urgence remise en automatique. |
| Synchronisation | Optionnelle : même liste sur PC, Android et iPhone. **Jumelage par QR code**, sans e-mail ni mot de passe. Le premier appareil crée un « code de synchronisation » (20 caractères, base 32 de Crockford, ~95 bits) d'où sont dérivées par HKDF-SHA256 une clé de chiffrement AES-GCM 256 (jamais transmise) et une clé d'accès (le serveur n'en garde que l'empreinte SHA-256). **Ajout d'un appareil : QR code à usage unique**, valable 10 minutes et annulé dès qu'il quitte l'écran (13 caractères, 60 bits) : il permet seulement de récupérer une fois le code, déposé chiffré par l'appareil qui l'affiche ; cet appareil indique « Utilisé à HH:MM ». Scanner intégré, appareil photo du téléphone (lien limité à l'adresse de l'application) ou saisie. **Confirmation toujours demandée** avant de connecter un appareil, avec le contenu de la liste visée (date de création, nombre de tâches, appareils) et une mise en garde. Le code de 20 caractères n'est montré que comme **code de secours** (flouté, à noter sur papier). « Changer de code » : nouveau compte, ancien retiré définitivement (impossible à recréer) une fois tout envoyé avec le nouveau ; les autres appareils se bloquent jusqu'à ce qu'ils scannent un nouveau QR code, leurs tâches étant alors fusionnées. Fusion tâche par tâche (la plus récente l'emporte, suppressions respectées) ; contenu, date et suppressions authentifiés par le chiffrement ; une ancienne version rejouée par le serveur est ignorée. Rappels envoyés par le serveur en notification push, même application fermée ; le texte n'est affiché que pour un rappel du moment. Serveur : quotas (10 Mo et 20 000 éléments par liste, 300 rappels, 6 appareils), garde-fou global d'espace, créations limitées par adresse réelle, réservation équitable des rappels avec reprise automatique. Voir SECURITY.md. |
| Recherche | Titre, notes et étapes, sans tenir compte des accents. |
| Annuler / Rétablir | Toute action, jusqu'à 100 pas. |
| Sauvegarde | Locale automatique + points de restauration quotidiens (7 jours) + export/import JSON, export texte. |

## Modèle de données (schéma 1)
```json
{
  "app": "ordre-du-jour", "schema": 1, "savedAt": 1760970000000,
  "settings": { "theme": "auto|light|dark", "addTo": "bottom|top", "holidays": true, "doneTodayOpen": false, "urgentDays": 2, "remindTime": "09:00", "remindSound": true, "remindSticky": true },
  "tasks": [{
    "id": "uuid", "title": "…", "notes": "…",
    "steps": [{ "id": "uuid", "text": "…", "done": false }],
    "done": false, "doneAt": null, "position": 3.5,
    "due": "2026-11-04",
    "repeat": { "type": "nth", "n": 3 },
    "createdAt": 0, "updatedAt": 0, "spawnedId": null, "seriesId": "uuid de la 1re occurrence",
    "remind": { "date": "2026-11-03", "time": "17:00", "fired": false, "ack": false, "snooze": null, "firedAt": null },
    "matrix": { "important": true, "urgent": null }
  }],
  "deleted": { "uuid-supprimé": 1760970000000 }
}
```
`repeat` : `null` ou `{type:"workday"}`, `{type:"weekly", wd:0-6}`, `{type:"monthly", dom:1-31}`, `{type:"nth", n:1-23}`, `{type:"last"}`.
Dates d'échéance en `AAAA-MM-JJ` heure locale ; horodatages en millisecondes.
Le même format d'export permet de passer une tâche d'une application à l'autre.

## Version Bureau et mobile (v1.8.0 : onglet Récurrentes, mises à jour automatiques sans rien à refaire)
- Application web installable (PWA) publiée sur GitHub Pages : https://kgrebachev-afk.github.io/to-do-list/ . Installée dans Chrome, elle garde l'accès au fichier de sauvegarde (plus de pause), fonctionne hors ligne (service worker) et se met à jour seule. Chaque utilisateur a ses propres tâches, stockées sur son poste : le lien se partage librement.
- Variante fichier unique `to-do-list.html` (sans Internet), même code. Aucune installation, aucune connexion réseau (CSP `connect-src 'none'`).
- Stockage : navigateur + fichier JSON (OneDrive conseillé) choisi une seule fois via une carte de mise en route, puis écrit tout seul à chaque modification. Après un redémarrage de Chrome, l'accès au fichier est redemandé au premier clic dans l'app (« Autoriser à chaque visite » le rend définitif). Choisir un fichier existant fusionne au lieu d'écraser. Si le fichier a changé ailleurs, fusion tâche par tâche (la modification la plus récente l'emporte, les suppressions récentes sont respectées via `deleted`), copie de sécurité des deux versions avant fusion.
- Tests : 57 tests fonctionnels + 13 de régression + 58 sur les rappels (Playwright, horloge simulée) + 12 sur la sauvegarde automatique + 19 sur la version installable + 36 sur la matrice + 81 sur la synchronisation, 5 sur le jumelage et les blocages, 15 sur l'onglet Récurrentes, 11 sur les mises à jour (faux serveur) + 97 sur la base (PGlite) + 15 sur la fonction d'envoi (Deno, deux types de clés), trois relectures indépendantes, deux relectures de code indépendantes, un audit de sécurité complet en trois volets (application, serveur, dépôt et publication) suivi d'un contre-audit, corrections incluses. Page protégée par une CSP sans 'unsafe-inline' pour les scripts (empreinte SHA-256).
- Rappels : vérification toutes les 15 s tant que la page est ouverte dans Chrome (onglet épinglé conseillé : Chrome ne le désactive jamais) (un seul onglet sonne, verrou Web Locks) ; notification Windows si la page n'est pas au premier plan et que l'utilisateur l'a autorisée, sinon carte + son dans la page ; rattrapage au retour si Edge était fermé ou l'onglet en veille. Export « Ajouter à Outlook » (.ics avec alarme et série équivalente : jour ouvré = lun-ven, Nᵉ jour ouvré = BYSETPOS ≤ 4, dernier jour ouvré = BYSETPOS -1 ; Outlook ignore les jours fériés).
- Polices Barlow / Barlow Semi Condensed embarquées (OFL).

## Serveur (Supabase)
- `supabase/schema.sql` (v2 : comptes identifiés par l'empreinte d'une clé d'accès, tables sans accès direct, fonctions SECURITY DEFINER), `supabase/functions/send-reminders` (Web Push, VAPID créées au premier passage), `supabase/cron.sql` (chaque minute). Guide : `supabase/INSTALLATION.md`.

## Version mobile native (plus tard, facultatif)
- La PWA couvre Android et iPhone (iOS 16.4+, installée sur l'écran d'accueil). Une app native (Expo) ne serait utile que pour une publication sur les stores.
- Expo (React Native) + TypeScript, SQLite local.
- Rappels : notifications locales programmées par le système (expo-notifications), donc fiables même appli fermée ; reprogrammer à chaque modification et à chaque nouvelle occurrence ; actions de notification Terminer / Reporter.
- Reprendre telles quelles les règles de ce document (répétitions, jetons @, ordre, modèle de données).
- Gestes : glisser pour cocher, appui long pour déplacer.
