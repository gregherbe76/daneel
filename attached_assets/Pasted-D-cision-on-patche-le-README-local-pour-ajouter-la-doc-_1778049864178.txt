Décision : on patche le README local pour ajouter la doc APP_TEMPLATE 
+ HiringAI alternatif AVANT que je push les commits.

Le README local actuel contient déjà la section "Extend this repo" 
(commit 736f6f1 consolidé). Il manque juste la documentation du switch 
APP_TEMPLATE.

GOAL

Patch ciblé du README local. Pas de réécriture. Deux ajouts seulement.

CONTRAINTES STRICTES

- Aucune modification du Hero, du Provider Marketplace, du Quick 
  Start, de l'Architecture, des Data modes, du Roadmap, du Disclosure, 
  du Built by.
- Aucune modification de VISION.md, NAMING.md, LICENSE, code, tests, 
  config.
- Si tu modifies plus de 30 lignes au total, ARRÊTE — c'est une 
  réécriture, pas un patch.

MODIFICATIONS À APPLIQUER

Modification 1 — Enrichir UNE ligne du tableau "Extend this repo"

Localiser la ligne actuelle :
| White-label with a different brand | See `lib/branding/templates/` |

La remplacer par :
| White-label the UI | Add a template under `lib/branding/src/templates/` and set `APP_TEMPLATE` (server) or `VITE_APP_TEMPLATE` (frontend). Daneel ships with two templates: `daneel` (default) and `hiringai` (alternative example). |

Modification 2 — Ajouter UNE nouvelle sous-section APRÈS le tableau 
"Extend this repo" et AVANT la section "Roadmap"

Format exact :

### White-label templates

Daneel ships with a pluggable branding system. Switch between templates 
via the `APP_TEMPLATE` (server) and `VITE_APP_TEMPLATE` (frontend) 
environment variables. Two templates are included out of the box:

- `daneel` — the default open-source branding
- `hiringai` — an example alternative template, showing how agencies 
  or partners can re-skin the UI without touching the engine

Add your own template under `lib/branding/src/templates/<your-brand>/` 
following the same structure.

Aucune autre modification.

DELIVERABLE

Après modification :
1. Commit local hash : <sha7>
2. Confirmation que le commit existe localement
3. Lignes ajoutées : <nombre, doit être ≤ 15>
4. Lignes modifiées : <nombre, doit être ≤ 3>

Le push vers GitHub sera fait par moi (l'utilisateur), pas par toi. 
Tu ne peux pas pusher, on l'a établi.

Commit message exact :
"docs: document APP_TEMPLATE switch and hiringai alternative template"

STOP

Après le commit local, attends ma confirmation avant toute autre 
action. Je vais ensuite pousser tous les commits non-pushés vers 
GitHub depuis l'interface Replit.