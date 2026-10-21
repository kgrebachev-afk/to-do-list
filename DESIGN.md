# Ordre du jour — notes de conception (version Bureau)

## Sujet
Liste de tâches personnelle d'un contrôleur de gestion en usine (poste Windows verrouillé).
L'ordre de la liste EST la priorité. Usage clavier intensif, sessions longues, écran de bureau.

## Couleurs (clair / sombre)
- Fond « acier »        #EDEFF1 / #11171B
- Feuille (détail)      #FFFFFF / #182127
- Encre graphite        #17232A / #E3E8EB
- Pétrole (action)      #0C6A74 / #47B1BB
- Signal ambre (jour)   #C98204 / #E9A92B
- Rouge retard          #B03A2C / #E06A5A

## Typo
Barlow (corps, 15/1.45) + Barlow Semi Condensed 600 (titres, rangs, compteurs) —
esprit signalétique industrielle (DIN), embarquée en woff2 pour fonctionner hors ligne.

## Mise en page
```
┌ Ordre du jour  mardi 20 octobre, semaine 43 │ À faire 7 │ Aujourd'hui 2 │ Terminées │ [Rechercher] ⌨ ⚙ ┐
├──────────────────────────────┬──────────────────────────────────────────────────────────┤
│ [+ Ajouter une tâche…      ] │  ☐ Marquer comme terminée                    ⤒  🗑         │
│  1  ☐ Clôture J+3   Aujourd'hui │  Titre (grand, condensé)                                  │
│  2  ☐ Relance achats   2/5    │  Échéance [date] Aujourd'hui Demain Lundi                 │
│  3  ☐ …                       │  Répétition [Chaque mois, Nᵉ jour ouvré ▾] [3]            │
│  4  ☐ …                       │  Étapes  ▬▬▬───  ☐ …  + Ajouter une étape                 │
│  ▸ Terminées aujourd'hui (3)  │  Notes [ zone libre ]  liens/chemins détectés            │
├──────────────────────────────┤                                                           │
│ ✓ Enregistré dans ….json 16:42│                                                           │
└──────────────────────────────┴──────────────────────────────────────────────────────────┘
```
Alignement à gauche partout. Le détail est une « feuille » blanche, la liste repose sur le fond acier.

## Principes
- Un seul élément mémorable : les rangs numérotés en condensé (1, 2, 3 plus forts, le 1 en ambre).
  La numérotation est légitime : c'est un classement.
- Tout le reste reste calme : pas de cartes empilées, pas d'ombres partout, pas de majuscules.
- Mouvement uniquement en réponse à une action (cocher, glisser, annuler).
- Rien ne sort du poste : aucune requête réseau, CSP stricte.
