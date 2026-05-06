GOAL

Patch ciblé du README à la racine. Pas une réécriture. Deux ajouts 
seulement.

CONTEXT

Le README actuel sur main est validé et marketing-ready. Il pitche 
Daneel comme moteur OSS, présente les 4 produits commerciaux 
(Scout/Extend/CodeMatch/Council) + BYOK connectors, a un Hero, un 
Quick Start Docker, une section Architecture, des Data modes.

Deux gaps à corriger :
1. Le mécanisme de switch APP_TEMPLATE / VITE_APP_TEMPLATE entre 
   templates daneel (default) et hiringai (alternative) n'est pas 
   documenté.
2. HiringAI n'apparaît plus du tout dans le README. C'est un asset 
   white-label qu'on doit valoriser comme exemple de template 
   alternatif, pas masquer.

CONTRAINTES STRICTES

- Pas de modification du Hero, du Provider Marketplace, du Quick 
  Start, de l'Architecture, des Data modes, des Examples, du Roadmap, 
  du Disclosure & License, du Built by.
- Pas de modification de VISION.md, NAMING.md, LICENSE, du code, des 
  tests, de la config.
- Si tu te retrouves à modifier plus de 30 lignes au total, ARRÊTE — 
  ça veut dire que tu fais une réécriture, pas un patch.

MODIFICATIONS À APPLIQUER

Modification 1 — Enrichir UNE ligne du tableau "Use this repo as a 
template"

Localiser la ligne actuelle dans le tableau (elle existe déjà) :
| Re-skin the UI for a different audience | Add a template under `lib/branding/src/templates/` and set `APP_TEMPLATE` |

La remplacer par :
| White-label the UI | Add a template under `lib/branding/src/templates/` and set `APP_TEMPLATE` (server) or `VITE_APP_TEMPLATE` (frontend). Daneel ships with two templates: `daneel` (default) and `hiringai` (alternative example). |

Modification 2 — Ajouter UNE nouvelle sous-section après le tableau 
"Use this repo as a template" et avant la section "Examples"

Format exact à insérer :

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

DELIVERABLE OBLIGATOIRE FORMAT EXACT

Après le push, fournis dans le chat ces 4 informations :
1. Commit hash : <sha7>
2. URL GitHub directe : 
   https://github.com/gregherbe76/daneel/blob/main/README.md
3. Lignes ajoutées : <nombre>
4. Lignes modifiées : <nombre>

Si lignes ajoutées > 15 OU si lignes modifiées > 3, ARRÊTE et 
signale-moi avant de pusher.

Si le push échoue ou est bloqué, ARRÊTE et signale l'erreur précise. 
Ne dis pas "task done" tant que les 4 informations ne sont pas 
vérifiables sur GitHub.

Commit message exact :
"docs: document APP_TEMPLATE switch and hiringai alternative template"

STOP

Après le push et le report des 4 informations, attends ma validation 
avant toute autre action.