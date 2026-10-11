# EasyGeo

Géométrie dynamique moderne pour le collège, avec un assistant IA local (Ollama).

## Lancer

```bash
npm run dev    # version web : http://localhost:5173
npm run app    # version bureau (build + Electron)
```

## Assistant IA

1. Installer Ollama : https://ollama.com/download
2. `ollama pull qwen3:14b` (adapté à une RTX 5080 16 Go)
3. Dans EasyGeo, panneau Assistant → bouton actualiser.

L'IA répond en français et pilote la figure via les commandes ci-dessous (blocs ```geo). Si une commande échoue, une correction automatique est demandée une fois. Une action de l'IA s'annule d'un seul Ctrl+Z.

## Édition Lite (installable partout, sans voix ni photo)

Un seul installateur `release\EasyGeo-Lite-Setup-x.y.z.exe` : pas d'Ollama, pas de compte, pas d'internet. Il embarque
llama.cpp (processeur) et le modèle **Qwen3-1.7B** (Q4_K_M, 1,1 Go). Compter ~2,5 Go de RAM libre.
- Construire : `npm run dist:lite` (nécessite `tools/lite/ai/` = llama-server + dll + `model-light.gguf`, voir ci-dessous).
- L'édition se choisit à l'exécution : `resources/edition.json` (`{"edition":"lite"}`) ou la variable `EASYGEO_EDITION=lite`.
- Le bouton « Plus précis… » du panneau Assistant télécharge **Qwen3-4B-Instruct** (2,5 Go, reprise possible) dans le
  dossier de données de l'application ; l'installateur ne peut pas l'embarquer (NSIS ≈ 2 Go max).
- Consigne : `LITE_SYSTEM_PROMPT` dans `src/ai.ts` (courte, avec exemples résolus — c'est ce qui fait la fiabilité d'un petit modèle).
  Banc d'essai (24 demandes de collège vérifiées géométriquement) : 4B-instruct 26/26, 1,7B 22/26.

Préparer `tools/lite/ai/` : télécharger `llama-bXXXX-bin-win-cpu-x64.zip` (github.com/ggml-org/llama.cpp), garder
`llama-server.exe` + les `.dll`, ajouter le modèle sous le nom `model-light.gguf`
(`unsloth/Qwen3-1.7B-GGUF`, fichier `Qwen3-1.7B-Q4_K_M.gguf`).

## Mesures imposées (solveur de contraintes)

Une valeur saisie sur la figure (clic sur « 4,5 cm » ou « 63° ») est **imposée** : elle s'affiche dans une pastille et reste vraie
quand on règle les autres côtés ou qu'on déplace des points (`src/engine/solve.ts`, Gauss-Newton à correction minimale avec masses).
Clic droit sur la valeur : modifier, libérer, « même longueur qu'un autre côté… ». Un réglage impossible (inégalité triangulaire)
est refusé sans rien modifier. Seuls les points libres sont déplacés ; un verrou sur un point construit n'est pas pris en charge.

## Dessin à main levée

Outil « Main levée » (crayon) : un tracé est reconnu par calcul (`src/engine/sketch.ts`) → point, segment, ligne brisée, polygone ou cercle.
Embellissement : accroche aux points/objets existants, angles droits (±11°), côtés horizontaux/verticaux (±7°), grille si l'aimant est actif.

## Mode vocal

- Reconnaissance : whisper.cpp (`tools/whisper/{cuda,cpu}/Release/whisper-server.exe`, modèle `ggml-large-v3-turbo-q5_0.bin`), lancé par Electron sur 127.0.0.1:8178 (repli CPU si CUDA échoue). Fonctionne uniquement dans l'app Electron.
- Lecture des réponses : voix Windows (bouton haut-parleur). Une question posée au micro reçoit toujours une réponse parlée.

## Photo d'un dessin

Bouton appareil photo, coller (Ctrl+V) ou glisser une image dans le panneau Assistant.
1. Le modèle de vision (`qwen3-vl:8b`) décrit la figure voulue (points, codages, longueurs).
2. qwen3:14b en déduit une construction exacte, proposée avec « Construire / Remplacer / Ajouter ».

## Commandes (barre de saisie)

`A=(2;3)` · `f(x)=2x+1` · `a=2` (curseur) · `Segment(A,B)` · `Droite(A,B)` · `DemiDroite(A,B)` · `Milieu(A,B)` · `Cercle(O,A)` / `Cercle(O,3)` · `Perpendiculaire(C,(AB))` · `Parallele(C,(AB))` · `Mediatrice(A,B)` · `Bissectrice(A,B,C)` · `Intersection(d1,c1)` · `PointSur(c1)` · `Polygone(A,B,C)` · `PolygoneRegulier(A,B,6)` · `Carre(A,B)` · `SymetrieAxiale(ABC,(d))` · `SymetrieCentrale(ABC,O)` · `Translation(ABC,A,B)` · `Rotation(ABC,O,90)` · `Distance(A,B)` · `Angle(A,B,C)` · `Couleur(c1,rouge)` · `Masquer(d1)` · `Renommer(A,M)` · `Supprimer(A)`

Tape `aide` dans la barre pour la liste complète.

## Structure

- `src/engine/` : moteur (construction.ts = objets + recalcul, commands.ts = langage, render.ts = Canvas, tools.ts = outils souris)
- `src/ai.ts` : client Ollama + prompt système
- `electron/main.cjs` : fenêtre de bureau
