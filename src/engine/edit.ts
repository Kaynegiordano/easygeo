// Retouches directes d'une figure : longueur d'un segment, angle d'un sommet, rayon, coordonnées.
// On ne déplace que des points libres (ou mobiles sur un objet) pour respecter les constructions.
import type { Construction } from './construction';
import * as G from './geom';
import { findAngLock, findLenLock, moveFreePoint, solveLocks } from './solve';

const isFree = (c: Construction, id: string) => c.get(id)?.def.k === 'free';

const movePoint = (c: Construction, id: string, p: G.Vec) => {
  const d = c.get(id)!.def;
  if (d.k !== 'free') throw new Error(`Le point ${c.nameOf(id)} est construit : il ne peut pas bouger librement.`);
  d.x = p.x; d.y = p.y;
};

/** Exécute une retouche ; si elle échoue, la figure est remise exactement comme avant. */
function atomic<T>(c: Construction, fn: () => T): T {
  const saved = structuredClone(c.objects);
  try { return fn(); } catch (e) { c.objects = saved; throw e; }
}

const INCOMPATIBLE =
  "Ces mesures ne peuvent pas être respectées toutes ensemble (rappel : un côté d'un triangle est toujours plus court que la somme des deux autres). Rien n'a été modifié.";

/**
 * Impose la longueur AB. La valeur est « verrouillée » : elle reste vraie quand on règle les autres
 * côtés ou qu'on déplace des points ; les autres sommets s'adaptent. (Si un point est construit,
 * on se contente de déplacer l'autre, sans verrou.)
 */
export function setLength(c: Construction, a: string, b: string, L: number) {
  return atomic(c, () => setLengthRaw(c, a, b, L));
}
function setLengthRaw(c: Construction, a: string, b: string, L: number) {
  if (!(L > 0)) throw new Error('La longueur doit être positive.');
  const A = c.comp(a)?.pt, B = c.comp(b)?.pt;
  if (!A || !B) throw new Error('Segment non défini.');
  const u = G.norm(G.sub(B, A));
  if (isFree(c, a) && isFree(c, b)) {
    const ex = findLenLock(c, a, b);
    if (ex && ex.def.kind === 'len') ex.def.value = L;
    else c.add({ k: 'lock', kind: 'len', a, b, value: L }, { aux: true });
    movePoint(c, b, G.add(A, G.mul(u, L))); // départ proche de la solution
    if (!solveLocks(c, { mass: { [a]: 20 } })) throw new Error(INCOMPATIBLE);
    return;
  }
  if (isFree(c, b)) movePoint(c, b, G.add(A, G.mul(u, L)));
  else if (isFree(c, a)) movePoint(c, a, G.sub(B, G.mul(u, L)));
  else throw new Error(`Les points ${c.nameOf(a)} et ${c.nameOf(b)} sont construits : impossible de changer la longueur.`);
}

/** Impose l'angle PVN (sommet V), verrouillé comme les longueurs. */
export function setAngle(c: Construction, p: string, v: string, n: string, deg: number) {
  return atomic(c, () => setAngleRaw(c, p, v, n, deg));
}
function setAngleRaw(c: Construction, p: string, v: string, n: string, deg: number) {
  if (!(deg > 0 && deg < 180)) throw new Error("L'angle doit être compris entre 0° et 180°.");
  const P = c.comp(p)?.pt, V = c.comp(v)?.pt, N = c.comp(n)?.pt;
  if (!P || !V || !N) throw new Error('Angle non défini.');
  const turn = (fixed: G.Vec, moving: G.Vec) => {
    // garde le même côté que la figure actuelle
    const side = Math.sign(G.cross(G.sub(fixed, V), G.sub(moving, V))) || 1;
    const dir = G.rotate(G.add(V, G.norm(G.sub(fixed, V))), V, side * deg);
    return G.add(V, G.mul(G.norm(G.sub(dir, V)), G.dist(V, moving)));
  };
  if (isFree(c, p) && isFree(c, v) && isFree(c, n)) {
    const ex = findAngLock(c, p, v, n);
    if (ex && ex.def.kind === 'ang') ex.def.value = deg;
    else c.add({ k: 'lock', kind: 'ang', p, v, n, value: deg }, { aux: true });
    movePoint(c, n, turn(P, N));
    if (!solveLocks(c, { mass: { [v]: 20, [p]: 5 } })) throw new Error(INCOMPATIBLE);
    return;
  }
  if (isFree(c, n)) movePoint(c, n, turn(P, N));
  else if (isFree(c, p)) movePoint(c, p, turn(N, P));
  else throw new Error(`Les points ${c.nameOf(p)} et ${c.nameOf(n)} sont construits : impossible de changer l'angle.`);
}

/** Impose que [AB] et [CD] aient la même longueur (codage « côtés égaux »). */
export function setEqualLength(c: Construction, a: string, b: string, cc: string, d: string) {
  return atomic(c, () => setEqualRaw(c, a, b, cc, d));
}
function setEqualRaw(c: Construction, a: string, b: string, cc: string, d: string) {
  if (samePair(a, b, cc, d)) throw new Error('Choisis un autre côté.');
  if (![a, b, cc, d].every((id) => isFree(c, id))) throw new Error('Les côtés doivent avoir des extrémités libres (non construites).');
  const A = c.comp(a)!.pt!, B = c.comp(b)!.pt!, C = c.comp(cc)!.pt!, D = c.comp(d)!.pt!;
  c.add({ k: 'lock', kind: 'eq', a, b, c: cc, d }, { aux: true });
  // départ proche de la solution : [CD] prend la longueur de [AB]
  movePoint(c, d, G.add(C, G.mul(G.norm(G.sub(D, C)), G.dist(A, B))));
  if (!solveLocks(c, { mass: { [a]: 5, [b]: 5 } })) throw new Error(INCOMPATIBLE);
}

/** Libère une mesure imposée : la valeur peut de nouveau varier. */
export function releaseLock(c: Construction, id: string) { c.remove(id); }

const samePair = (a: string, b: string, x: string, y: string) => (a === x && b === y) || (a === y && b === x);

export function setRadius(c: Construction, id: string, r: number) {
  if (!(r > 0)) throw new Error('Le rayon doit être positif.');
  const d = c.get(id)!.def;
  if (d.k === 'circleR') { d.r = String(r); return; }
  if (d.k === 'circle2') { setLength(c, d.c, d.p, r); return; }
  throw new Error('Ce cercle ne peut pas être modifié ainsi.');
}

export function setCoords(c: Construction, id: string, x: number, y: number) {
  if (c.get(id)?.def.k !== 'free') movePoint(c, id, { x, y }); // lève l'erreur « point construit »
  else if (!moveFreePoint(c, id, { x, y })) throw new Error('Cette position est impossible avec les mesures imposées.');
}

/**
 * Renomme un objet. Un point reçoit une majuscule (« a » → « A ») ; si le nom est déjà pris par un autre point,
 * les deux points échangent leurs noms. Renvoie un message à afficher, le cas échéant.
 */
export function renameObject(c: Construction, id: string, raw: string): string | undefined {
  const o = c.get(id);
  if (!o) return;
  let name = raw.trim().replace(/’/g, "'");
  if (!name) throw new Error('Écris un nom.');
  if (!/^\p{L}[\p{L}\d_']*$/u.test(name)) throw new Error("Un nom commence par une lettre, sans espace ni symbole : A, B', M1…");
  if (o.type === 'point' && /^\p{Ll}['\d_]*$/u.test(name)) name = name[0].toUpperCase() + name.slice(1);
  if (name === o.name) return;
  const other = c.objects.find((x) => x.name === name && x.id !== id);
  if (other) {
    if (o.type !== 'point' || other.type !== 'point') throw new Error(`Le nom « ${name} » est déjà utilisé.`);
    other.name = o.name;
    o.name = name;
    return `« ${name} » était déjà pris : les points ${o.name} et ${other.name} ont échangé leurs noms.`;
  }
  c.rename(id, name);
}

/** Lit un nombre écrit à la française (« 4,5 », « 60° », « 5 cm »). */
export function parseNumber(s: string): number {
  const n = Number(s.replace(/[°\s]|cm|unités?/gi, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`« ${s} » n'est pas un nombre.`);
  return n;
}

/** Côté [AB] d'un polygone le plus proche d'un point (en unités monde), ou null. */
export function nearestEdge(c: Construction, polyId: string, w: G.Vec, tol: number): [string, string] | null {
  const d = c.get(polyId)?.def;
  if (d?.k !== 'polygon') return null;
  let best: [string, string] | null = null, bd = tol;
  d.pts.forEach((a, i) => {
    const b = d.pts[(i + 1) % d.pts.length];
    const A = c.comp(a)?.pt, B = c.comp(b)?.pt;
    if (!A || !B) return;
    const dist = G.distToLine({ p: A, d: G.sub(B, A), tmin: 0, tmax: 1 }, w);
    if (dist < bd) { bd = dist; best = [a, b]; }
  });
  return best;
}

/** Polygones dont le point est un sommet, avec ses deux voisins. */
export function vertexOf(c: Construction, pointId: string): { poly: string; prev: string; next: string }[] {
  const out: { poly: string; prev: string; next: string }[] = [];
  for (const o of c.objects) {
    if (o.def.k !== 'polygon') continue;
    const pts = o.def.pts, i = pts.indexOf(pointId);
    if (i >= 0) out.push({ poly: o.id, prev: pts[(i - 1 + pts.length) % pts.length], next: pts[(i + 1) % pts.length] });
  }
  return out;
}
