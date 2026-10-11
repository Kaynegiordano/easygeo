// Rendu Canvas 2D et détection des objets sous le curseur.
import type { Construction, GeoObject } from './construction';
import * as G from './geom';
import type { LineC, Vec } from './geom';
import { displayName } from './describe';
import { drawMeasures, type Measures } from './labels';

export interface View { ox: number; oy: number; scale: number }

export interface Theme {
  bg: string; grid: string; gridMajor: string; axis: string; text: string; label: string; select: string;
}

export interface DrawOptions {
  grid: boolean;
  axes: boolean;
  selected: Set<string>;
  hover: string | null;
  /** Objets en cours de sélection par un outil. */
  pending: Set<string>;
  /** Mesures écrites sur la figure (longueurs, angles, codages) et valeur survolée. */
  measures?: Measures;
  hoverLabel?: string | null;
  /** Point dont le nom est survolé (il se modifie d'un clic). */
  hoverName?: string | null;
  preview?: (ctx: CanvasRenderingContext2D, tw: (p: Vec) => Vec) => void;
}

export class Viewport {
  w = 0; h = 0;
  constructor(public view: View) {}
  toScreen = (p: Vec): Vec => ({ x: this.w / 2 + (p.x - this.view.ox) * this.view.scale, y: this.h / 2 - (p.y - this.view.oy) * this.view.scale });
  toWorld = (s: Vec): Vec => ({ x: this.view.ox + (s.x - this.w / 2) / this.view.scale, y: this.view.oy - (s.y - this.h / 2) / this.view.scale });
  get bounds() {
    const a = this.toWorld({ x: 0, y: this.h }), b = this.toWorld({ x: this.w, y: 0 });
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }
  zoomAt(s: Vec, factor: number) {
    const before = this.toWorld(s);
    this.view.scale = Math.min(2000, Math.max(4, this.view.scale * factor));
    const after = this.toWorld(s);
    this.view.ox += before.x - after.x;
    this.view.oy += before.y - after.y;
  }
  /** Pas de grille « rond » (1, 2, 5 × 10ⁿ) d'au moins ~45 px. */
  gridStep() {
    const raw = 45 / this.view.scale;
    const p = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }
}

/** Partie visible d'une ligne, en coordonnées monde. */
function visibleSegment(vp: Viewport, l: LineC): [Vec, Vec] | null {
  const b = vp.bounds;
  const center = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const L = G.len(l.d);
  if (L < 1e-15) return null;
  const half = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / L;
  const tc = G.projT(l, center);
  const t0 = Math.max(l.tmin, tc - half), t1 = Math.min(l.tmax, tc + half);
  return t0 < t1 ? [G.at(l, t0), G.at(l, t1)] : null;
}

export function draw(ctx: CanvasRenderingContext2D, c: Construction, vp: Viewport, th: Theme, o: DrawOptions) {
  const { w, h } = vp;
  const S = vp.toScreen;
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (o.grid || o.axes) drawGrid(ctx, vp, th, o.grid, o.axes);

  const vis = c.objects.filter((x) => x.visible && c.comp(x.id));
  const highlight = (x: GeoObject) => o.selected.has(x.id) || o.pending.has(x.id) || o.hover === x.id;
  const order: GeoObject['type'][] = ['polygon', 'function', 'circle', 'line', 'number', 'point'];

  for (const type of order) {
    for (const obj of vis.filter((x) => x.type === type)) {
      const k = c.comp(obj.id)!;
      const hl = highlight(obj);
      ctx.save();
      if (hl) {
        ctx.shadowColor = obj.color;
        ctx.shadowBlur = 10;
      }
      ctx.strokeStyle = obj.color;
      ctx.fillStyle = obj.color;
      ctx.lineWidth = hl ? 3.5 : 2;

      if (k.poly) {
        ctx.beginPath();
        k.poly.forEach((p, i) => { const s = S(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
        ctx.closePath();
        ctx.globalAlpha = hl ? 0.28 : 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      } else if (k.fn) {
        drawFunction(ctx, vp, k.fn);
        labelAt(ctx, th, obj.name, curveLabelPos(vp, k.fn), obj.color);
      } else if (k.circle) {
        const s = S(k.circle.c);
        ctx.beginPath();
        ctx.arc(s.x, s.y, k.circle.r * vp.view.scale, 0, Math.PI * 2);
        ctx.stroke();
      } else if (k.line) {
        const seg = visibleSegment(vp, k.line);
        if (seg) {
          const a = S(seg[0]), b = S(seg[1]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      } else if (k.angle) {
        drawAngle(ctx, vp, th, obj, k.angle, k.value!);
      } else if (obj.def.k === 'distance' && k.value !== undefined) {
        const a = c.comp(obj.def.a)?.pt, b = c.comp(obj.def.b)?.pt;
        if (a && b) {
          const m = S(G.mid(a, b));
          const nrm = G.norm(G.perp(G.sub(S(b), S(a))));
          pill(ctx, th, `${displayName(c, obj)} = ${G.fmt(k.value)}`, { x: m.x + nrm.x * 26, y: m.y + nrm.y * 22 }, obj.color);
        }
      } else if (k.pt) {
        const s = S(k.pt);
        const free = obj.def.k === 'free' || obj.def.k === 'on';
        ctx.beginPath();
        ctx.arc(s.x, s.y, hl ? 6.5 : free ? 5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = free ? obj.color : th.bg;
        ctx.fill();
        ctx.lineWidth = free ? 1.5 : 2.2;
        ctx.strokeStyle = free ? th.bg : obj.color;
        ctx.stroke();
        if (!free) { ctx.beginPath(); ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2); ctx.fillStyle = obj.color; ctx.fill(); }
        ctx.restore();
        ctx.save();
        const nb = obj.noName ? null : nameBox(c, vp, obj);
        if (nb) labelAt(ctx, th, obj.name, { x: nb.cx - nb.tw / 2, y: nb.cy }, th.label, o.hoverName === obj.id || o.selected.has(obj.id));
      }
      ctx.restore();
    }
  }
  if (o.measures) drawMeasures(ctx, o.measures, th, o.hoverLabel ?? null);
  if (o.preview) { ctx.save(); o.preview(ctx, S); ctx.restore(); }
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, th: Theme, grid: boolean, axes: boolean) {
  const step = vp.gridStep();
  const b = vp.bounds;
  const S = vp.toScreen;
  ctx.lineWidth = 1;
  if (grid) {
    const minor = step / 5;
    if (minor * vp.view.scale > 8) {
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      for (let x = Math.ceil(b.x0 / minor) * minor; x < b.x1; x += minor) { const s = S({ x, y: 0 }).x; ctx.moveTo(s, 0); ctx.lineTo(s, vp.h); }
      for (let y = Math.ceil(b.y0 / minor) * minor; y < b.y1; y += minor) { const s = S({ x: 0, y }).y; ctx.moveTo(0, s); ctx.lineTo(vp.w, s); }
      ctx.stroke();
    }
    ctx.strokeStyle = th.gridMajor;
    ctx.beginPath();
    for (let x = Math.ceil(b.x0 / step) * step; x < b.x1; x += step) { const s = Math.round(S({ x, y: 0 }).x) + 0.5; ctx.moveTo(s, 0); ctx.lineTo(s, vp.h); }
    for (let y = Math.ceil(b.y0 / step) * step; y < b.y1; y += step) { const s = Math.round(S({ x: 0, y }).y) + 0.5; ctx.moveTo(0, s); ctx.lineTo(vp.w, s); }
    ctx.stroke();
  }
  if (!axes) return;
  const o = S({ x: 0, y: 0 });
  const ax = Math.min(vp.h - 4, Math.max(4, o.y)), ay = Math.min(vp.w - 4, Math.max(4, o.x));
  ctx.strokeStyle = th.axis;
  ctx.fillStyle = th.axis;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, ax); ctx.lineTo(vp.w, ax);
  ctx.moveTo(ay, 0); ctx.lineTo(ay, vp.h);
  ctx.stroke();
  // flèches
  ctx.beginPath();
  ctx.moveTo(vp.w - 2, ax); ctx.lineTo(vp.w - 11, ax - 5); ctx.lineTo(vp.w - 11, ax + 5); ctx.closePath();
  ctx.moveTo(ay, 2); ctx.lineTo(ay - 5, 11); ctx.lineTo(ay + 5, 11); ctx.closePath();
  ctx.fill();
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.fillStyle = th.text;
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = Math.ceil(b.x0 / step) * step; x < b.x1; x += step) {
    if (Math.abs(x) < step / 2) continue;
    const s = S({ x, y: 0 }).x;
    ctx.fillText(G.fmt(x, digits), s, Math.min(vp.h - 16, ax + 5));
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(b.y0 / step) * step; y < b.y1; y += step) {
    if (Math.abs(y) < step / 2) continue;
    const s = S({ x: 0, y }).y;
    ctx.fillText(G.fmt(y, digits), Math.max(22, ay - 6), s);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText('0', ay - 5, ax + 4);
}

function drawFunction(ctx: CanvasRenderingContext2D, vp: Viewport, fn: (x: number) => number) {
  ctx.beginPath();
  let pen = false, prevY = 0;
  for (let sx = 0; sx <= vp.w; sx += 1) {
    const x = vp.toWorld({ x: sx, y: 0 }).x;
    const y = fn(x);
    if (!Number.isFinite(y)) { pen = false; continue; }
    const sy = vp.toScreen({ x, y }).y;
    if (pen && Math.abs(sy - prevY) > vp.h * 2) pen = false; // asymptote
    const cy = Math.max(-vp.h, Math.min(2 * vp.h, sy));
    pen ? ctx.lineTo(sx, cy) : ctx.moveTo(sx, cy);
    pen = true; prevY = sy;
  }
  ctx.stroke();
}

function curveLabelPos(vp: Viewport, fn: (x: number) => number): Vec {
  for (let sx = vp.w - 60; sx > 40; sx -= 20) {
    const x = vp.toWorld({ x: sx, y: 0 }).x;
    const y = fn(x);
    if (!Number.isFinite(y)) continue;
    const s = vp.toScreen({ x, y });
    if (s.y > 20 && s.y < vp.h - 20) return { x: s.x, y: s.y - 14 };
  }
  return { x: -100, y: -100 };
}

function drawAngle(ctx: CanvasRenderingContext2D, vp: Viewport, th: Theme, obj: GeoObject, a: { a: Vec; b: Vec; c: Vec }, deg: number) {
  const S = vp.toScreen;
  const B = S(a.b), A = S(a.a), C = S(a.c);
  const a1 = Math.atan2(A.y - B.y, A.x - B.x);
  let a2 = Math.atan2(C.y - B.y, C.x - B.x);
  let diff = a2 - a1;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  a2 = a1 + diff;
  const r = 26;
  ctx.lineWidth = 1.6;
  if (Math.abs(deg - 90) < 0.05) {
    // angle droit : petit carré
    const u = G.mul(G.norm(G.sub(A, B)), 14), w = G.mul(G.norm(G.sub(C, B)), 14);
    ctx.beginPath();
    ctx.moveTo(B.x + u.x, B.y + u.y);
    ctx.lineTo(B.x + u.x + w.x, B.y + u.y + w.y);
    ctx.lineTo(B.x + w.x, B.y + w.y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(B.x, B.y);
    ctx.arc(B.x, B.y, r, a1, a2, diff < 0);
    ctx.closePath();
    ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(B.x, B.y, r, a1, a2, diff < 0); ctx.stroke();
  }
  const m = (a1 + a2) / 2;
  pill(ctx, th, `${obj.name} = ${G.fmt(deg, 1)}°`, { x: B.x + Math.cos(m) * (r + 26), y: B.y + Math.sin(m) * (r + 22) }, obj.color);
}

const NAME_FONT = '600 15px Inter, system-ui, sans-serif';
let measurer: CanvasRenderingContext2D | null = null;
function nameWidth(text: string) {
  measurer ??= document.createElement('canvas').getContext('2d')!;
  measurer.font = NAME_FONT;
  return measurer.measureText(text).width;
}

/** Points reliés à `id` par un segment ou un côté de polygone. */
function neighbours(c: Construction, id: string): string[] {
  const out = new Set<string>();
  for (const o of c.objects) {
    if (!o.visible) continue;
    const d = o.def;
    if (d.k === 'segment') { if (d.a === id) out.add(d.b); else if (d.b === id) out.add(d.a); }
    else if (d.k === 'polygon') {
      const i = d.pts.indexOf(id), n = d.pts.length;
      if (i >= 0) { out.add(d.pts[(i + n - 1) % n]); out.add(d.pts[(i + 1) % n]); }
    }
  }
  return [...out];
}

export interface NameBox { cx: number; cy: number; tw: number }

/** Où s'écrit le nom d'un point : à l'extérieur de la figure (côté opposé aux segments qui y arrivent), sauf si l'utilisateur l'a déplacé. */
export function nameBox(c: Construction, vp: Viewport, obj: GeoObject): NameBox | null {
  const P = c.comp(obj.id)?.pt;
  if (!P) return null;
  const s = vp.toScreen(P);
  const tw = nameWidth(obj.name);
  if (obj.labelOff) return { cx: s.x + obj.labelOff.x, cy: s.y + obj.labelOff.y, tw };
  let ux = 0, uy = 0, first: Vec | null = null;
  for (const nb of neighbours(c, obj.id)) {
    const q = c.comp(nb)?.pt;
    if (!q) continue;
    const t = vp.toScreen(q);
    const v = { x: t.x - s.x, y: t.y - s.y }, L = Math.hypot(v.x, v.y);
    if (L < 1e-6) continue;
    ux += v.x / L; uy += v.y / L;
    first ??= { x: v.x / L, y: v.y / L };
  }
  let dir = { x: 0.75, y: -0.66 };
  if (first) {
    const m = Math.hypot(ux, uy);
    if (m >= 0.3) dir = { x: -ux / m, y: -uy / m };
    else {
      // côtés alignés : le nom se met sur le côté, plutôt vers le haut
      dir = { x: first.y, y: -first.x };
      if (dir.y > 0) dir = { x: -dir.x, y: -dir.y };
    }
  }
  const dist = 10 + (tw / 2) * Math.abs(dir.x) + 8 * Math.abs(dir.y);
  return { cx: s.x + dir.x * dist, cy: s.y + dir.y * dist, tw };
}

/** Point dont le nom est sous le curseur. */
export function hitName(c: Construction, vp: Viewport, s: Vec): string | null {
  for (let i = c.objects.length - 1; i >= 0; i--) {
    const o = c.objects[i];
    if (!o.visible || o.noName || o.aux || o.type !== 'point') continue;
    const b = nameBox(c, vp, o);
    if (b && Math.abs(s.x - b.cx) <= b.tw / 2 + 5 && Math.abs(s.y - b.cy) <= 12) return o.id;
  }
  return null;
}

function labelAt(ctx: CanvasRenderingContext2D, th: Theme, text: string, p: Vec, color: string, active = false) {
  ctx.font = NAME_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (active) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = th.select;
    ctx.beginPath();
    ctx.roundRect(p.x - 5, p.y - 12, ctx.measureText(text).width + 10, 24, 7);
    ctx.fill();
    ctx.restore();
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = th.bg;
  ctx.shadowBlur = 0;
  ctx.strokeText(text, p.x, p.y);
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y);
}

function pill(ctx: CanvasRenderingContext2D, th: Theme, text: string, p: Vec, color: string) {
  ctx.font = '600 12.5px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  ctx.shadowBlur = 0;
  ctx.fillStyle = th.bg;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.roundRect(p.x - w / 2, p.y - 11, w, 22, 11);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x, p.y + 0.5);
}

/** Objets sous le curseur, du plus prioritaire au moins prioritaire. */
export function hitTest(c: Construction, vp: Viewport, s: Vec): string[] {
  const p = vp.toWorld(s);
  const tol = 7 / vp.view.scale;
  const hits: { id: string; prio: number; d: number }[] = [];
  for (const o of c.objects) {
    if (!o.visible) continue;
    const k = c.comp(o.id);
    if (!k) continue;
    if (k.pt) {
      const d = G.dist(vp.toScreen(k.pt), s);
      if (d < 11) hits.push({ id: o.id, prio: 0, d });
    } else if (k.line) {
      const d = G.distToLine(k.line, p);
      if (d < tol) hits.push({ id: o.id, prio: 1, d });
    } else if (k.circle) {
      const d = Math.abs(G.dist(p, k.circle.c) - k.circle.r);
      if (d < tol) hits.push({ id: o.id, prio: 1, d });
    } else if (k.fn) {
      const y = k.fn(p.x);
      const d = Math.abs(y - p.y);
      if (Number.isFinite(y) && d < tol * 1.5) hits.push({ id: o.id, prio: 2, d });
    } else if (k.poly) {
      if (G.inPolygon(k.poly, p)) hits.push({ id: o.id, prio: 3, d: 0 });
    }
  }
  hits.sort((a, b) => a.prio - b.prio || a.d - b.d);
  return hits.map((h) => h.id);
}
