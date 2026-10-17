# EasyGeo

Géométrie dynamique moderne pour le collège : simple, rapide, sans compte ni connexion. Tout fonctionne hors ligne.

EasyGeo est une application autonome, indépendante de Kane OS. L’installateur Windows propose le dossier d’installation et crée ses propres raccourcis. Les figures et préférences existantes sont conservées lors d’une mise à jour ou d’une désinstallation.

## Lancer

```bash
npm run dev    # version web : http://localhost:5173
npm run app    # version bureau (build + Electron)
npm run dist   # installateur Windows : release\EasyGeo-Setup-x.y.z.exe
```

L'installateur (NSIS, par utilisateur, sans droits administrateur) n'est pas signé : Windows affiche l'avertissement SmartScreen
(« Informations complémentaires » → « Exécuter quand même »).

## Mode « Règle et compas »

Bouton **Règle et compas** en haut à droite : la barre d'outils se limite à ce qu'on a sur une vraie feuille.
- **Règle** : segment, droite, demi-droite. **Compas** : « centre, passant par un point » ou « écartement AB, pointe en C ».
  Un compas ne trace qu'un **arc** (fin), qui s'allonge si on marque des points plus loin sur le cercle
  (clic droit sur l'arc : « Montrer le cercle entier »).
- **Marquer un point d'intersection** : on clique sur les deux traits près de l'endroit où ils se croisent ; seul ce point est créé.
- Pas de grille, d'axes, d'aimantation ni de mesures : comme sur une feuille blanche.
- Bouton **Rejouer** (▶, en haut) : la construction se redessine **pas à pas** avec une consigne écrite pour chaque étape
  (« Au compas : pointe en A… »). Lecture automatique, pause, flèches ← → du clavier, Échap pour quitter.

## Mesures imposées (solveur de contraintes)

Une valeur saisie sur la figure (clic sur « 4,5 cm » ou « 63° ») est **imposée** : elle s'affiche dans une pastille et reste vraie
quand on règle les autres côtés ou qu'on déplace des points (`src/engine/solve.ts`, Gauss-Newton à correction minimale avec masses).
Clic droit sur la valeur : modifier, libérer, « même longueur qu'un autre côté… ». Un réglage impossible (inégalité triangulaire)
est refusé sans rien modifier. Seuls les points libres sont déplacés ; un verrou sur un point construit n'est pas pris en charge.

## Noms des points et confort

- Clic sur le nom d'un point (ou double-clic sur le point, ou double-clic sur son nom dans la liste, ou F2 sur un point sélectionné) : on le renomme.
  **Tab** valide et passe au point suivant (Maj+Tab : précédent) : pratique pour nommer toute une figure. Une minuscule devient une majuscule ;
  si le nom est déjà pris par un autre point, les deux points **échangent** leurs noms.
- Les noms se placent automatiquement **à l'extérieur** de la figure (côté opposé aux segments) ; on peut les **glisser** où l'on veut
  (clic droit sur le point : « Replacer le nom », « Masquer le nom »).
- Flèches du clavier : déplacent finement le point sélectionné (0,5 ; Maj = 0,1), un seul Ctrl+Z annule la série.

## Dessin à main levée

Outil « Main levée » (crayon) : un tracé est reconnu par calcul (`src/engine/sketch.ts`) → point, segment, ligne brisée, polygone ou cercle.
Embellissement : accroche aux points/objets existants, angles droits (±11°), côtés horizontaux/verticaux (±7°), grille si l'aimant est actif.

## Commandes (barre de saisie)

`A=(2;3)` · `f(x)=2x+1` · `a=2` (curseur) · `Segment(A,B)` · `Droite(A,B)` · `DemiDroite(A,B)` · `Milieu(A,B)` · `Cercle(O,A)` / `Cercle(O,3)` · `Compas(C,A,B)` · `Perpendiculaire(C,(AB))` · `Parallele(C,(AB))` · `Mediatrice(A,B)` · `Bissectrice(A,B,C)` · `Intersection(d1,c1)` · `PointSur(c1)` · `Polygone(A,B,C)` · `PolygoneRegulier(A,B,6)` · `Carre(A,B)` · `SymetrieAxiale(ABC,(d))` · `SymetrieCentrale(ABC,O)` · `Translation(ABC,A,B)` · `Rotation(ABC,O,90)` · `Distance(A,B)` · `Angle(A,B,C)` · `Couleur(c1,rouge)` · `Masquer(d1)` · `Renommer(A,M)` · `Supprimer(A)`

Tape `aide` dans la barre pour la liste complète.

## Structure

- `src/engine/` : moteur (construction.ts = objets + recalcul, commands.ts = langage, render.ts = Canvas, tools.ts = outils souris, solve.ts = mesures imposées, sketch.ts = main levée)
- `electron/main.cjs` : fenêtre de bureau
- `electron-builder.json` : configuration de l'installateur
