// Retouches directes d'une figure : longueur d'un segment, angle d'un sommet, rayon, coordonnées.
// On ne déplace que des points libres (ou mobiles sur un objet) pour respecter les constructions.
import type { Construction } from './construction';
import * as G from './geom';

const isFree = (c: Construction, id: string) => c.get(id)?.def.k === 'free';

const movePoint = (c: Construction, id: string, p: G.Vec) => {
  const d = c.get(id)!.def;
  if (d.k !== 'free') throw new Error(`Le point ${c.nameOf(id)} est construit : il ne peut pas bouger librement.`);
  d.x = p.x; d.y = p.y;
};

/** Fixe la longueur AB en déplaçant B (ou A si B est construit). */
export function setLength(c: Construction, a: string, b: string, L: number) {
  if (!(L > 0)) throw new Error('La longueur doit être positive.');
  const A = c.comp(a)?.pt, B = c.comp(b)?.pt;
  if (!A || !B) throw new Error('Segment non défini.');
  const u = G.norm(G.sub(B, A));
  if (isFree(c, b)) movePoint(c, b, G.add(A, G.mul(u, L)));
  else if (isFree(c, a)) movePoint(c, a, G.sub(B, G.mul(u, L)));
  else throw new Error(`Les points ${c.nameOf(a)} et ${c.nameOf(b)} sont construits : impossible de changer la longueur.`);
}

/** Fixe l'angle PVN (sommet V) en tournant N (ou P) autour de V, longueur conservée. */
export function setAngle(c: Construction, p: string, v: string, n: string, deg: number) {
  if (!(deg > 0 && deg < 180)) throw new Error("L'angle doit être compris entre 0° et 180°.");
  const P = c.comp(p)?.pt, V = c.comp(v)?.pt, N = c.comp(n)?.pt;
  if (!P || !V || !N) throw new Error('Angle non défini.');
  const turn = (fixed: G.Vec, moving: G.Vec) => {
    // garde le même côté que la figure actuelle
    const side = Math.sign(G.cross(G.sub(fixed, V), G.sub(moving, V))) || 1;
    const dir = G.rotate(G.add(V, G.norm(G.sub(fixed, V))), V, side * deg);
    return G.add(V, G.mul(G.norm(G.sub(dir, V)), G.dist(V, moving)));
  };
  if (isFree(c, n)) movePoint(c, n, turn(P, N));
  else if (isFree(c, p)) movePoint(c, p, turn(N, P));
  else throw new Error(`Les points ${c.nameOf(p)} et ${c.nameOf(n)} sont construits : impossible de changer l'angle.`);
}

export function setRadius(c: Construction, id: string, r: number) {
  if (!(r > 0)) throw new Error('Le rayon doit être positif.');
  const d = c.get(id)!.def;
  if (d.k === 'circleR') { d.r = String(r); return; }
  if (d.k === 'circle2') { setLength(c, d.c, d.p, r); return; }
  throw new Error('Ce cercle ne peut pas être modifié ainsi.');
}

export function setCoords(c: Construction, id: string, x: number, y: number) {
  movePoint(c, id, { x, y });
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
