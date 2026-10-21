# Mise en service du serveur de synchronisation (Supabase)

Durée : environ 15 minutes, une seule fois. Rien n'est à installer sur l'ordinateur.

## 1. Créer la base (SQL)
Dans le projet Supabase : **SQL Editor** → **New query** → coller tout le contenu de `schema.sql` → **Run**.
Résultat attendu : « Success. No rows returned ».

## 2. Créer la fonction d'envoi des rappels
**Edge Functions** → **Deploy a new function** → **Via Editor**.
- Nom de la fonction : `send-reminders` (exactement).
- Remplacer tout le code par le contenu de `functions/send-reminders/index.ts` → **Deploy function**.
- Ouvrir la fonction → onglet **Details** (ou Settings) → désactiver **Verify JWT / Enforce JWT verification** → **Save**.
  La fonction se protège elle-même avec un jeton secret connu de la base seule.

## 3. Programmer l'envoi chaque minute (SQL)
**SQL Editor** → **New query** → coller le contenu de `cron.sql` (je fournis la version qui contient déjà l'adresse du projet) → **Run**.

## 4. E-mail de connexion avec code
**Authentication** → **Emails** (ou Email Templates). Modifier **deux** modèles : **Confirm signup** et **Magic Link**.
- Objet : `Votre code To do list`
- Contenu (remplacer tout) :

```html
<h2>Votre code de connexion</h2>
<p>Saisissez ce code dans To do list :</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Il est valable une heure. Si vous n'avez rien demandé, ignorez ce message.</p>
```

**Authentication** → **URL Configuration** → **Site URL** : `https://kgrebachev-afk.github.io/to-do-list/`

## Bon à savoir
- Le service d'e-mails intégré à Supabase limite le nombre d'e-mails par heure : suffisant pour soi,
  trop juste si beaucoup de collègues se connectent le même jour. Dans ce cas, brancher un service
  d'envoi (Authentication → SMTP Settings ; par exemple Resend, offre gratuite).
- Le serveur ne stocke que du contenu chiffré sur les appareils : tâches, notes et texte des rappels
  sont illisibles pour lui. Il connaît l'adresse e-mail, le nombre de tâches et l'heure des rappels.
