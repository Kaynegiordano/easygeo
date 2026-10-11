// Modèle de la figure : objets ordonnés, chacun défini à partir d'objets précédents.
// Le recalcul suit l'ordre de création, qui est donc un ordre topologique.
import { compile, type EvalFunction } from 'mathjs';
import * as G from './geom';
import type { LineC, Vec } from './geom';

export type ObjType = 'point' | 'line' | 'circle' | 'polygon' | 'function' | 'number';

export type Def =
  | { k: 'free'; x: number; y: number }
  | { k: 'coords'; x: string; y: string }
  | { k: 'midpoint'; a: string; b: string }
  | { k: 'intersect'; a: string; b: string; i: number }
  | { k: 'on'; o: string; t: number }
  | { k: 'reflectLine'; p: string; l: string }
  | { k: 'reflectPoint'; p: string; c: string }
  | { k: 'translate'; p: string; a: string; b: string }
  | { k: 'rotate'; p: string; c: string; angle: string }
  | { k: 'segment' | 'line' | 'ray'; a: string; b: string }
  | { k: 'perp' | 'parallel'; p: string; l: string }
  | { k: 'bisector'; a: string; b: string }
  | { k: 'angleBisector'; a: string; b: string; c: string }
  | { k: 'circle2'; c: string; p: string }
  | { k: 'circleR'; c: string; r: string }
  | { k: 'polygon'; pts: string[] }
  | { k: 'function'; expr: string }
  | { k: 'slider'; value: number; min: number; max: number; step: number }
  | { k: 'distance'; a: string; b: string }
  | { k: 'angle'; a: string; b: string; c: string }
  /** Mesure imposée par l'utilisateur : tenue en permanence par le solveur (voir solve.ts). */
  | { k: 'lock'; kind: 'len'; a: string; b: string; value: number }
  | { k: 'lock'; kind: 'ang'; p: string; v: string; n: string; value: number }
  | { k: 'lock'; kind: 'eq'; a: string; b: string; c: string; d: string };

export interface GeoObject {
  id: string;
  name: string;
  type: ObjType;
  def: Def;
  color: string;
  visible: boolean;
  /** Objet auxiliaire créé implicitement (ex. droite (AB) pour une perpendiculaire). */
  aux?: boolean;
  /** Position du nom d'un point par rapport au point (pixels), quand l'utilisateur l'a déplacé. */
  labelOff?: { x: number; y: number };
  /** Nom du point non affiché sur la figure. */
  noName?: boolean;
}

export interface Computed {
  pt?: Vec;
  line?: LineC;
  circle?: { c: Vec; r: number };
  poly?: Vec[];
  fn?: (x: number) => number;
  value?: number;
  /** Pour les angles : sommet et extrémités, pour tracer l'arc. */
  angle?: { a: Vec; b: Vec; c: Vec };
}

const TYPE_OF: Record<Def['k'], ObjType> = {
  free: 'point', coords: 'point', midpoint: 'point', intersect: 'point', on: 'point',
  reflectLine: 'point', reflectPoint: 'point', translate: 'point', rotate: 'point',
  segment: 'line', line: 'line', ray: 'line', perp: 'line', parallel: 'line',
  bisector: 'line', angleBisector: 'line',
  circle2: 'circle', circleR: 'circle', polygon: 'polygon', function: 'function',
  slider: 'number', distance: 'number', angle: 'number', lock: 'number',
};

export const PALETTE = {
  point: '#4f46e5',
  line: '#334155',
  circle: '#0d9488',
  polygon: '#d97706',
  function: '#dc2626',
  number: '#7c3aed',
};

export const COLORS: Record<string, string> = {
  rouge: '#dc2626', bleu: '#2563eb', vert: '#16a34a', orange: '#ea580c', violet: '#7c3aed',
  rose: '#db2777', noir: '#111827', gris: '#6b7280', jaune: '#ca8a04', marron: '#92400e', cyan: '#0891b2',
};

/** Identifiants référencés par une définition. */
export function refs(d: Def): string[] {
  switch (d.k) {
    case 'free': case 'coords': case 'function': case 'slider': return [];
    case 'midpoint': case 'segment': case 'line': case 'ray': case 'bisector': case 'distance': case 'intersect':
      return [d.a, d.b];
    case 'on': return [d.o];
    case 'reflectLine': return [d.p, d.l];
    case 'reflectPoint': return [d.p, d.c];
    case 'translate': return [d.p, d.a, d.b];
    case 'rotate': return [d.p, d.c];
    case 'perp': case 'parallel': return [d.p, d.l];
    case 'angleBisector': case 'angle': return [d.a, d.b, d.c];
    case 'lock': return d.kind === 'len' ? [d.a, d.b] : d.kind === 'ang' ? [d.p, d.v, d.n] : [d.a, d.b, d.c, d.d];
    case 'circle2': return [d.c, d.p];
    case 'circleR': return [d.c];
    case 'polygon': return d.pts;
  }
}

const exprCache = new Map<string, EvalFunction | null>();

/** Normalise une saisie « à la française » vers la syntaxe mathjs. */
export function normalizeExpr(s: string) {
  return s
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/\bracine\s*\(/gi, 'sqrt(')
    .replace(/(\d),(\d)/g, '$1.$2');
}

function compileExpr(s: string): EvalFunction | null {
  if (!exprCache.has(s)) {
    try { exprCache.set(s, compile(normalizeExpr(s))); } catch { exprCache.set(s, null); }
  }
  return exprCache.get(s)!;
}

export function evalExpr(s: string, scope: Record<string, number>): number {
  const f = compileExpr(s);
  if (!f) return NaN;
  try {
    const r = f.evaluate({ ...scope });
    return typeof r === 'number' ? r : NaN;
  } catch { return NaN; }
}

export function isValidExpr(s: string) { return compileExpr(s) !== null; }

export interface Snapshot { objects: GeoObject[]; nextId: number }

export class Construction {
  objects: GeoObject[] = [];
  computed = new Map<string, Computed>();
  scope: Record<string, number> = {};
  private nextId = 1;
  private listeners = new Set<() => void>();
  version = 0;

  // ---------- accès ----------
  get(id: string) { return this.objects.find((o) => o.id === id); }
  byName(name: string) {
    return this.objects.find((o) => o.name === name) ?? this.objects.find((o) => o.name.toLowerCase() === name.toLowerCase());
  }
  comp(id: string) { return this.computed.get(id); }
  nameOf(id: string) { return this.get(id)?.name ?? '?'; }

  // ---------- notifications ----------
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() {
    this.recompute();
    this.version++;
    this.listeners.forEach((f) => f());
  }

  // ---------- historique ----------
  snapshot(): Snapshot { return { objects: structuredClone(this.objects), nextId: this.nextId }; }
  restore(s: Snapshot) {
    this.objects = structuredClone(s.objects);
    this.nextId = s.nextId;
    this.changed();
  }

  // ---------- noms ----------
  nameFree(n: string) { return !this.objects.some((o) => o.name === n); }

  autoName(type: ObjType, k?: Def['k']): string {
    if (type === 'point') {
      for (let i = 0; ; i++) {
        for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          const n = i === 0 ? L : L + i;
          if (this.nameFree(n)) return n;
        }
      }
    }
    if (type === 'function') {
      for (const n of ['f', 'g', 'h', 'k', 'p', 'q']) if (this.nameFree(n)) return n;
    }
    if (k === 'angle') {
      for (const n of 'αβγδεζηθλμφψω') if (this.nameFree(n)) return n;
    }
    if (k === 'slider') {
      for (const n of 'abcdkmnrstuvw') if (this.nameFree(n)) return n;
    }
    const prefix =
      k === 'segment' ? 's' : k === 'ray' ? 'r' : type === 'line' ? 'd' : type === 'circle' ? 'c'
      : type === 'polygon' ? 'poly' : k === 'distance' ? 'l' : 'n';
    for (let i = 1; ; i++) if (this.nameFree(prefix + i)) return prefix + i;
  }

  primeName(base: string) {
    let n = base + "'";
    while (!this.nameFree(n)) n += "'";
    return n;
  }

  // ---------- modifications ----------
  add(def: Def, opts: { name?: string; color?: string; aux?: boolean; visible?: boolean } = {}): string {
    const type = TYPE_OF[def.k];
    const name = opts.name ?? this.autoName(type, def.k);
    if (!this.nameFree(name)) throw new Error(`Le nom « ${name} » est déjà utilisé.`);
    const id = 'o' + this.nextId++;
    this.objects.push({
      id, name, type, def,
      color: opts.color ?? PALETTE[type],
      visible: opts.visible ?? !opts.aux,
      aux: opts.aux,
    });
    return id;
  }

  /** Supprime l'objet et tout ce qui en dépend. */
  remove(id: string) {
    const dead = new Set([id]);
    for (const o of this.objects) if (refs(o.def).some((r) => dead.has(r))) dead.add(o.id);
    this.objects = this.objects.filter((o) => !dead.has(o.id));
  }

  rename(id: string, name: string) {
    const o = this.get(id);
    if (!o) return;
    if (o.name === name) return;
    if (!this.nameFree(name)) throw new Error(`Le nom « ${name} » est déjà utilisé.`);
    o.name = name;
  }

  clear() { this.objects = []; this.nextId = 1; }

  // ---------- calcul ----------
  recompute() {
    this.computed.clear();
    this.scope = {};
    for (const o of this.objects) {
      let c: Computed | undefined;
      try { c = this.computeOne(o.def); } catch { c = undefined; }
      if (c) {
        this.computed.set(o.id, c);
        if (c.value !== undefined && /^[\p{L}][\p{L}\d_]*$/u.test(o.name)) this.scope[o.name] = c.value;
      }
    }
  }

  private P(id: string) { return this.computed.get(id)?.pt; }
  private L(id: string) { return this.computed.get(id)?.line; }

  private computeOne(d: Def): Computed | undefined {
    const P = (id: string) => this.P(id);
    switch (d.k) {
      case 'free': return { pt: { x: d.x, y: d.y } };
      case 'coords': {
        const x = evalExpr(d.x, this.scope), y = evalExpr(d.y, this.scope);
        return Number.isFinite(x) && Number.isFinite(y) ? { pt: { x, y } } : undefined;
      }
      case 'midpoint': {
        const a = P(d.a), b = P(d.b);
        return a && b ? { pt: G.mid(a, b) } : undefined;
      }
      case 'intersect': {
        const pts = this.intersections(d.a, d.b);
        const p = pts[d.i];
        return p ? { pt: p } : undefined;
      }
      case 'on': {
        const o = this.computed.get(d.o);
        if (o?.line) return { pt: G.at(o.line, Math.min(o.line.tmax, Math.max(o.line.tmin, d.t))) };
        if (o?.circle) return { pt: G.add(o.circle.c, G.v(o.circle.r * Math.cos(d.t), o.circle.r * Math.sin(d.t))) };
        if (o?.fn) {
          const y = o.fn(d.t);
          return Number.isFinite(y) ? { pt: { x: d.t, y } } : undefined;
        }
        return undefined;
      }
      case 'reflectLine': {
        const p = P(d.p), l = this.L(d.l);
        return p && l ? { pt: G.reflect(l, p) } : undefined;
      }
      case 'reflectPoint': {
        const p = P(d.p), c = P(d.c);
        return p && c ? { pt: G.v(2 * c.x - p.x, 2 * c.y - p.y) } : undefined;
      }
      case 'translate': {
        const p = P(d.p), a = P(d.a), b = P(d.b);
        return p && a && b ? { pt: G.add(p, G.sub(b, a)) } : undefined;
      }
      case 'rotate': {
        const p = P(d.p), c = P(d.c), ang = evalExpr(d.angle, this.scope);
        return p && c && Number.isFinite(ang) ? { pt: G.rotate(p, c, ang) } : undefined;
      }
      case 'segment': case 'line': case 'ray': {
        const a = P(d.a), b = P(d.b);
        if (!a || !b || G.dist(a, b) < 1e-12) return undefined;
        const tmax = d.k === 'segment' ? 1 : Infinity;
        const tmin = d.k === 'line' ? -Infinity : 0;
        return { line: { p: a, d: G.sub(b, a), tmin, tmax } };
      }
      case 'perp': case 'parallel': {
        const p = P(d.p), l = this.L(d.l);
        if (!p || !l) return undefined;
        const dir = G.norm(d.k === 'perp' ? G.perp(l.d) : l.d);
        return { line: { p, d: dir, tmin: -Infinity, tmax: Infinity } };
      }
      case 'bisector': {
        const a = P(d.a), b = P(d.b);
        if (!a || !b || G.dist(a, b) < 1e-12) return undefined;
        return { line: { p: G.mid(a, b), d: G.norm(G.perp(G.sub(b, a))), tmin: -Infinity, tmax: Infinity } };
      }
      case 'angleBisector': {
        const a = P(d.a), b = P(d.b), c = P(d.c);
        if (!a || !b || !c) return undefined;
        let dir = G.add(G.norm(G.sub(a, b)), G.norm(G.sub(c, b)));
        if (G.len(dir) < 1e-12) dir = G.perp(G.sub(a, b));
        return { line: { p: b, d: G.norm(dir), tmin: 0, tmax: Infinity } };
      }
      case 'circle2': {
        const c = P(d.c), p = P(d.p);
        return c && p ? { circle: { c, r: G.dist(c, p) } } : undefined;
      }
      case 'circleR': {
        const c = P(d.c), r = evalExpr(d.r, this.scope);
        return c && r > 0 ? { circle: { c, r } } : undefined;
      }
      case 'polygon': {
        const pts = d.pts.map(P);
        return pts.every(Boolean) ? { poly: pts as Vec[] } : undefined;
      }
      case 'function': {
        const f = compileExpr(d.expr);
        if (!f) return undefined;
        // Référence (pas copie) : un curseur créé après la fonction reste visible.
        const scope = this.scope;
        const fn = (x: number) => {
          try {
            const r = f.evaluate({ ...scope, x });
            return typeof r === 'number' ? r : NaN;
          } catch { return NaN; }
        };
        return { fn };
      }
      case 'slider': return { value: d.value };
      case 'distance': {
        const a = P(d.a), b = P(d.b);
        return a && b ? { value: G.dist(a, b) } : undefined;
      }
      case 'angle': {
        const a = P(d.a), b = P(d.b), c = P(d.c);
        if (!a || !b || !c) return undefined;
        const value = G.angleDeg(a, b, c);
        return Number.isFinite(value) ? { value, angle: { a, b, c } } : undefined;
      }
      case 'lock': return undefined; // contrainte : n'a pas de valeur propre, elle agit sur les points libres
    }
  }

  /** Points d'intersection bruts (indices stables) entre deux objets. */
  intersections(aId: string, bId: string): (Vec | null)[] {
    const a = this.computed.get(aId), b = this.computed.get(bId);
    if (!a || !b) return [];
    if (a.line && b.line) return [G.lineLine(a.line, b.line)];
    if (a.line && b.circle) return G.lineCircle(a.line, b.circle.c, b.circle.r);
    if (a.circle && b.line) return G.lineCircle(b.line, a.circle.c, a.circle.r);
    if (a.circle && b.circle) return G.circleCircle(a.circle.c, a.circle.r, b.circle.c, b.circle.r);
    const fnAndLine = (fn: (x: number) => number, l: LineC) => fnLineIntersections(fn, l);
    if (a.fn && b.line) return fnAndLine(a.fn, b.line);
    if (a.line && b.fn) return fnAndLine(b.fn, a.line);
    return [];
  }

  /** Nombre maximal d'intersections entre deux types d'objets. */
  intersectionCount(aId: string, bId: string) {
    const a = this.get(aId)?.type, b = this.get(bId)?.type;
    if (a === 'line' && b === 'line') return 1;
    if (a === 'function' || b === 'function') return this.intersections(aId, bId).length;
    return 2;
  }

  /** Points « libres » qui définissent directement l'objet (pour le déplacer en bloc). */
  freeHandles(id: string): string[] {
    const o = this.get(id);
    if (!o) return [];
    if (o.def.k === 'free') return [id];
    if (o.type === 'point') return [];
    const ids = refs(o.def);
    return ids.every((r) => this.get(r)?.def.k === 'free') ? ids : [];
  }

  // ---------- sérialisation ----------
  toJSON() { return { format: 'easygeo', version: 1, objects: this.objects, nextId: this.nextId }; }
  load(data: { objects: GeoObject[]; nextId?: number }) {
    this.objects = data.objects;
    this.nextId = data.nextId ?? Math.max(0, ...data.objects.map((o) => parseInt(o.id.slice(1)) || 0)) + 1;
    this.changed();
  }
}

/** Intersections d'une courbe y=f(x) avec une droite (non verticale), par balayage + dichotomie. */
function fnLineIntersections(fn: (x: number) => number, l: LineC): (Vec | null)[] {
  if (Math.abs(l.d.x) < 1e-12) {
    const y = fn(l.p.x);
    if (!Number.isFinite(y)) return [];
    const t = (y - l.p.y) / l.d.y;
    return G.inRange(l, t) ? [{ x: l.p.x, y }] : [];
  }
  const slope = l.d.y / l.d.x;
  const g = (x: number) => fn(x) - (l.p.y + slope * (x - l.p.x));
  const out: Vec[] = [];
  const N = 2000, X0 = -50, X1 = 50;
  let px = X0, pv = g(px);
  for (let i = 1; i <= N; i++) {
    const x = X0 + ((X1 - X0) * i) / N, val = g(x);
    if (Number.isFinite(pv) && Number.isFinite(val) && (pv === 0 || pv * val < 0)) {
      let lo = px, hi = x;
      for (let k = 0; k < 50; k++) {
        const m = (lo + hi) / 2;
        if (g(lo) * g(m) <= 0) hi = m; else lo = m;
      }
      const r = (lo + hi) / 2, y = fn(r);
      if (Math.abs(g(r)) < 1e-6 && G.inRange(l, (r - l.p.x) / l.d.x)) out.push({ x: r, y });
    }
    px = x; pv = val;
  }
  return out.slice(0, 6);
}
