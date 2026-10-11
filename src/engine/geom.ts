// Primitives vectorielles et intersections.

export interface Vec { x: number; y: number }

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const norm = (a: Vec): Vec => {
  const l = len(a);
  return l < 1e-15 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const rotate = (p: Vec, c: Vec, deg: number): Vec => {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r), sn = Math.sin(r);
  const d = sub(p, c);
  return { x: c.x + d.x * cs - d.y * sn, y: c.y + d.x * sn + d.y * cs };
};

/** Droite paramétrée p + t·d, t ∈ [tmin, tmax] (segment : [0,1], demi-droite : [0,∞[). */
export interface LineC { p: Vec; d: Vec; tmin: number; tmax: number }

export const EPS = 1e-9;
export const inRange = (l: LineC, t: number) => t >= l.tmin - EPS && t <= l.tmax + EPS;
export const at = (l: LineC, t: number) => add(l.p, mul(l.d, t));

/** Paramètre t de la projection orthogonale de q sur la droite. */
export const projT = (l: LineC, q: Vec) => dot(sub(q, l.p), l.d) / dot(l.d, l.d);

export const project = (l: LineC, q: Vec) => at(l, projT(l, q));

export const reflect = (l: LineC, q: Vec) => {
  const h = project(l, q);
  return { x: 2 * h.x - q.x, y: 2 * h.y - q.y };
};

/** Distance d'un point à la partie tracée de la ligne. */
export const distToLine = (l: LineC, q: Vec) => {
  const t = Math.min(l.tmax, Math.max(l.tmin, projT(l, q)));
  return dist(at(l, t), q);
};

export function lineLine(a: LineC, b: LineC): Vec | null {
  const den = cross(a.d, b.d);
  if (Math.abs(den) < 1e-12) return null;
  const w = sub(b.p, a.p);
  const t = cross(w, b.d) / den;
  const u = cross(w, a.d) / den;
  if (!inRange(a, t) || !inRange(b, u)) return null;
  return at(a, t);
}

/** Les deux solutions brutes (ordre stable), null si hors de la partie tracée. */
export function lineCircle(l: LineC, c: Vec, r: number): (Vec | null)[] {
  const f = sub(l.p, c);
  const A = dot(l.d, l.d), B = 2 * dot(f, l.d), C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < -1e-12) return [null, null];
  const s = Math.sqrt(Math.max(0, disc));
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].map((t) => (inRange(l, t) ? at(l, t) : null));
}

export function circleCircle(c1: Vec, r1: number, c2: Vec, r2: number): (Vec | null)[] {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [null, null];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const u = norm(sub(c2, c1));
  const m = add(c1, mul(u, a));
  return [add(m, mul(perp(u), h)), add(m, mul(perp(u), -h))];
}

/** Angle géométrique ABC en degrés, dans [0, 180]. */
export function angleDeg(a: Vec, b: Vec, c: Vec) {
  const u = sub(a, b), w = sub(c, b);
  const l = len(u) * len(w);
  if (l < 1e-15) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, w) / l))) * 180) / Math.PI;
}

/** Point dans un polygone (règle pair-impair). */
export function inPolygon(pts: Vec[], q: Vec) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(pts: Vec[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return Math.abs(s) / 2;
}

/** Nombre au format français : virgule décimale, 2 décimales max. */
export function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return '?';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return (Object.is(r, -0) ? 0 : r).toLocaleString('fr-FR', { maximumFractionDigits: digits, useGrouping: false });
}
