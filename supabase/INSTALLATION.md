# Mise en service du serveur de synchronisation (Supabase)

Durée : environ 10 minutes, une seule fois. Rien n'est à installer sur l'ordinateur.
Aucun réglage d'e-mail ni d'authentification n'est nécessaire : les appareils se jumellent par QR code.

## 1. Créer la base (SQL)
**SQL Editor** → **New query** → coller tout le contenu de `schema.sql` → **Run**.
Résultat attendu : « Success. No rows returned ». Le script est réexécutable ; il remplace aussi
l'ancienne version (connexion par e-mail) en conservant les clés de notification.

## 2. Créer la fonction d'envoi des rappels
**Edge Functions** → **Deploy a new function** → **Via Editor**.
- Nom de la fonction : `send-reminders` (exactement).
- Remplacer tout le code par le contenu de `functions/send-reminders/index.ts` → **Deploy function**.
- Dans les réglages de la fonction, désactiver **Verify JWT** → **Save**.
  La fonction se protège elle-même avec un jeton secret connu de la base seule.

## 3. Programmer l'envoi chaque minute (SQL)
**SQL Editor** → **New query** → coller le contenu de `cron.projet.sql` (adresse du projet déjà renseignée) → **Run**.
Si une extension manque : **Database → Extensions**, activer `pg_cron` et `pg_net`, puis relancer.

## Vérifier
Dans **SQL Editor** : `select status_code, content from net._http_response order by created desc limit 3;`
doit afficher `200` et `{"due":0,"sent":0}` (ou un nombre de rappels envoyés).

## Bon à savoir
- Le serveur ne stocke que du contenu chiffré sur les appareils : tâches, notes et texte des rappels
  lui sont illisibles. Il ne connaît ni e-mail ni nom : seulement une empreinte de la clé d'accès,
  le nombre d'éléments et l'heure des rappels.
- Les listes dont aucun appareil ne s'est connecté depuis plus d'un an sont effacées automatiquement.
