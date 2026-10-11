// Outils de construction à la souris : étapes de sélection + création.
import type { Construction } from './construction';
import { imageOf, regularPolygon } from './commands';
import * as G from './geom';

/** Ce que l'étape attend : point, ligne (droite/segment/demi-droite), courbe (ligne/cercle/fonction), objet transformable. */
export type Need = 'point' | 'line' | 'curve' | 'obj';

export interface Ask { label: string; default: string; suffix?: string }

export interface Tool {
  id: string;
  label: string;
  group: string;
  /** Consigne affichée pour chaque étape (index = nombre de sélections déjà faites). */
  hints: string[];
  steps: Need[] | 'polygon';
  ask?: Ask;
  /** `at` : endroit (monde) du dernier clic, utile pour choisir entre plusieurs résultats. */
  run?: (c: Construction, ids: string[], answer?: string, at?: G.Vec) => void;
}

export const GROUPS = [
  { id: 'base', label: 'Points' },
  { id: 'lines', label: 'Lignes' },
  { id: 'circles', label: 'Cercles' },
  { id: 'polys', label: 'Polygones' },
  { id: 'transfo', label: 'Transformations' },
  { id: 'measure', label: 'Mesures' },
];

const transform = (c: Construction, target: string, mk: Parameters<typeof imageOf>[2]) => imageOf(c, target, mk);

export const TOOLS: Tool[] = [
  { id: 'move', label: 'Déplacer', group: 'base', steps: [], hints: ['Fais glisser un point ou un objet. Clique sur un nom (ou double-clic sur un point) pour le changer, glisse un nom pour le déplacer. Clic droit : options. Molette : zoom.'] },
  { id: 'freehand', label: 'Main levée', group: 'base', steps: [], hints: ['Dessine (trait, triangle, carré, cercle…) : EasyGeo le met au propre. Double-clic sur un objet pour régler sa mesure, clic droit pour plus d’options.'] },
  { id: 'point', label: 'Point', group: 'base', steps: ['point'], hints: ['Clique pour placer un point (sur un objet : point mobile sur cet objet).'], run: () => {} },
  { id: 'midpoint', label: 'Milieu', group: 'base', steps: ['point', 'point'], hints: ['Clique sur le premier point.', 'Clique sur le second point.'],
    run: (c, [a, b]) => { c.add({ k: 'midpoint', a, b }); } },
  { id: 'intersect', label: 'Intersection', group: 'base', steps: ['curve', 'curve'], hints: ['Clique sur le premier objet.', 'Clique sur le second objet.'],
    run: (c, [a, b]) => {
      c.recompute();
      const n = c.intersectionCount(a, b);
      if (n === 0) throw new Error('Ces objets ne se coupent pas.');
      for (let i = 0; i < n; i++) c.add({ k: 'intersect', a, b, i });
    } },

  { id: 'segment', label: 'Segment', group: 'lines', steps: ['point', 'point'], hints: ['Clique sur la première extrémité.', 'Clique sur la seconde extrémité.'],
    run: (c, [a, b]) => { c.add({ k: 'segment', a, b }); } },
  { id: 'line', label: 'Droite', group: 'lines', steps: ['point', 'point'], hints: ['Clique sur un premier point de la droite.', 'Clique sur un second point.'],
    run: (c, [a, b]) => { c.add({ k: 'line', a, b }); } },
  { id: 'ray', label: 'Demi-droite', group: 'lines', steps: ['point', 'point'], hints: ["Clique sur l'origine.", 'Clique sur un point de la demi-droite.'],
    run: (c, [a, b]) => { c.add({ k: 'ray', a, b }); } },
  { id: 'perp', label: 'Perpendiculaire', group: 'lines', steps: ['line', 'point'], hints: ['Clique sur la droite de référence.', 'Clique sur le point par lequel elle passe.'],
    run: (c, [l, p]) => { c.add({ k: 'perp', p, l }); } },
  { id: 'parallel', label: 'Parallèle', group: 'lines', steps: ['line', 'point'], hints: ['Clique sur la droite de référence.', 'Clique sur le point par lequel elle passe.'],
    run: (c, [l, p]) => { c.add({ k: 'parallel', p, l }); } },
  { id: 'bisector', label: 'Médiatrice', group: 'lines', steps: ['point', 'point'], hints: ['Clique sur une extrémité du segment.', "Clique sur l'autre extrémité."],
    run: (c, [a, b]) => { c.add({ k: 'bisector', a, b }); } },
  { id: 'angleBisector', label: 'Bissectrice', group: 'lines', steps: ['point', 'point', 'point'], hints: ['Clique sur un point du premier côté.', 'Clique sur le sommet de l’angle.', 'Clique sur un point du second côté.'],
    run: (c, [a, b, d]) => { c.add({ k: 'angleBisector', a, b, c: d }); } },

  { id: 'circle2', label: 'Cercle (centre, point)', group: 'circles', steps: ['point', 'point'], hints: ['Clique sur le centre.', 'Clique sur un point du cercle.'],
    run: (c, [ctr, p]) => { c.add({ k: 'circle2', c: ctr, p }); } },
  { id: 'circleR', label: 'Cercle (centre, rayon)', group: 'circles', steps: ['point'], hints: ['Clique sur le centre.'],
    ask: { label: 'Rayon du cercle', default: '3' },
    run: (c, [ctr], r) => { c.add({ k: 'circleR', c: ctr, r: (r ?? '3').replace(',', '.') }); } },

  // ----- Mode « règle et compas » -----
  { id: 'rcIntersect', label: 'Marquer un point d’intersection', group: 'rc', steps: ['curve', 'curve'],
    hints: ['Clique sur le premier trait ou arc.', 'Clique sur le second, près de l’endroit où ils se croisent.'],
    run: (c, [a, b], _r, at) => {
      c.recompute();
      const raw = c.intersections(a, b);
      let best = -1, bd = Infinity;
      raw.forEach((p, i) => {
        if (!p) return;
        const d = at ? G.dist(p, at) : i;
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) throw new Error('Ces traits ne se coupent pas.');
      if (c.objects.some((o) => o.def.k === 'intersect' && o.def.i === best && ((o.def.a === a && o.def.b === b) || (o.def.a === b && o.def.b === a)))) {
        throw new Error('Ce point est déjà marqué.');
      }
      c.add({ k: 'intersect', a, b, i: best });
    } },
  { id: 'compass', label: 'Compas : écartement AB, pointe en C', group: 'rc', steps: ['point', 'point', 'point'],
    hints: ['Écartement : clique sur la première extrémité.', 'Clique sur la seconde extrémité (c’est l’écartement du compas).', 'Pointe sèche : clique sur le centre de l’arc.'],
    run: (c, [a, b, ctr]) => { c.get(c.add({ k: 'compass', c: ctr, a, b }))!.arc = true; } },
  { id: 'compassThrough', label: 'Compas : centre, passant par un point', group: 'rc', steps: ['point', 'point'],
    hints: ['Pointe sèche : clique sur le centre.', 'Clique sur le point par lequel passe l’arc.'],
    run: (c, [ctr, p]) => { c.get(c.add({ k: 'circle2', c: ctr, p }))!.arc = true; } },

  { id: 'polygon', label: 'Polygone', group: 'polys', steps: 'polygon', hints: ['Clique sur les sommets un par un, puis à nouveau sur le premier pour fermer.'],
    run: (c, ids) => { c.add({ k: 'polygon', pts: ids }); } },
  { id: 'regular', label: 'Polygone régulier', group: 'polys', steps: ['point', 'point'], hints: ['Clique sur le premier sommet.', 'Clique sur le deuxième sommet.'],
    ask: { label: 'Nombre de côtés', default: '4' },
    run: (c, [a, b], n) => {
      const k = parseInt(n ?? '4');
      if (!(k >= 3 && k <= 40)) throw new Error('Le nombre de côtés doit être entre 3 et 40.');
      regularPolygon(c, a, b, k);
    } },

  { id: 'reflectLine', label: 'Symétrie axiale', group: 'transfo', steps: ['obj', 'line'], hints: ["Clique sur l'objet à transformer.", "Clique sur l'axe de symétrie."],
    run: (c, [o, l]) => { transform(c, o, (p) => ({ k: 'reflectLine', p, l })); } },
  { id: 'reflectPoint', label: 'Symétrie centrale', group: 'transfo', steps: ['obj', 'point'], hints: ["Clique sur l'objet à transformer.", 'Clique sur le centre de symétrie.'],
    run: (c, [o, ctr]) => { transform(c, o, (p) => ({ k: 'reflectPoint', p, c: ctr })); } },
  { id: 'translate', label: 'Translation', group: 'transfo', steps: ['obj', 'point', 'point'], hints: ["Clique sur l'objet à transformer.", 'Clique sur l’origine du vecteur.', "Clique sur l'extrémité du vecteur."],
    run: (c, [o, a, b]) => { transform(c, o, (p) => ({ k: 'translate', p, a, b })); } },
  { id: 'rotate', label: 'Rotation', group: 'transfo', steps: ['obj', 'point'], hints: ["Clique sur l'objet à transformer.", 'Clique sur le centre de rotation.'],
    ask: { label: 'Angle (en degrés, sens inverse des aiguilles d’une montre)', default: '90', suffix: '°' },
    run: (c, [o, ctr], ang) => { const angle = (ang ?? '90').replace(',', '.'); transform(c, o, (p) => ({ k: 'rotate', p, c: ctr, angle })); } },

  { id: 'distance', label: 'Longueur', group: 'measure', steps: ['point', 'point'], hints: ['Clique sur le premier point.', 'Clique sur le second point.'],
    run: (c, [a, b]) => { c.add({ k: 'distance', a, b }); } },
  { id: 'angle', label: 'Angle', group: 'measure', steps: ['point', 'point', 'point'], hints: ['Clique sur un point du premier côté.', 'Clique sur le sommet.', 'Clique sur un point du second côté.'],
    run: (c, [a, b, d]) => { c.add({ k: 'angle', a, b, c: d }); } },
  { id: 'delete', label: 'Gomme', group: 'measure', steps: [], hints: ['Clique sur un objet pour le supprimer (avec ce qui en dépend).'] },
];

/** Outils du mode « règle et compas » (dans l'ordre de la barre) et leur nom dans ce mode. */
export const RC_TOOLS: [string, string][] = [
  ['move', 'Déplacer'],
  ['point', 'Placer un point'],
  ['rcIntersect', 'Marquer un point d’intersection'],
  ['segment', 'Règle : tracer un segment'],
  ['line', 'Règle : tracer une droite'],
  ['ray', 'Règle : tracer une demi-droite'],
  ['compass', 'Compas : écartement AB, pointe en C'],
  ['compassThrough', 'Compas : centre, passant par un point'],
  ['delete', 'Gomme'],
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id)!;

/** L'objet convient-il à l'étape ? */
export function accepts(c: Construction, need: Need, id: string): boolean {
  const o = c.get(id);
  if (!o) return false;
  switch (need) {
    case 'point': return o.type === 'point';
    case 'line': return o.type === 'line';
    case 'curve': return o.type === 'line' || o.type === 'circle' || o.type === 'function';
    case 'obj': return ['point', 'line', 'circle', 'polygon'].includes(o.type) || o.def.k === 'angle';
  }
}
