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
| Rappels | Optionnels, par tâche : date + heure. Raccourcis « Dans 1 h », « Demain à 9 h », « Le jour J à 9 h », « La veille à 17 h » ; jeton `@14h`, `@9h30` à la saisie. Si l'échéance bouge, le rappel garde le même écart. Tâche répétée : chaque occurrence reçoit son rappel avec le même écart (ex. la veille à 17 h). Au déclenchement : notification système + carte avec Ouvrir, Terminer, Reporter (10 min, 1 h, demain). Un rappel réglé dans le passé ne sonne pas. Rappels manqués (appareil éteint) affichés au retour avec leur retard. |
| Matrice | Onglet « Matrice » (urgent / important, méthode Eisenhower) : 4 cadrans (urgent et important = à faire maintenant ; important pas urgent = à planifier ; urgent pas important = à expédier ou déléguer ; ni l'un ni l'autre = plus tard) + colonne « À classer ». L'importance se décide à la main (boutons, glisser-déposer, touche I). L'urgence est automatique selon l'échéance (seuil réglable, 2 jours par défaut ; un rappel en attente rend urgent), avec possibilité de la forcer (touche U, glisser-déposer). Une tâche « à planifier » passe seule en « à faire maintenant » quand son échéance approche. Dans chaque cadran, l'ordre est celui de la liste ; glisser une tâche avant ou après une autre change aussi son rang dans la liste. Occurrence suivante d'une tâche répétée : importance conservée, urgence remise en automatique. |
| Synchronisation | Optionnelle : même liste sur PC, Android et iPhone. Connexion par e-mail + code à 6 chiffres ; phrase secrète choisie une fois (PBKDF2-SHA256 310 000 itérations → AES-GCM 256, clé non exportable gardée sur l'appareil). Le serveur ne reçoit que du contenu chiffré (tâches, réglages partagés, texte des rappels). Fusion tâche par tâche (la plus récente l'emporte, suppressions respectées). Rappels envoyés par le serveur en notification push à l'heure prévue, même application fermée ; même étiquette que les rappels affichés par l'application, donc pas de doublon. Phrase secrète changée sur un appareil : les autres se bloquent et la redemandent avant d'envoyer quoi que ce soit. |
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

## Version Bureau et mobile (v1.5.0 : synchronisation chiffrée et notifications push)
- Application web installable (PWA) publiée sur GitHub Pages : https://kgrebachev-afk.github.io/to-do-list/ . Installée dans Chrome, elle garde l'accès au fichier de sauvegarde (plus de pause), fonctionne hors ligne (service worker) et se met à jour seule. Chaque utilisateur a ses propres tâches, stockées sur son poste : le lien se partage librement.
- Variante fichier unique `to-do-list.html` (sans Internet), même code. Aucune installation, aucune connexion réseau (CSP `connect-src 'none'`).
- Stockage : navigateur + fichier JSON (OneDrive conseillé) choisi une seule fois via une carte de mise en route, puis écrit tout seul à chaque modification. Après un redémarrage de Chrome, l'accès au fichier est redemandé au premier clic dans l'app (« Autoriser à chaque visite » le rend définitif). Choisir un fichier existant fusionne au lieu d'écraser. Si le fichier a changé ailleurs, fusion tâche par tâche (la modification la plus récente l'emporte, les suppressions récentes sont respectées via `deleted`), copie de sécurité des deux versions avant fusion.
- Tests : 57 tests fonctionnels + 13 de régression + 47 sur les rappels (Playwright, horloge simulée) + 12 sur la sauvegarde automatique + 19 sur la version installable + 36 sur la matrice + 41 sur la synchronisation (faux serveur) + 30 sur la base (PGlite) + 10 sur la fonction d'envoi (Deno), trois relectures indépendantes, deux relectures de code indépendantes.
- Rappels : vérification toutes les 15 s tant que la page est ouverte dans Chrome (onglet épinglé conseillé : Chrome ne le désactive jamais) (un seul onglet sonne, verrou Web Locks) ; notification Windows si la page n'est pas au premier plan et que l'utilisateur l'a autorisée, sinon carte + son dans la page ; rattrapage au retour si Edge était fermé ou l'onglet en veille. Export « Ajouter à Outlook » (.ics avec alarme et série équivalente : jour ouvré = lun-ven, Nᵉ jour ouvré = BYSETPOS ≤ 4, dernier jour ouvré = BYSETPOS -1 ; Outlook ignore les jours fériés).
- Polices Barlow / Barlow Semi Condensed embarquées (OFL).

## Serveur (Supabase)
- `supabase/schema.sql` (tables chiffrées, RLS, fonctions), `supabase/functions/send-reminders` (Web Push, VAPID créées au premier passage), `supabase/cron.sql` (chaque minute). Guide : `supabase/INSTALLATION.md`.

## Version mobile native (plus tard, facultatif)
- La PWA couvre Android et iPhone (iOS 16.4+, installée sur l'écran d'accueil). Une app native (Expo) ne serait utile que pour une publication sur les stores.
- Expo (React Native) + TypeScript, SQLite local.
- Rappels : notifications locales programmées par le système (expo-notifications), donc fiables même appli fermée ; reprogrammer à chaque modification et à chaque nouvelle occurrence ; actions de notification Terminer / Reporter.
- Reprendre telles quelles les règles de ce document (répétitions, jetons @, ordre, modèle de données).
- Gestes : glisser pour cocher, appui long pour déplacer.
