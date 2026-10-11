// Solveur de contraintes : les mesures saisies par l'utilisateur (longueurs, angles, côtés égaux)
// sont des « verrous » tenus en permanence. Quand on en ajoute un ou qu'on déplace un point,
// on cherche la figure la plus proche qui respecte TOUS les verrous (méthode de Gauss-Newton à
// correction minimale, avec des masses pour choisir ce qui bouge le moins).
//
// Seuls les points libres (définis par leurs coordonnées) sont déplacés : un verrou dont un point
// est construit (milieu, intersection…) n'est pas pris en charge.
import type { Construction, Def, GeoObject } from './construction';
import * as G from './geom';

export type LockDef = Extract<Def, { k: 'lock' }>;
export interface LockObj extends GeoObject { def: LockDef }

export const lockObjects = (c: Construction): LockObj[] => c.objects.filter((o): o is LockObj => o.def.k === 'lock');

export const lockPoints = (d: LockDef): string[] =>
  d.kind === 'len' ? [d.a, d.b] : d.kind === 'ang' ? [d.p, d.v, d.n] : [d.a, d.b, d.c, d.d];

const isFree = (c: Construction, id: string) => c.get(id)?.def.k === 'free';

/** Un verrou est applicable si tous ses points sont libres. */
export const enforceable = (c: Construction, d: LockDef) => lockPoints(d).every((id) => isFree(c, id));

const samePair = (a: string, b: string, x: string, y: string) => (a === x && b === y) || (a === y && b === x);

export function findLenLock(c: Construction, a: string, b: string): LockObj | undefined {
  return lockObjects(c).find((o) => o.def.kind === 'len' && samePair(o.def.a, o.def.b, a, b));
}

export function findAngLock(c: Construction, p: string, v: string, n: string): LockObj | undefined {
  return lockObjects(c).find((o) => o.def.kind === 'ang' && o.def.v === v && samePair(o.def.p, o.def.n, p, n));
}

export interface SolveOptions {
  /** Masse des points (défaut 1) : plus elle est grande, moins le point bouge. */
  mass?: Record<string, number>;
}

/** Résout un système linéaire dense A·y = b (élimination de Gauss avec pivot). Renvoie null si singulier. */
function linSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    if (Math.abs(M[piv][i]) < 1e-14) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * y[j];
    y[i] = s / M[i][i];
  }
  return y;
}

/**
 * Déplace les points libres pour satisfaire tous les verrous applicables, en bougeant le moins possible.
 * Renvoie false (et ne modifie rien) si les mesures sont incompatibles.
 */
export function solveLocks(c: Construction, opts: SolveOptions = {}): boolean {
  const ls = lockObjects(c).filter((l) => enforceable(c, l.def));
  if (!ls.length) return true;

  const ids: string[] = [];
  for (const l of ls) for (const id of lockPoints(l.def)) if (!ids.includes(id)) ids.push(id);
  const at = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length * 2;
  const x = new Array<number>(n);
  ids.forEach((id, i) => {
    const d = c.get(id)!.def as Extract<Def, { k: 'free' }>;
    x[2 * i] = d.x; x[2 * i + 1] = d.y;
  });
  const inv = new Array<number>(n);
  ids.forEach((id, i) => { const m = opts.mass?.[id] ?? 1; inv[2 * i] = inv[2 * i + 1] = 1 / m; });

  const P = (v: number[], id: string) => { const i = at.get(id)!; return { x: v[2 * i], y: v[2 * i + 1] }; };
  const resid = (v: number[]) => ls.map((l) => {
    const d = l.def;
    if (d.kind === 'len') return G.dist(P(v, d.a), P(v, d.b)) - d.value;
    if (d.kind === 'eq') return G.dist(P(v, d.a), P(v, d.b)) - G.dist(P(v, d.c), P(v, d.d));
    const ang = G.angleDeg(P(v, d.p), P(v, d.v), P(v, d.n));
    return Number.isFinite(ang) ? ((ang - d.value) * Math.PI) / 180 : 0;
  });
  const norm2 = (r: number[]) => r.reduce((s, q) => s + q * q, 0);

  const m = ls.length;
  let r = resid(x);
  for (let it = 0; it < 300 && Math.max(...r.map(Math.abs)) > 1e-11; it++) {
    // jacobienne par différences centrées
    const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = 1e-6;
      const xp = x.slice(), xm = x.slice();
      xp[j] += h; xm[j] -= h;
      const rp = resid(xp), rm = resid(xm);
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
    }
    // (J M⁻¹ Jᵀ + εI) y = −r ;  dx = M⁻¹ Jᵀ y
    const A: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < m; i++) for (let k = i; k < m; k++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += J[i][j] * inv[j] * J[k][j];
      A[i][k] = A[k][i] = s + (i === k ? 1e-10 : 0);
    }
    const y = linSolve(A, r.map((q) => -q));
    if (!y) return false;
    const dx = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += J[i][j] * y[i]; dx[j] = inv[j] * s; }
    // recherche de pas : on réduit si l'erreur augmente
    const before = norm2(r);
    let t = 1, xn = x, rn = r;
    for (let k = 0; k < 8; k++) {
      xn = x.map((q, j) => q + t * dx[j]);
      rn = resid(xn);
      if (norm2(rn) < before) break;
      t /= 2;
    }
    for (let j = 0; j < n; j++) x[j] = xn[j];
    r = rn;
    if (!x.every(Number.isFinite)) return false;
  }
  if (Math.max(...r.map(Math.abs)) > 1e-7) return false;
  ids.forEach((id, i) => {
    const d = c.get(id)!.def as Extract<Def, { k: 'free' }>;
    d.x = x[2 * i]; d.y = x[2 * i + 1];
  });
  return true;
}

/** Points libres concernés par au moins un verrou. */
export function lockedPointIds(c: Construction): string[] {
  const out = new Set<string>();
  for (const l of lockObjects(c)) if (enforceable(c, l.def)) lockPoints(l.def).forEach((id) => out.add(id));
  return [...out];
}

/**
 * Déplace un point libre (glisser-déposer) en respectant les verrous.
 * Si la position demandée est impossible, le point reste où il était (renvoie false).
 */
export function moveFreePoint(c: Construction, id: string, to: G.Vec): boolean {
  const d = c.get(id)?.def;
  if (d?.k !== 'free') return false;
  const involved = lockedPointIds(c);
  const saved = [...new Set([id, ...involved])].map((pid) => {
    const q = c.get(pid)!.def as Extract<Def, { k: 'free' }>;
    return { pid, x: q.x, y: q.y };
  });
  d.x = to.x; d.y = to.y;
  if (!involved.length) return true;
  if (solveLocks(c, { mass: { [id]: 40 } })) return true;
  for (const s of saved) { const q = c.get(s.pid)!.def as Extract<Def, { k: 'free' }>; q.x = s.x; q.y = s.y; }
  return false;
}
