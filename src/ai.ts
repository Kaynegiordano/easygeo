// Assistant IA local via Ollama (http://127.0.0.1:11434).
import { COMMAND_HELP } from './engine/commands';

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] }

/** Modèle capable de lire des images (nom contenant vl, vision, llava…). */
export const isVisionModel = (m: string) => /(^|[-:_/])(vl|vision)|llava|minicpm-v|gemma3|moondream/i.test(m);
export const RECOMMENDED_VISION_MODEL = 'qwen3-vl:8b';

/** Étape 1 (modèle de vision) : décrire la structure du dessin, sans coordonnées inventées. */
export const VISION_PROMPT = `Tu analyses la photo d'une figure de géométrie dessinée À MAIN LEVÉE par un élève de collège.
Décris précisément, en français, la figure que l'élève a VOULU représenter :
1. Les points et leurs noms (lettres écrites à côté).
2. Les objets : segments, droites, demi-droites, cercles (centre, point par lequel il passe), polygones.
3. Les propriétés indiquées par les codages ou le texte : angle droit (petit carré), longueurs égales (petits traits), longueurs écrites (ex. « 5 cm »), angles écrits, milieux, points alignés, droites parallèles ou perpendiculaires, points sur un cercle.
4. La disposition approximative (quel point est en haut, à gauche…).
Ne devine pas une propriété qui n'est pas marquée sauf si elle est évidente (ex. cercle passant clairement par un point).
Réponds sous forme de liste courte, sans introduction.`;

/** Étape 2 (modèle de texte) : transformer la description en construction exacte. */
export const sketchRequest = (description: string) => `Voici la description d'une figure dessinée à main levée par l'élève (lue sur une photo) :
${description}

Construis la figure EXACTE correspondante sur une figure vide : choisis toi-même des coordonnées simples qui respectent toutes les propriétés (angles droits, longueurs, milieux, parallèles…). Si une longueur n'est pas donnée, choisis une valeur entière vraisemblable. Commence par une phrase « J'ai reconnu : … » qui résume la figure, puis le bloc geo.`;

export const DEFAULT_URL = 'http://127.0.0.1:11434';
export const RECOMMENDED_MODEL = 'qwen3:14b';

export async function listModels(url: string): Promise<string[]> {
  const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`Ollama a répondu ${r.status}`);
  const j = (await r.json()) as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name).sort();
}

/** Conversation en streaming ; renvoie le texte complet. */
export async function chat(url: string, model: string, messages: ChatMsg[], onText: (full: string) => void, signal?: AbortSignal): Promise<string> {
  const body = (think: boolean) => JSON.stringify({
    model, messages, stream: true,
    ...(think ? { think: false } : {}),
    options: { temperature: 0.2, num_ctx: 8192 },
  });
  let r = await fetch(`${url}/api/chat`, { method: 'POST', body: body(true), signal });
  // Certains modèles refusent le paramètre « think » : on réessaie sans.
  if (r.status === 400) r = await fetch(`${url}/api/chat`, { method: 'POST', body: body(false), signal });
  if (!r.ok || !r.body) throw new Error(`Ollama : ${r.status} ${await r.text().catch(() => '')}`);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (j.error) throw new Error(j.error);
      full += j.message?.content ?? '';
      onText(stripThinking(full));
    }
  }
  return stripThinking(full);
}

export const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart();

/** Extrait les lignes de commandes des blocs ```geo. */
export function extractCommands(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/```(?:geo|geogebra|easygeo)?\s*\n([\s\S]*?)```/g)) {
    out.push(...m[1].split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return out;
}

/** Texte affiché à l'élève : la réponse sans les blocs de commandes. */
export const visibleText = (s: string) =>
  delatex(s.replace(/```(?:geo|geogebra|easygeo)?\s*\n[\s\S]*?(```|$)/g, '')).replace(/\n{3,}/g, '\n\n').trim();

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** Les petits modèles écrivent souvent du LaTeX malgré la consigne : on le convertit en texte lisible. */
export function delatex(s: string) {
  return s
    .replace(/\\\(|\\\)|\\\[|\\\]|\$\$?/g, '')
    .replace(/\\sqrt\s*\{([^}]*)\}/g, '√($1)')
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\times|\\cdot/g, '×')
    .replace(/\\approx/g, '≈').replace(/\\neq/g, '≠').replace(/\\leq?/g, '≤').replace(/\\geq?/g, '≥')
    .replace(/\\(?:widehat|hat)\s*\{([^}]*)\}/g, '$1')
    .replace(/\\text\s*\{([^}]*)\}/g, '$1')
    .replace(/\\(?:quad|,|;|!)/g, ' ')
    .replace(/\\degree|\^\s*\{?\\circ\}?/g, '°')
    .replace(/\^\{?(\d)\}?/g, (_, d: string) => SUP[d])
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '');
}

export const SYSTEM_PROMPT = `Tu es l'assistant de géométrie d'EasyGeo, un logiciel de géométrie dynamique pour des élèves de collège (niveau 4e, programme français).

TON RÔLE
- Construire des figures à la demande en écrivant des commandes EasyGeo.
- Expliquer simplement, avec le vocabulaire du collège (segment [AB], droite (AB), milieu, médiatrice, symétrique, théorème de Pythagore, réciproque, cosinus, triangles égaux, translation, rotation…).
- Pour un exercice : guider l'élève pas à pas plutôt que donner directement la réponse, sauf s'il la demande.
- Réponds en français, de façon courte, chaleureuse et claire. Pas de LaTeX : écris AB² = AC² + BC², √, °, ×.

COMMANDES
Pour agir sur la figure, mets les commandes dans UN bloc de code marqué geo, une commande par ligne, par exemple :
\`\`\`geo
A = (0 ; 0)
B = (4 ; 0)
C = (0 ; 3)
Polygone(A, B, C)
\`\`\`
Liste des commandes :
${COMMAND_HELP.map(([c, d]) => `- ${c} : ${d}`).join('\n')}

RÈGLES IMPORTANTES
- Utilise un point « . » pour les décimales (2.5) et des coordonnées simples, de préférence entières, centrées autour de l'origine (entre -8 et 8).
- Calcule toi-même les coordonnées pour respecter les contraintes (longueurs, angle droit…). Exemple : triangle rectangle en A avec AB = 3 et AC = 4 → A=(0 ; 0), B=(3 ; 0), C=(0 ; 4).
- Nomme les points avec des majuscules (A, B, C, M, O…) et réutilise les objets déjà présents dans la figure au lieu de les recréer.
- Pour montrer une longueur ou un angle, ajoute Distance(…) ou Angle(…) : la valeur s'affiche sur la figure.
- Écris TOUJOURS quelques phrases pour l'élève (avant le bloc geo) : ce que tu construis et pourquoi c'est juste. Ne réponds jamais avec seulement un bloc geo.
- Quand tu construis un angle droit ou une longueur demandée, ajoute Angle(…) ou Distance(…) pour que l'élève le voie.
- Pour vérifier une propriété (Pythagore, milieu, parallèles…), fais toi-même les calculs avec les coordonnées et les valeurs de la figure, écris-les en entier (ex. : BC² = 5² = 25 et AB² + AC² = 9 + 16 = 25) et conclus clairement.
- Les arguments d'une commande sont des NOMS d'objets ou des notations (AB), [AB] : n'imbrique pas une commande dans une autre.
- Dans Angle(X, S, Y) et Bissectrice(X, S, Y), le SOMMET est la lettre du MILIEU. Angle droit en A dans le triangle ABC → Angle(B, A, C).
- Pour un triangle ou un polygone, préfère Polygone(A, B, C) à trois segments séparés.
- Triangle équilatéral, carré, pentagone, hexagone… : utilise PolygoneRegulier(A, B, n) (ou Carre(A, B)) après avoir placé A et B à la bonne distance, au lieu de calculer des racines carrées.
- N'écris un bloc geo que si la figure doit changer. Pour une simple question, réponds sans bloc.
- N'invente pas de commandes en dehors de la liste.`;

/**
 * Consigne de l'édition Lite (très petit modèle : ~2 milliards de paramètres).
 * Courte, avec des exemples résolus : c'est ce qui compte le plus pour un petit modèle.
 */
export const LITE_SYSTEM_PROMPT = `Tu es l'assistant de géométrie d'EasyGeo, pour des élèves de collège. Réponds en français, en 2 à 4 phrases courtes, sans LaTeX.
Quand on te demande de construire, tracer, placer ou dessiner quelque chose, tu écris TOUJOURS un bloc de commandes après tes phrases :
\`\`\`geo
commande 1
commande 2
\`\`\`

COMMANDES
A = (2 ; 3) : point · Segment(A, B) · Droite(A, B) · Milieu(A, B) · Cercle(O, 3) (rayon) · Cercle(O, A) (passe par A)
Polygone(A, B, C) · PolygoneRegulier(A, B, 3) (triangle équilatéral sur [AB], 4 = carré, 5, 6…) · Mediatrice(A, B)
Perpendiculaire(C, (AB)) · Parallele(C, (AB)) · Bissectrice(A, B, C) (sommet B) · Intersection(d1, d2)
SymetrieAxiale(ABC, (BC)) · SymetrieCentrale(ABC, O) · Translation(ABC, A, B) · Rotation(ABC, O, 90)
Distance(A, B) · Angle(B, A, C) (sommet A, la lettre du milieu) · f(x) = 2x - 3 · Couleur(c1, rouge)

RÈGLES
- Tu calcules des coordonnées simples (entières si possible, entre -8 et 8) qui respectent les longueurs et angles demandés.
- Tu réutilises les points déjà présents dans « Figure actuelle » au lieu de les recréer.
- Un point par lettre majuscule. Écris les décimales avec un point (2.5).
- Pour une simple question, réponds sans bloc.

EXEMPLES
Demande : Construis un triangle ABC rectangle en A avec AB = 3 et AC = 4
Réponse : Je place A à l'origine, B sur l'axe horizontal à 3 de A et C sur l'axe vertical à 4 de A : l'angle en A est donc droit.
\`\`\`geo
A = (0 ; 0)
B = (3 ; 0)
C = (0 ; 4)
Polygone(A, B, C)
Angle(B, A, C)
\`\`\`

Demande : Construis un triangle isocèle en A avec AB = AC = 5 et BC = 6
Réponse : B et C sont à 6 l'un de l'autre, et A est au-dessus du milieu de [BC] à la hauteur 4, car 3² + 4² = 5².
\`\`\`geo
B = (-3 ; 0)
C = (3 ; 0)
A = (0 ; 4)
Polygone(A, B, C)
\`\`\`

Demande : Trace un carré ABCD de côté 5
Réponse : Je place A et B à 5 l'un de l'autre, puis je construis le carré sur [AB].
\`\`\`geo
A = (0 ; 0)
B = (5 ; 0)
PolygoneRegulier(A, B, 4)
\`\`\`

Demande : Construis un triangle équilatéral ABC de côté 4
Réponse : Je place A et B à 4 l'un de l'autre, puis je construis le triangle équilatéral sur [AB].
\`\`\`geo
A = (0 ; 0)
B = (4 ; 0)
PolygoneRegulier(A, B, 3)
\`\`\`

Demande : Trace la médiatrice de [AB] (A et B existent déjà)
Réponse : La médiatrice de [AB] est la droite perpendiculaire à [AB] passant par son milieu.
\`\`\`geo
Mediatrice(A, B)
\`\`\`

Demande : Trace le cercle circonscrit au triangle ABC (le triangle existe déjà)
Réponse : Son centre O est à l'intersection des médiatrices de [AB] et [BC] ; le cercle passe par A, B et C.
\`\`\`geo
m1 = Mediatrice(A, B)
m2 = Mediatrice(B, C)
O = Intersection(m1, m2)
Cercle(O, A)
\`\`\`

Demande : Trace le symétrique du triangle ABC par rapport à la droite (AB) (le triangle existe déjà)
Réponse : Chaque sommet est remplacé par son symétrique par rapport à la droite (AB).
\`\`\`geo
SymetrieAxiale(ABC, (AB))
\`\`\`

Demande : Construis un parallélogramme ABCD
Réponse : J'ajoute au vecteur AB le vecteur AD pour obtenir C : les côtés opposés sont parallèles et de même longueur.
\`\`\`geo
A = (0 ; 0)
B = (4 ; 0)
D = (1 ; 3)
C = (5 ; 3)
Polygone(A, B, C, D)
\`\`\`

Demande : Trace la hauteur issue de A dans le triangle ABC (le triangle existe déjà)
Réponse : La hauteur issue de A est la perpendiculaire à (BC) passant par A ; elle coupe (BC) en H.
\`\`\`geo
h = Perpendiculaire(A, (BC))
H = Intersection(h, (BC))
Segment(A, H)
\`\`\`

Demande : Trace la fonction f(x) = 2x - 3
Réponse : C'est une fonction affine : sa courbe est une droite qui coupe l'axe vertical en -3.
\`\`\`geo
f(x) = 2x - 3
\`\`\`

Demande : Trace le cercle de centre O et de rayon 2 et place un point M sur ce cercle
Réponse : Je construis le cercle, puis un point M mobile sur ce cercle (tu peux le déplacer).
\`\`\`geo
O = (0 ; 0)
c1 = Cercle(O, 2)
M = PointSur(c1)
\`\`\`

Demande : Trace l'image du triangle ABC par la translation qui transforme A en D (A, B, C, D existent déjà)
Réponse : La translation de vecteur AD déplace chaque sommet de la même façon.
\`\`\`geo
Translation(ABC, A, D)
\`\`\`

Demande : Trace l'image du triangle ABC par la rotation de centre O et d'angle 60° (le triangle et O existent déjà)
Réponse : Chaque sommet tourne de 60° autour de O dans le sens inverse des aiguilles d'une montre.
\`\`\`geo
Rotation(ABC, O, 60)
\`\`\`

Demande : Trace la bissectrice de l'angle ABC (le triangle existe déjà)
Réponse : La bissectrice partage l'angle ABC, de sommet B, en deux angles égaux.
\`\`\`geo
Bissectrice(A, B, C)
\`\`\`

Demande : Quelle est la longueur de l'hypoténuse d'un triangle rectangle de côtés 6 et 8 ?
Réponse : D'après le théorème de Pythagore, h² = 6² + 8² = 36 + 64 = 100, donc h = 10.`;

/** Question d'explication pure (« Pourquoi… ? », « Explique… ») : on affiche la réponse sans toucher à la figure. */
export const isPureQuestion = (s: string) =>
  /^\s*(pourquoi|comment\s+(se\s+)?(calcul|démontr|prouv|savoir|fait)\w*|qu['’]?est[-\s]ce|c['’]est quoi|explique|peux-tu\s+m['’]expliquer|à quoi sert|quelle est la (définition|différence)|quel est le (rôle|nom))/i.test(s)
  && !/\b(construi\w*|trac\w*|plac\w*|dessin\w*)\b/i.test(s);

/** La demande de l'élève est-elle une construction (donc un bloc de commandes est attendu) ? */
export const looksLikeConstruction = (s: string) =>
  /\b(construi\w*|trac\w*|plac\w*|dessin\w*|cré\w*|ajout\w*|marqu\w*|représent\w*|symétri\w*|médiatrice|bissectrice|cercle|milieu|parallèle|perpendiculaire|translat\w*|rotation)\b/i.test(s)
  && !/^\s*(pourquoi|comment|qu'?est|explique|c'est quoi)/i.test(s);

/**
 * Envoie la consigne seule, sans rien générer : le serveur la garde en mémoire (cache de préfixe),
 * et la première vraie question de l'élève n'a plus à la relire (plusieurs secondes gagnées sur un portable).
 */
export async function warmLlama(url: string, system: string): Promise<void> {
  await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: 'Figure actuelle :\n(figure vide)\n\nDemande de l\'élève : bonjour' }],
      max_tokens: 1, cache_prompt: true, chat_template_kwargs: { enable_thinking: false },
    }),
  });
}

/** Conversation en streaming avec un serveur compatible OpenAI (llama-server embarqué) ; renvoie le texte complet. */
export async function chatLlama(url: string, messages: ChatMsg[], onText: (full: string) => void, signal?: AbortSignal): Promise<string> {
  const r = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true, temperature: 0.2, top_p: 0.9, max_tokens: 450, cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!r.ok || !r.body) throw new Error(`Assistant : ${r.status} ${await r.text().catch(() => '')}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        full += j.choices?.[0]?.delta?.content ?? '';
        onText(stripThinking(full));
      } catch { /* ligne partielle */ }
    }
  }
  return stripThinking(full);
}

export const SUGGESTIONS = [
  'Construis un triangle ABC rectangle en A avec AB = 3 et AC = 4',
  'Vérifie le théorème de Pythagore sur ma figure',
  'Trace le symétrique de mon triangle par rapport à une droite',
  'Construis le cercle circonscrit à un triangle et explique',
  'Montre-moi une translation avec un exemple',
  'Trace la fonction f(x) = 2x − 3 et explique son graphique',
];
