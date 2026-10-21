# Sécurité de To do list

## Signaler un problème

Merci de ne pas ouvrir de ticket public. Utilisez **Security → Report a vulnerability** sur ce dépôt
(signalement privé GitHub). Réponse sous quelques jours.

## Modèle de sécurité (résumé)

- **Sans synchronisation**, les tâches ne quittent jamais l'appareil (stockage du navigateur, et fichier
  de sauvegarde si activé). La version fichier interdit toute connexion réseau (CSP `connect-src 'none'`).
- **Avec synchronisation**, tout est chiffré sur l'appareil (AES-GCM 256) avant l'envoi. Le serveur
  (Supabase) ne voit que des données chiffrées, des identifiants aléatoires et des dates. La clé de
  chiffrement est dérivée du code de synchronisation (95 bits aléatoires), qui ne quitte jamais
  l'appareil ; le serveur n'en connaît que l'empreinte d'une clé d'accès dérivée.
- **Ajout d'un appareil** : QR code à usage unique, valable 10 minutes. Il permet seulement de récupérer
  une fois le code de synchronisation, déposé chiffré par l'appareil qui l'affiche. L'appareil qui a montré
  le QR code indique quand il a servi. Une confirmation montrant le contenu de la liste est toujours
  demandée avant de connecter un appareil.
- **Code de secours** (20 caractères) : donne accès à la liste sans limite de durée. À noter sur papier,
  jamais à transmettre. En cas de doute : Réglages → **Changer de code** (l'ancien code est retiré
  définitivement côté serveur et ne peut plus être recréé).
- **Serveur** : aucun accès direct aux tables ; uniquement des fonctions qui vérifient la clé d'accès,
  avec quotas (10 Mo et 10 000 éléments par liste, 6 appareils, 300 rappels), garde-fou global
  d'espace, limitation des créations par adresse, validation stricte des abonnements aux notifications.
- **Page** : CSP stricte (script de la page autorisé par empreinte, seuls `jsqr.js` — avec empreinte
  SRI — et `sw.js` de ce site autorisés), refus de s'afficher dans un cadre, aucun script tiers.
- **Fonction d'envoi** : dépendances figées et incluses dans le dépôt (`web-push.js`, régénérable avec
  `tools/bundle-web-push.sh`), jeton du cron vérifié en temps constant, aucune erreur interne renvoyée.

## Risques résiduels connus

- **Compte GitHub** : quiconque peut pousser sur `main` peut publier une version piégée de l'application
  (qui lirait les codes). Protection : double authentification (clé d'accès / passkey) sur GitHub et
  sur le compte Google qui sert à s'y connecter, règles de protection de la branche `main`.
- **Domaine partagé** : `kgrebachev-afk.github.io` est commun à tous les sites GitHub Pages du compte.
  N'activer GitHub Pages sur **aucun autre dépôt** de ce compte (ou passer l'application sur un domaine
  dédié).
- **Disponibilité** : un attaquant déterminé peut saturer l'offre gratuite de Supabase (création de
  listes en masse). Effet : synchronisation suspendue, sans fuite de données ; l'application continue
  de fonctionner hors ligne.
- **Fichier de sauvegarde** : copie en clair de la liste. Le garder dans un dossier personnel.

## En cas d'incident (version piégée publiée, compte compromis)

1. Reprendre le contrôle du compte GitHub (mot de passe Google, sessions, double authentification),
   retirer les applications GitHub et clés inconnues.
2. Revenir à un commit sain : `git revert` des commits suspects (ne pas réécrire l'historique tant que
   l'analyse n'est pas finie), puis republier `docs/` depuis les sources saines (`node build.mjs`).
3. Si un **service worker inconnu** a été publié sous un autre nom : ne pas supprimer le fichier ;
   le remplacer, au même chemin, par `tools/sw-coupe-circuit.js`. Republier aussi `sw.js`.
4. Sur chaque appareil : Réglages → **Changer de code** sur l'un d'eux, puis reconnecter les autres
   avec un nouveau QR code. Les anciens codes sont alors inutilisables.
5. Supabase : vérifier les fonctions de la base (`supabase/schema.sql` à réexécuter) et la fonction
   d'envoi (redéployer `index.ts` + `web-push.js` depuis le dépôt).
