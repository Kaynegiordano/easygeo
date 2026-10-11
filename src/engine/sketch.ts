// Reconnaissance du dessin à main levée : un tracé → point, segment(s), polygone ou cercle exact.
// Tout se fait par calcul (pas d'IA) : simplification du tracé, ajustement de cercle,
// puis « embellissement » (accroche aux points existants, angles droits, horizontales/verticales, grille).
import type { Construction } from './construction';
import type { Viewport } from './render';
import * as G from './geom';
import type { Vec } from './geom';

export type Shape =
  | { kind: 'point'; p: Vec }
  | { kind: 'poly'; pts: Vec[]; closed: boolean }
  | { kind: 'circle'; c: Vec; r: number };

/** Douglas-Peucker. */
function rdp(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const l: G.LineC = { p: a, d: G.sub(b, a), tmin: 0, tmax: 1 };
  let best = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = G.len(G.sub(b, a)) < 1e-9 ? G.dist(pts[i], a) : G.distToLine(l, pts[i]);
    if (d > best) { best = d; idx = i; }
  }
  if (best <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/** Ajustement de cercle par moindres carrés (méthode de Kåsa). */
function fitCircle(pts: Vec[]): { c: Vec; r: number; rms: number } | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  // Résout [sxx sxy sx; sxy syy sy; sx sy n] · [A B C] = [sxz syz sz]
  const M = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    [M[i], M[piv]] = [M[piv], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = M[k][i] / M[i][i];
      for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j];
    }
  }
  const A = M[0][3] / M[0][0], B = M[1][3] / M[1][1], C = M[2][3] / M[2][2];
  const c = { x: A / 2, y: B / 2 };
  const r = Math.sqrt(C + c.x * c.x + c.y * c.y);
  if (!Number.isFinite(r)) return null;
  const rms = Math.sqrt(pts.reduce((s, p) => s + (G.dist(p, c) - r) ** 2, 0) / n);
  return { c, r, rms };
}

/** Angle au point b (en degrés, 0–180). */
const angleAt = (a: Vec, b: Vec, c: Vec) => G.angleDeg(a, b, c);

export type ShapeKind = 'line' | 'poly' | 'circle';

/** Longueur du tracé. */
const pathLength = (s: Vec[]) => s.reduce((t, p, i) => (i ? t + G.dist(s[i - 1], p) : 0), 0);

/** Écart maximal du tracé à la corde premier→dernier point, rapporté à sa longueur. */
function straightness(s: Vec[]) {
  const a = s[0], b = s[s.length - 1];
  const L = G.dist(a, b);
  if (L < 1) return Infinity;
  const l: G.LineC = { p: a, d: G.sub(b, a), tmin: -Infinity, tmax: Infinity };
  return Math.max(...s.map((p) => G.distToLine(l, p))) / L;
}

/**
 * Indice où un tracé revient près de son point de départ (après en être parti), ou -1.
 * Permet de reconnaître une forme fermée même quand le trait dépasse son départ.
 */
function returnIndex(s: Vec[], diag: number) {
  const tol = Math.max(24, 0.22 * diag);
  let best = -1, bd = tol;
  for (let i = Math.floor(s.length * 0.6); i < s.length; i++) {
    const d = G.dist(s[i], s[0]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Simplifie un tracé fermé en sommets, en retirant les sommets « plats ». */
function closedVertices(stroke: Vec[], diag: number) {
  // On démarre la simplification sur le point le plus éloigné du centre (un coin),
  // pour que la « couture » début/fin ne crée pas de faux sommet.
  const cx = stroke.reduce((s, p) => s + p.x, 0) / stroke.length, cy = stroke.reduce((s, p) => s + p.y, 0) / stroke.length;
  let k = 0;
  stroke.forEach((p, i) => { if (G.dist(p, { x: cx, y: cy }) > G.dist(stroke[k], { x: cx, y: cy })) k = i; });
  const loop = [...stroke.slice(k), ...stroke.slice(0, k), stroke[k]];
  let poly = rdp(loop, Math.max(7, 0.06 * diag)).slice(0, -1);
  for (let changed = true; changed && poly.length > 3;) {
    changed = false;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i - 1 + poly.length) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length];
      if (angleAt(a, b, c) > 150 || G.dist(a, b) < 0.08 * diag) { poly.splice(i, 1); changed = true; break; }
    }
  }
  // Coin arrondi coupé en deux sommets obtus (« chanfrein ») : on les remplace par
  // l'intersection des deux côtés voisins, qui est le vrai coin voulu.
  for (let changed = true; changed && poly.length > 3;) {
    changed = false;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p0 = poly[(i - 1 + n) % n], a = poly[i], b = poly[(i + 1) % n], p3 = poly[(i + 2) % n];
      const ratio = G.dist(a, b) / Math.max(G.dist(p0, a), G.dist(b, p3));
      const angA = angleAt(p0, a, b), angB = angleAt(a, b, p3);
      // Côté très court entre deux angles obtus, ou un peu plus long si l'un des deux est presque plat.
      const chamfer = (ratio < 0.3 && angA > 95 && angB > 95) || (ratio < 0.42 && Math.min(angA, angB) > 95 && Math.max(angA, angB) > 135);
      if (chamfer) {
        const x = G.lineLine({ p: p0, d: G.sub(a, p0), tmin: -Infinity, tmax: Infinity }, { p: p3, d: G.sub(b, p3), tmin: -Infinity, tmax: Infinity });
        if (!x) continue;
        poly.splice(i, 1, x);
        poly.splice((i + 1) % poly.length, 1);
        changed = true;
        break;
      }
    }
  }
  return poly;
}

/**
 * Reconnaît la forme d'un tracé (coordonnées écran).
 * `force` impose un type (bouton « C'était plutôt… »).
 */
export function recognize(stroke: Vec[], force?: ShapeKind): Shape {
  const xs = stroke.map((p) => p.x), ys = stroke.map((p) => p.y);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!force && (stroke.length < 4 || diag < 12)) {
    const n = stroke.length;
    return { kind: 'point', p: { x: xs.reduce((a, b) => a + b) / n, y: ys.reduce((a, b) => a + b) / n } };
  }
  const first = stroke[0], last = stroke[stroke.length - 1];
  const fit = fitCircle(stroke);

  if (force === 'line') return { kind: 'poly', pts: [first, last], closed: false };
  if (force === 'circle' && fit) return { kind: 'circle', c: fit.c, r: fit.r };

  // Un trait presque droit est un segment, même s'il tremble.
  if (!force && straightness(stroke) < 0.07) return { kind: 'poly', pts: [first, last], closed: false };

  const gap = G.dist(first, last);
  const ret = returnIndex(stroke, diag);
  const len = pathLength(stroke);
  const closed = gap < Math.max(24, 0.22 * diag) || (ret > 0 && len > 1.9 * diag)
    || (gap < 0.35 * diag && len > 1.8 * diag) || (force === 'poly' && gap < 0.35 * diag);

  if (closed) {
    // Si le trait dépasse son point de départ, on coupe au point de retour.
    const loop = ret > 0 ? stroke.slice(0, ret + 1) : stroke;
    const poly = closedVertices(loop, diag);
    const loopFit = fitCircle(loop) ?? fit;
    if (force === 'poly' && poly.length >= 3) return { kind: 'poly', pts: poly, closed: true };
    const score = loopFit ? loopFit.rms / loopFit.r : Infinity;
    // Coins francs ? (changement de direction marqué). Avec beaucoup de sommets, il en faut de plus nets.
    const limit = poly.length >= 6 ? 100 : poly.length === 5 ? 116 : 130;
    const sharp = poly.some((b, i) => angleAt(poly[(i - 1 + poly.length) % poly.length], b, poly[(i + 1) % poly.length]) < limit);
    // Au collège, un tracé fermé à 7 « sommets » ou plus est presque toujours un cercle (ou un ovale).
    if (loopFit && (score < 0.055 || poly.length < 3 || (!sharp && score < 0.2) || (poly.length >= 7 && score < 0.25))) {
      return { kind: 'circle', c: loopFit.c, r: loopFit.r };
    }
    return { kind: 'poly', pts: poly, closed: true };
  }

  let poly = rdp(stroke, Math.max(7, 0.06 * diag));
  for (let i = poly.length - 2; i >= 1; i--) if (angleAt(poly[i - 1], poly[i], poly[i + 1]) > 155) poly.splice(i, 1);
  if (poly.length < 2) poly = [first, last];
  return { kind: 'poly', pts: poly, closed: false };
}

/** Autres interprétations possibles d'une forme, pour les boutons « C'était plutôt… ». */
export function alternatives(shape: Shape): { kind: ShapeKind; label: string }[] {
  const all: { kind: ShapeKind; label: string }[] = [
    { kind: 'line', label: 'un trait' },
    { kind: 'poly', label: 'un polygone' },
    { kind: 'circle', label: 'un cercle' },
  ];
  if (shape.kind === 'point') return [];
  if (shape.kind === 'circle') return all.filter((a) => a.kind !== 'circle');
  const isLine = !shape.closed && shape.pts.length === 2;
  return all.filter((a) => (isLine ? a.kind !== 'line' : a.kind !== 'poly'));
}

interface Vertex { w: Vec; id?: string; host?: string }

/**
 * Transforme la forme reconnue en objets exacts dans la construction.
 * Renvoie un court résumé pour l'utilisateur.
 */
export function applyShape(c: Construction, vp: Viewport, shape: Shape, snap: boolean): string {
  const S = vp.toScreen, W = vp.toWorld;
  const gridStep = vp.gridStep() / 2;
  const points = c.objects.filter((o) => o.type === 'point' && o.visible && c.comp(o.id)?.pt);

  /** Point existant le plus proche (en pixels). */
  const nearestPoint = (s: Vec, tol: number) => {
    let best: string | undefined, bd = tol;
    for (const o of points) {
      const d = G.dist(S(c.comp(o.id)!.pt!), s);
      if (d < bd) { bd = d; best = o.id; }
    }
    return best;
  };
  /** Ligne ou cercle existant passant près du point (pour un point « sur » l'objet). */
  const nearestHost = (w: Vec) => {
    const tol = 9 / vp.view.scale;
    for (const o of c.objects) {
      if (!o.visible) continue;
      const k = c.comp(o.id);
      if (k?.line && G.distToLine(k.line, w) < tol) return o.id;
      if (k?.circle && Math.abs(G.dist(w, k.circle.c) - k.circle.r) < tol) return o.id;
    }
    return undefined;
  };
  const gridSnap = (w: Vec): Vec => {
    const q = { x: Math.round(w.x / gridStep) * gridStep, y: Math.round(w.y / gridStep) * gridStep };
    return G.dist(S(q), S(w)) < 14 ? q : w;
  };
  const makePoint = (v: Vertex): string => {
    if (v.id) return v.id;
    if (v.host) {
      const k = c.comp(v.host)!;
      const t = k.line ? G.projT(k.line, v.w) : Math.atan2(v.w.y - k.circle!.c.y, v.w.x - k.circle!.c.x);
      return (v.id = c.add({ k: 'on', o: v.host, t }));
    }
    return (v.id = c.add({ k: 'free', x: v.w.x, y: v.w.y }));
  };

  // ---------- point ----------
  if (shape.kind === 'point') {
    const ex = nearestPoint(shape.p, 14);
    if (ex) return `Point ${c.nameOf(ex)} existant`;
    const w = W(shape.p);
    const host = nearestHost(w);
    const id = makePoint({ w: snap && !host ? gridSnap(w) : w, host });
    return `Point ${c.nameOf(id)}`;
  }

  // ---------- cercle ----------
  if (shape.kind === 'circle') {
    const cs = shape.c, rpx = shape.r;
    const centerId = nearestPoint(cs, Math.max(16, rpx * 0.25));
    const center = centerId ? c.comp(centerId)!.pt! : snap ? gridSnap(W(cs)) : W(cs);
    let r = rpx / vp.view.scale;
    // Un point existant sur le cercle ? → cercle passant par ce point.
    const through = points.find((o) => o.id !== centerId && Math.abs(G.dist(S(c.comp(o.id)!.pt!), S(center)) - rpx) < 12);
    const cid = centerId ?? c.add({ k: 'free', x: center.x, y: center.y });
    if (through) {
      c.add({ k: 'circle2', c: cid, p: through.id });
      return `Cercle de centre ${c.nameOf(cid)} passant par ${through.name}`;
    }
    const step = snap ? gridStep : 0.1;
    r = Math.max(step, Math.round(r / step) * step);
    c.add({ k: 'circleR', c: cid, r: String(+r.toFixed(4)) });
    return `Cercle de centre ${c.nameOf(cid)} et de rayon ${G.fmt(r)}`;
  }

  // ---------- segments / polygone ----------
  const verts: Vertex[] = shape.pts.map((s) => {
    const id = nearestPoint(s, 18);
    if (id) return { w: c.comp(id)!.pt!, id };
    const w = W(s);
    return { w, host: nearestHost(w) };
  });
  // Deux sommets voisins accrochés au même point existant → fusion
  for (let i = verts.length - 1; i > 0; i--) if (verts[i].id && verts[i].id === verts[i - 1].id) verts.splice(i, 1);
  if (shape.closed && verts.length > 1 && verts[0].id && verts[0].id === verts[verts.length - 1].id) verts.pop();

  const n = verts.length;
  const free = (i: number) => !verts[i].id && !verts[i].host;
  const edges: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  if (shape.closed && n >= 3) edges.push([n - 1, 0]);

  // Contraintes détectées : arêtes horizontales/verticales, angles droits.
  const horiz: [number, number][] = [], vert: [number, number][] = [], right: [number, number, number][] = [];
  for (const [a, b] of edges) {
    const d = G.sub(verts[b].w, verts[a].w);
    const ang = Math.abs((Math.atan2(d.y, d.x) * 180) / Math.PI);
    if (ang < 7 || ang > 173) horiz.push([a, b]);
    else if (Math.abs(ang - 90) < 7) vert.push([a, b]);
  }
  const corners = shape.closed ? [...Array(n).keys()] : [...Array(Math.max(0, n - 2)).keys()].map((i) => i + 1);
  for (const i of corners) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    if (n >= 3 && Math.abs(angleAt(verts[a].w, verts[i].w, verts[b].w) - 90) < 11) right.push([a, i, b]);
  }

  // Relaxation itérative : on ne déplace que les sommets libres.
  const orig = verts.map((v) => v.w);
  for (let it = 0; it < 80; it++) {
    for (const [a, b] of horiz) {
      if (free(a) && free(b)) { const y = (verts[a].w.y + verts[b].w.y) / 2; verts[a].w = { ...verts[a].w, y }; verts[b].w = { ...verts[b].w, y }; }
      else if (free(a)) verts[a].w = { ...verts[a].w, y: verts[b].w.y };
      else if (free(b)) verts[b].w = { ...verts[b].w, y: verts[a].w.y };
    }
    for (const [a, b] of vert) {
      if (free(a) && free(b)) { const x = (verts[a].w.x + verts[b].w.x) / 2; verts[a].w = { ...verts[a].w, x }; verts[b].w = { ...verts[b].w, x }; }
      else if (free(a)) verts[a].w = { ...verts[a].w, x: verts[b].w.x };
      else if (free(b)) verts[b].w = { ...verts[b].w, x: verts[a].w.x };
    }
    for (const [a, v, b] of right) {
      const A = verts[a].w, V = verts[v].w, B = verts[b].w;
      if (free(a) || free(b)) {
        // Correction symétrique : l'écart à 90° est réparti entre les deux côtés (rotation autour
        // du sommet). Corriger un seul côté fait dériver la figure quand un autre côté est incliné.
        const va = G.sub(A, V), vb = G.sub(B, V);
        const s = Math.atan2(G.cross(va, vb), G.dot(va, vb));
        const err = (Math.sign(s) || 1) * (Math.PI / 2) - s;
        const rot = (p: Vec, k: number): Vec => G.add(V, G.rotate(G.sub(p, V), { x: 0, y: 0 }, (k * 180) / Math.PI));
        if (free(a) && free(b)) { verts[a].w = rot(A, -err / 2); verts[b].w = rot(B, err / 2); }
        else if (free(b)) verts[b].w = rot(B, err);
        else verts[a].w = rot(A, -err);
      } else if (free(v)) {
        // V sur le cercle de diamètre [AB] (théorème du cercle circonscrit !)
        const m = G.mid(A, B), r = G.dist(A, B) / 2;
        verts[v].w = G.add(m, G.mul(G.norm(G.sub(V, m)), r));
      }
    }
  }
  // Garde-fou : si la relaxation a éloigné un sommet de façon anormale, on garde le tracé reconnu.
  {
    const span = Math.max(...orig.map((p) => Math.max(...orig.map((q) => G.dist(p, q)))));
    if (verts.some((v, i) => free(i) && G.dist(v.w, orig[i]) > 0.3 * span)) verts.forEach((v, i) => { if (free(i)) v.w = orig[i]; });
  }

  // Aimantation à la grille, annulée si elle casse un angle droit.
  if (snap) {
    const before = verts.map((v) => v.w);
    verts.forEach((v, i) => { if (free(i)) v.w = gridSnap(v.w); });
    const broken = right.some(([a, v, b]) => Math.abs(angleAt(verts[a].w, verts[v].w, verts[b].w) - 90) > 0.01);
    if (broken) verts.forEach((v, i) => { v.w = before[i]; });
  }

  // Trait seul oblique : direction arrondie à 15° près, longueur arrondie au demi-carreau.
  if (snap && !shape.closed && verts.length === 2 && !horiz.length && !vert.length) {
    const [i, j] = free(1) ? [0, 1] : free(0) ? [1, 0] : [-1, -1];
    if (i >= 0) {
      const A = verts[i].w, B = verts[j].w;
      let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
      const round15 = Math.round(ang / 15) * 15;
      if (Math.abs(ang - round15) < 4) ang = round15;
      const L = Math.max(gridStep, Math.round(G.dist(A, B) / gridStep) * gridStep);
      const r = (ang * Math.PI) / 180;
      verts[j].w = G.add(A, G.v(L * Math.cos(r), L * Math.sin(r)));
    }
  }

  const ids = verts.map(makePoint);
  const names = ids.map((id) => c.nameOf(id)).join('');
  const extra = right.length ? ` (angle${right.length > 1 ? 's' : ''} droit${right.length > 1 ? 's' : ''} en ${right.map(([, v]) => c.nameOf(ids[v])).join(', ')})` : '';

  if (shape.closed && ids.length >= 3) {
    // Les angles droits d'un polygone s'affichent d'eux-mêmes (petit carré) : pas d'objet « angle » en double.
    c.add({ k: 'polygon', pts: ids });
    const label = ids.length === 3 ? 'Triangle' : ids.length === 4 ? 'Quadrilatère' : 'Polygone';
    return `${label} ${names}${extra}`;
  }
  for (const [a, b] of edges) if (ids[a] !== ids[b]) c.add({ k: 'segment', a: ids[a], b: ids[b] });
  for (const [a, v, b] of right) c.add({ k: 'angle', a: ids[a], b: ids[v], c: ids[b] });
  return ids.length === 2 ? `Segment [${names}]` : `Ligne brisée ${names}${extra}`;
}
