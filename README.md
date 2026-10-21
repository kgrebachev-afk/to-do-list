# To do list

Liste de tâches personnelle pour le bureau : priorités par ordre, étapes, notes, rappels, tâches récurrentes (jours ouvrés, fériés français).

**Utiliser l'application : https://kgrebachev-afk.github.io/to-do-list/**

Ouvrir le lien dans Google Chrome, puis cliquer sur **Installer**. Chaque personne a sa propre liste : les tâches restent sur son ordinateur (navigateur et, si on le souhaite, un fichier de sauvegarde dans son OneDrive). L'application ne se connecte à aucun serveur et fonctionne hors ligne une fois installée.

## Contenu du dépôt
- `src/` : code source (page, styles, logique, service worker, manifeste, icônes, polices).
- `docs/` : version publiée sur GitHub Pages (générée, ne pas modifier à la main).
- `build.mjs` : `node build.mjs` génère `dist/to-do-list.html` (fichier unique, utilisable sans Internet) et `dist/web/` (version installable), à copier dans `docs/`.
- `tests/` : tests automatiques (Playwright).
- `SPEC.md` : spécification commune avec la future version mobile.

Polices Barlow et Barlow Semi Condensed : SIL Open Font License 1.1 (`src/fonts/OFL.txt`).
