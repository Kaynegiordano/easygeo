// Mesures affichées « comme sur un vrai dessin » : longueurs écrites le long des côtés,
// angles droits en petit carré, arcs d'angle avec leur valeur, traits de codage des côtés égaux.
// Les valeurs sont cliquables : on les modifie directement sur la figure.
import type { Construction } from './construction';
import * as G from './geom';
import type { Vec } from './geom';
import type { Theme, Viewport } from './render';

export interface MeasureOpts { lengths: boolean; angles: boolean; marks: boolean; unit: boolean }
export const DEFAULT_MEASURES: MeasureOpts = { lengths: true, angles: true, marks: true, unit: true };

export interface LenLabel { kind: 'len'; key: string; a: string; b: string; value: number; text: string; pos: Vec; w: number }
export interface AngLabel { kind: 'ang'; key: string; p: string; v: string; n: string; value: number; text: string; pos: Vec; w: number }
export type MLabel = LenLabel | AngLabel;

export interface Measures {
  labels: MLabel[];
  /** Traits de codage : milieu du côté (écran), direction du côté, nombre de traits. */
  ticks: { pos: Vec; dir: Vec; n: number }[];
  /** Angles droits : trois points écran du petit carré. */
  rights: Vec[][];
  arcs: { c: Vec; r: number; a0: number; sweep: number }[];
}

const LABEL_H = 18;
const estWidth = (t: string) => t.length * 7.6 + 10;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Edge { a: string; b: string; out?: Vec }

export function collectMeasures(c: Construction, vp: Viewport, o: MeasureOpts): Measures {
  const m: Measures = { labels: [], ticks: [], rights: [], arcs: [] };
  if (!o.lengths && !o.angles && !o.marks) return m;
  const S = vp.toScreen;
  const pt = (id: string) => {
    const ob = c.get(id);
    return ob && ob.visible ? c.comp(id)?.pt ?? null : null;
  };

  // Mesures déjà affichées explicitement par un objet (Distance, Angle) : on ne les double pas.
  const explicitLen = new Set<string>(), explicitAng = new Set<string>();
  for (const ob of c.objects) {
    if (!ob.visible) continue;
    if (ob.def.k === 'distance') explicitLen.add(pairKey(ob.def.a, ob.def.b));
    if (ob.def.k === 'angle') explicitAng.add(`${ob.def.b}|${pairKey(ob.def.a, ob.def.c)}`);
  }

  // ---------- côtés : segments et côtés de polygones ----------
  const edges = new Map<string, Edge>();
  const polys: { id: string; pts: string[] }[] = [];
  for (const ob of c.objects) {
    if (!ob.visible) continue;
    if (ob.def.k === 'segment' && !ob.aux) {
      const k = pairKey(ob.def.a, ob.def.b);
      if (!edges.has(k)) edges.set(k, { a: ob.def.a, b: ob.def.b });
    } else if (ob.def.k === 'polygon') {
      const ids = ob.def.pts;
      const sp = ids.map((p) => pt(p));
      if (sp.some((p) => !p)) continue;
      polys.push({ id: ob.id, pts: ids });
      const sc = sp.map((p) => S(p!));
      const cen = { x: sc.reduce((s, p) => s + p.x, 0) / sc.length, y: sc.reduce((s, p) => s + p.y, 0) / sc.length };
      ids.forEach((a, i) => {
        const b = ids[(i + 1) % ids.length];
        const mid = G.mid(sc[i], sc[(i + 1) % ids.length]);
        edges.set(pairKey(a, b), { a, b, out: G.norm(G.sub(mid, cen)) });
      });
    }
  }

  const groups = new Map<string, { pos: Vec; dir: Vec }[]>();
  for (const [key, e] of edges) {
    const A = pt(e.a), B = pt(e.b);
    if (!A || !B) continue;
    const L = G.dist(A, B);
    if (L < 1e-9) continue;
    const sa = S(A), sb = S(B);
    const px = G.dist(sa, sb);
    const dir = G.norm(G.sub(sb, sa));
    const mid = G.mid(sa, sb);

    const gk = L.toFixed(6);
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push({ pos: mid, dir });

    if (o.lengths && !explicitLen.has(key) && px >= 44) {
      const text = o.unit ? `${G.fmt(L)} cm` : G.fmt(L);
      const w = estWidth(text);
      const nrm = G.perp(dir);
      let sign: number;
      if (e.out) sign = G.dot(nrm, e.out) >= 0 ? 1 : -1;
      else sign = nrm.y < -1e-6 ? 1 : nrm.y > 1e-6 ? -1 : nrm.x > 0 ? 1 : -1; // par défaut : au-dessus / à droite
      const off = 9 + Math.abs(nrm.x) * (w / 2) + Math.abs(nrm.y) * (LABEL_H / 2);
      m.labels.push({ kind: 'len', key: `len:${key}`, a: e.a, b: e.b, value: L, text, pos: G.add(mid, G.mul(nrm, sign * off)), w });
    }
  }
  if (o.marks) {
    let idx = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const n = (idx++ % 3) + 1;
      for (const t of list) m.ticks.push({ ...t, n });
    }
  }

  // ---------- angles aux sommets des polygones ----------
  if (o.angles || o.marks) {
    for (const poly of polys) {
      const P = poly.pts.map((p) => pt(p)!);
      let area = 0;
      P.forEach((p, i) => { area += G.cross(p, P[(i + 1) % P.length]); });
      const ccw = area > 0;
      P.forEach((V, i) => {
        const n = P.length;
        const prevId = poly.pts[(i - 1 + n) % n], nextId = poly.pts[(i + 1) % n], vId = poly.pts[i];
        if (explicitAng.has(`${vId}|${pairKey(prevId, nextId)}`)) return;
        const Pp = P[(i - 1 + n) % n], Pn = P[(i + 1) % n];
        const d1 = G.sub(Pn, V), d2 = G.sub(Pp, V);
        if (G.len(d1) < 1e-9 || G.len(d2) < 1e-9) return;
        // Angle intérieur : de la direction du suivant à celle du précédent (sens trigo si le polygone est direct).
        let rad = ccw ? Math.atan2(d2.y, d2.x) - Math.atan2(d1.y, d1.x) : Math.atan2(d1.y, d1.x) - Math.atan2(d2.y, d2.x);
        rad = ((rad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const deg = (rad * 180) / Math.PI;
        const sV = S(V), sN = S(Pn), sP = S(Pp);
        if (G.dist(sV, sN) < 40 || G.dist(sV, sP) < 40) return;
        const s1 = G.norm(G.sub(sN, sV)), s2 = G.norm(G.sub(sP, sV));

        if (Math.abs(deg - 90) < 0.05) {
          if (!o.marks) return;
          const k = 12;
          m.rights.push([G.add(sV, G.mul(s1, k)), G.add(sV, G.add(G.mul(s1, k), G.mul(s2, k))), G.add(sV, G.mul(s2, k))]);
          return;
        }
        if (!o.angles) return;
        const a1 = Math.atan2(s1.y, s1.x);
        let diff = Math.atan2(s2.y, s2.x) - a1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        const sweep = deg > 180 ? (diff > 0 ? diff - 2 * Math.PI : diff + 2 * Math.PI) : diff;
        const r = deg < 35 ? 34 : 24;
        m.arcs.push({ c: sV, r, a0: a1, sweep });
        const text = `${G.fmt(deg, 1)}°`;
        const w = estWidth(text);
        const mid = a1 + sweep / 2;
        const rr = r + 6 + w / 2 * Math.abs(Math.cos(mid)) + LABEL_H / 2 * Math.abs(Math.sin(mid));
        m.labels.push({
          kind: 'ang', key: `ang:${vId}`, p: prevId, v: vId, n: nextId, value: deg, text, w,
          pos: { x: sV.x + Math.cos(mid) * rr, y: sV.y + Math.sin(mid) * rr },
        });
      });
    }
  }
  return m;
}

/** Valeur écrite sous le curseur (coordonnées écran). */
export function hitMeasure(m: Measures, s: Vec): MLabel | null {
  for (const l of m.labels) {
    if (Math.abs(s.x - l.pos.x) <= l.w / 2 + 2 && Math.abs(s.y - l.pos.y) <= LABEL_H / 2 + 3) return l;
  }
  return null;
}

export function drawMeasures(ctx: CanvasRenderingContext2D, m: Measures, th: Theme, hover: string | null) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 0;

  ctx.strokeStyle = th.label;
  ctx.lineWidth = 1.6;
  for (const r of m.rights) {
    ctx.beginPath();
    r.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (const t of m.ticks) {
    const nrm = G.perp(t.dir);
    for (let i = 0; i < t.n; i++) {
      const c = G.add(t.pos, G.mul(t.dir, (i - (t.n - 1) / 2) * 5));
      ctx.beginPath();
      ctx.moveTo(c.x - nrm.x * 6, c.y - nrm.y * 6);
      ctx.lineTo(c.x + nrm.x * 6, c.y + nrm.y * 6);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = th.select;
  ctx.lineWidth = 1.6;
  for (const a of m.arcs) {
    ctx.beginPath();
    ctx.arc(a.c.x, a.c.y, a.r, a.a0, a.a0 + a.sweep, a.sweep < 0);
    ctx.stroke();
  }

  ctx.font = '600 13.5px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of m.labels) {
    const hot = hover === l.key;
    if (hot) {
      // Survol : la valeur apparaît comme un champ modifiable.
      ctx.fillStyle = th.bg;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.roundRect(l.pos.x - l.w / 2, l.pos.y - LABEL_H / 2 - 1, l.w, LABEL_H + 2, 9);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = th.select;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.lineWidth = 4;
      ctx.strokeStyle = th.bg;
      ctx.strokeText(l.text, l.pos.x, l.pos.y + 0.5);
    }
    ctx.fillStyle = l.kind === 'ang' ? th.select : th.label;
    ctx.fillText(l.text, l.pos.x, l.pos.y + 0.5);
  }
  ctx.restore();
}
