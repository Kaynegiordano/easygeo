// Zone de dessin : rendu, outils à la souris, déplacement, zoom.
import { useEffect, useRef } from 'react';
import type { Construction } from './engine/construction';
import { draw, hitName, hitTest, nameBox, type Theme, type Viewport } from './engine/render';
import { accepts, type Tool } from './engine/tools';
import * as G from './engine/geom';
import { applyShape, recognize, type Shape } from './engine/sketch';
import { nearestEdge } from './engine/edit';
import { lockedPointIds, moveFreePoint } from './engine/solve';
import type { PickInfo } from './ContextMenu';
import { collectMeasures, hitMeasure, type MeasureOpts, type MLabel } from './engine/labels';
import type { Vec } from './engine/geom';

interface Props {
  c: Construction;
  vp: Viewport;
  tool: Tool;
  grid: boolean;
  axes: boolean;
  snap: boolean;
  theme: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Sauvegarde l'état dans l'historique avant une modification. */
  commit: () => void;
  onAsk: (tool: Tool, ids: string[]) => void;
  onPending: (n: number) => void;
  onError: (msg: string) => void;
  /** Incrémenté par le parent pour annuler la sélection en cours (Échap). */
  cancelToken: number;
  /** Mesures écrites sur la figure. */
  measures: MeasureOpts;
  /** Clic sur une valeur écrite sur la figure (longueur, angle) : la modifier. */
  onEditLabel: (label: MLabel, client: Vec) => void;
  /** Clic sur le nom d'un point : le renommer. */
  onEditName: (id: string, client: Vec) => void;
  /** Mode « choisis un côté » (pour « même longueur que… ») : reçoit le côté cliqué, ou null. */
  edgePick: ((edge: [string, string] | null) => void) | null;
  /** Clic droit sans glisser. */
  onContext: (info: PickInfo) => void;
  /** Double-clic sur un objet. */
  onEdit: (info: PickInfo) => void;
  /** Résultat d'un tracé à main levée (pour proposer d'autres interprétations). */
  onSketch: (summary: string, stroke: Vec[], shape: Shape) => void;
  /** Objets à ne pas encore montrer (rejeu de la construction). */
  hiddenIds?: Set<string>;
  /** Figure en lecture seule (rejeu). */
  frozen?: boolean;
}

type Drag =
  | { kind: 'pan'; last: Vec; start: Vec; moved: boolean; right: boolean }
  | { kind: 'point'; id: string; moved: boolean }
  | { kind: 'group'; ids: string[]; start: Vec; orig: Vec[]; moved: boolean }
  | { kind: 'ink'; pts: Vec[]; lab: MLabel | null; name: string | null }
  | { kind: 'label'; lab: MLabel; start: Vec }
  /** Nom d'un point : un clic le modifie, un glissement le déplace. */
  | { kind: 'name'; id: string; grab: Vec; start: Vec; moved: boolean };

function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return { bg: v('--canvas'), grid: v('--grid'), gridMajor: v('--grid-major'), axis: v('--axis'), text: v('--muted'), label: v('--text'), select: v('--accent') };
}

export function CanvasView(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef(p);
  props.current = p;
  const st = useRef({
    pending: [] as string[],
    committed: false,
    drag: null as Drag | null,
    hover: null as string | null,
    hoverLabel: null as string | null,
    hoverName: null as string | null,
    /** Dernier clic (coordonnées monde). */
    lastAt: null as Vec | null,
    mouse: null as Vec | null,
    theme: readTheme(),
    raf: 0,
    /** Objets créés par le dernier tracé, et quand. */
    fresh: [] as string[],
    freshAt: 0,
  });

  const requestDraw = () => {
    if (st.current.raf) return;
    st.current.raf = requestAnimationFrame(() => {
      st.current.raf = 0;
      paint();
    });
  };

  const paint = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const { c, vp, tool, grid, axes, selected } = props.current;
    const s = st.current;
    const dpr = window.devicePixelRatio || 1;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, c, vp, s.theme, {
      grid, axes,
      selected: new Set(selected ? [selected] : []),
      pending: new Set(s.pending),
      hover: s.hover,
      measures: collectMeasures(c, vp, props.current.measures),
      hoverLabel: s.hoverLabel,
      hoverName: s.hoverName,
      hiddenIds: props.current.hiddenIds,
      preview: s.mouse ? (cx) => preview(cx, c, vp, tool, s.pending, s.mouse!, s.theme) : undefined,
    });
    // Encre du tracé à main levée en cours
    if (s.drag?.kind === 'ink' && s.drag.pts.length > 1) {
      ctx.strokeStyle = s.theme.select;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      s.drag.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Longueur en direct (du départ au crayon), pour viser une mesure
      const a = s.drag.pts[0], b = s.drag.pts[s.drag.pts.length - 1];
      const L = G.dist(a, b) / vp.view.scale;
      if (G.dist(a, b) > 25) {
        const text = `≈ ${G.fmt(Math.round(L * 2) / 2, 1)}`;
        ctx.font = '600 13px Inter, system-ui, sans-serif';
        const w = ctx.measureText(text).width + 14;
        ctx.fillStyle = s.theme.select;
        ctx.beginPath();
        ctx.roundRect(b.x + 14, b.y + 10, w, 22, 11);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(text, b.x + 21, b.y + 21.5);
      }
    }
  };

  /** Ce qui se trouve sous un point écran (objet et éventuel côté de polygone). */
  const pick = (e: { clientX: number; clientY: number }): PickInfo => {
    const { c, vp } = props.current;
    const s = local(e);
    const w = vp.toWorld(s);
    const hits = hitTest(c, vp, s);
    let hit = hits[0] ?? null;
    let edge: [string, string] | undefined;
    // Un point est prioritaire ; sinon on regarde si un côté de polygone est tout près.
    if (!hit || c.get(hit)?.type !== 'point') {
      const tol = 8 / vp.view.scale;
      for (const o of c.objects) {
        if (o.def.k !== 'polygon' || !o.visible) continue;
        const ed = nearestEdge(c, o.id, w, tol);
        if (ed && (!hit || c.get(hit)?.type === 'polygon')) { edge = ed; hit = o.id; break; }
      }
    }
    const label = hitMeasure(collectMeasures(c, vp, props.current.measures), s) ?? undefined;
    return { client: { x: e.clientX, y: e.clientY }, world: w, hit, edge, label };
  };

  // Redessine à chaque changement de figure, de réglage ou de thème.
  useEffect(() => { const off = p.c.subscribe(requestDraw); return () => { off(); }; }, [p.c]);
  useEffect(() => { st.current.theme = readTheme(); requestDraw(); }, [p.theme]);
  useEffect(requestDraw, [p.grid, p.axes, p.selected, p.measures, p.hiddenIds]);
  useEffect(() => {
    st.current.pending = [];
    st.current.committed = false;
    p.onPending(0);
    requestDraw();
  }, [p.tool, p.cancelToken]);

  // Taille du canvas = taille de son conteneur (en pixels physiques).
  useEffect(() => {
    const cv = canvasRef.current!;
    const fit = () => {
      const r = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      p.vp.w = r.width;
      p.vp.h = r.height;
      paint();
    };
    // Taille lue tout de suite (l'observateur ne se déclenche pas si la fenêtre démarre réduite).
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Aimantation : accroche au nœud de grille le plus proche s'il est à moins de 10 px. */
  const snapWorld = (w: Vec, force = false): Vec => {
    const { vp, snap } = props.current;
    if (!snap && !force) return w;
    const step = vp.gridStep() / 2;
    const q = { x: Math.round(w.x / step) * step, y: Math.round(w.y / step) * step };
    return G.dist(vp.toScreen(q), vp.toScreen(w)) < 10 ? q : w;
  };

  const needNow = () => {
    const { tool } = props.current;
    if (tool.steps === 'polygon') return 'point' as const;
    return tool.steps[st.current.pending.length];
  };

  const commitOnce = () => {
    if (!st.current.committed) { props.current.commit(); st.current.committed = true; }
  };

  /** Crée un point au clic : sur l'objet survolé (point mobile) ou libre. */
  const createPoint = (s: Vec, hits: string[]): string => {
    const { c, vp } = props.current;
    commitOnce();
    const w = vp.toWorld(s);
    const host = hits.find((h) => ['line', 'circle', 'function'].includes(c.get(h)!.type));
    let id: string;
    if (host) {
      const k = c.comp(host)!;
      const t = k.line ? Math.min(k.line.tmax, Math.max(k.line.tmin, G.projT(k.line, w)))
        : k.circle ? Math.atan2(w.y - k.circle.c.y, w.x - k.circle.c.x) : w.x;
      id = c.add({ k: 'on', o: host, t });
    } else {
      const q = snapWorld(w);
      id = c.add({ k: 'free', x: q.x, y: q.y });
    }
    c.changed();
    return id;
  };

  const finish = (ids: string[]) => {
    const { c, tool, onAsk, onError } = props.current;
    st.current.pending = [];
    props.current.onPending(0);
    if (tool.ask) {
      onAsk(tool, ids);
    } else if (tool.run) {
      commitOnce();
      try { tool.run(c, ids, undefined, st.current.lastAt ?? undefined); } catch (e) { onError((e as Error).message); }
      c.changed();
    }
    st.current.committed = false;
    requestDraw();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const cv = canvasRef.current!;
    cv.setPointerCapture(e.pointerId);
    const { c, vp, tool, onSelect, onError } = props.current;
    const s = local(e);
    const hits = hitTest(c, vp, s);
    const S = st.current;
    if (props.current.frozen) return;
    S.lastAt = vp.toWorld(s);

    // Mode « choisis un côté » : le prochain clic désigne un segment ou un côté de polygone.
    if (props.current.edgePick && e.button === 0) {
      const info = pick(e);
      const o = info.hit ? c.get(info.hit) : undefined;
      const seg: [string, string] | undefined = info.edge ?? (o?.def.k === 'segment' ? [o.def.a, o.def.b] : undefined);
      props.current.edgePick(seg ?? null);
      return;
    }
    // Clic droit : menu s'il n'y a pas de glissement (décidé au relâchement) ; sinon déplacement de la vue.
    if (e.button === 1 || e.button === 2) { S.drag = { kind: 'pan', last: s, start: s, moved: false, right: e.button === 2 }; return; }

    // Une valeur écrite sur la figure se modifie d'un clic (avec Déplacer ou Main levée).
    const lab = tool.id === 'move' || tool.id === 'freehand' ? hitMeasure(collectMeasures(c, vp, props.current.measures), s) : null;

    // Le nom d'un point (s'il n'y a pas de point juste dessous) : clic = renommer, glissement = déplacer.
    const onPoint = hits.some((h) => c.get(h)?.type === 'point');
    const nameId = (tool.id === 'move' || tool.id === 'freehand') && !onPoint && !lab ? hitName(c, vp, s) : null;

    if (tool.id === 'move') {
      if (lab) { S.drag = { kind: 'label', lab, start: s }; return; }
      if (nameId) {
        const nb = nameBox(c, vp, c.get(nameId)!)!;
        S.drag = { kind: 'name', id: nameId, grab: { x: nb.cx - s.x, y: nb.cy - s.y }, start: s, moved: false };
        onSelect(nameId);
        return;
      }
      const h = hits[0];
      onSelect(h ?? null);
      const o = h ? c.get(h) : undefined;
      if (o && (o.def.k === 'free' || o.def.k === 'on')) S.drag = { kind: 'point', id: o.id, moved: false };
      else if (o && c.freeHandles(o.id).length) {
        const ids = c.freeHandles(o.id);
        S.drag = { kind: 'group', ids, start: vp.toWorld(s), orig: ids.map((id) => ({ ...c.comp(id)!.pt! })), moved: false };
      } else S.drag = { kind: 'pan', last: s, start: s, moved: false, right: false };
      return;
    }

    if (tool.id === 'freehand') { S.drag = { kind: 'ink', pts: [s], lab, name: nameId }; requestDraw(); return; }

    if (tool.id === 'delete') {
      if (hits[0]) { props.current.commit(); c.remove(hits[0]); c.changed(); onSelect(null); }
      return;
    }

    const need = needNow();
    if (!need) return;
    let id = hits.find((h) => accepts(c, need, h));
    if (tool.steps === 'polygon' && id && id === S.pending[0] && S.pending.length >= 3) { finish([...S.pending]); return; }
    if (!id && need === 'point') id = createPoint(s, hits);
    if (!id) {
      onError(need === 'line' ? 'Clique sur une droite, un segment ou une demi-droite.'
        : need === 'curve' ? 'Clique sur une droite, un cercle ou une courbe.' : 'Clique sur un objet de la figure.');
      return;
    }
    if (S.pending.includes(id) && tool.steps !== 'polygon') return;
    S.pending.push(id);
    props.current.onPending(S.pending.length);
    if (tool.steps !== 'polygon' && S.pending.length >= tool.steps.length) finish([...S.pending]);
    requestDraw();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { c, vp, tool } = props.current;
    const s = local(e);
    const S = st.current;
    S.mouse = vp.toWorld(s);
    const d = S.drag;

    if (d?.kind === 'name') {
      if (!d.moved && G.dist(s, d.start) <= 4) return;
      if (!d.moved) { props.current.commit(); d.moved = true; }
      const P = c.comp(d.id)?.pt;
      if (P) {
        const ps = vp.toScreen(P);
        c.get(d.id)!.labelOff = { x: Math.round(s.x + d.grab.x - ps.x), y: Math.round(s.y + d.grab.y - ps.y) };
      }
      c.changed();
      return;
    }
    if (d?.kind === 'label') {
      // Un glissement sur une valeur ne la modifie pas : on déplace la vue.
      if (G.dist(s, d.start) > 5) S.drag = { kind: 'pan', last: d.start, start: d.start, moved: true, right: false };
    } else if (d?.kind === 'ink') {
      // Événements groupés par le navigateur : tracé plus fidèle quand on dessine vite.
      const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []).map(local);
      for (const q of evs.length ? evs : [s]) {
        if (G.dist(d.pts[d.pts.length - 1], q) >= 1.5) d.pts.push(q);
      }
    } else if (d?.kind === 'pan') {
      if (G.dist(s, d.start) > 4) d.moved = true;
      vp.view.ox -= (s.x - d.last.x) / vp.view.scale;
      vp.view.oy += (s.y - d.last.y) / vp.view.scale;
      d.last = s;
    } else if (d?.kind === 'point') {
      if (!d.moved) { props.current.commit(); d.moved = true; }
      const o = c.get(d.id)!;
      const w = vp.toWorld(s);
      if (o.def.k === 'free') {
        // Un point soumis à des mesures imposées suit la souris sans aimantation ; les autres s'adaptent.
        const bound = lockedPointIds(c).includes(o.id);
        const q = e.shiftKey || bound ? w : snapWorld(w);
        moveFreePoint(c, o.id, q);
      } else if (o.def.k === 'on') {
        const k = c.comp(o.def.o);
        if (k?.line) o.def.t = G.projT(k.line, w);
        else if (k?.circle) o.def.t = Math.atan2(w.y - k.circle.c.y, w.x - k.circle.c.x);
        else if (k?.fn) o.def.t = w.x;
      }
      c.changed();
      return;
    } else if (d?.kind === 'group') {
      if (!d.moved) { props.current.commit(); d.moved = true; }
      const w = vp.toWorld(s);
      let delta = G.sub(w, d.start);
      if (props.current.snap && !e.shiftKey) {
        // aimante le premier point, les autres suivent
        const q = snapWorld(G.add(d.orig[0], delta));
        delta = G.sub(q, d.orig[0]);
      }
      d.ids.forEach((id, i) => {
        const def = c.get(id)!.def;
        if (def.k === 'free') { def.x = d.orig[i].x + delta.x; def.y = d.orig[i].y + delta.y; }
      });
      c.changed();
      return;
    } else {
      const hits = hitTest(c, vp, s);
      const need = tool.id === 'move' || tool.id === 'delete' || tool.id === 'freehand' ? null : needNow();
      const h = need ? hits.find((x) => accepts(c, need, x)) ?? null : hits[0] ?? null;
      S.hover = h;
      const lab = tool.id === 'move' || tool.id === 'freehand' ? hitMeasure(collectMeasures(c, vp, props.current.measures), s) : null;
      S.hoverLabel = lab?.key ?? null;
      const nm = (tool.id === 'move' || tool.id === 'freehand') && !lab && !hits.some((x) => c.get(x)?.type === 'point') ? hitName(c, vp, s) : null;
      S.hoverName = nm;
      canvasRef.current!.style.cursor = props.current.edgePick ? 'crosshair' : lab || nm ? 'text' : tool.id === 'move' ? (h ? 'grab' : 'default') : tool.id === 'delete' ? (h ? 'pointer' : 'default') : 'crosshair';
    }
    requestDraw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = st.current.drag;
    st.current.drag = null;
    if (d?.kind === 'pan' && d.right && !d.moved) { props.current.onContext(pick(e)); return; }
    if (d?.kind === 'label') { props.current.onEditLabel(d.lab, { x: e.clientX, y: e.clientY }); return; }
    if (d?.kind === 'name') { if (!d.moved) props.current.onEditName(d.id, { x: e.clientX, y: e.clientY }); requestDraw(); return; }
    if (d?.kind === 'ink') {
      const { c, vp, snap, commit, onError, onSketch } = props.current;
      const shape = recognize(d.pts);
      // Simple tap sur une valeur écrite : on la modifie au lieu de créer un point.
      if (d.lab && shape.kind === 'point') { props.current.onEditLabel(d.lab, { x: e.clientX, y: e.clientY }); requestDraw(); return; }
      if (d.name && shape.kind === 'point') { props.current.onEditName(d.name, { x: e.clientX, y: e.clientY }); requestDraw(); return; }
      // Un simple « tap » sur un objet existant ne crée rien (il sert au double-clic).
      if (shape.kind === 'point' && pick(e).hit) { requestDraw(); return; }
      commit();
      try {
        const before = new Set(c.objects.map((o) => o.id));
        const summary = applyShape(c, vp, shape, snap);
        st.current.fresh = shape.kind === 'point' ? c.objects.filter((o) => !before.has(o.id)).map((o) => o.id) : [];
        st.current.freshAt = Date.now();
        onSketch(summary, d.pts, shape);
      } catch (err) { onError((err as Error).message); }
      c.changed();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { tool, onEdit } = props.current;
    if (tool.id !== 'move' && tool.id !== 'freehand') return;
    const info = pick(e);
    // Ignore l'objet que le premier clic vient tout juste de créer.
    if (info.hit && st.current.fresh.includes(info.hit) && Date.now() - st.current.freshAt < 700) return;
    if (info.hit) onEdit(info);
  };

  const onWheel = (e: React.WheelEvent) => {
    props.current.vp.zoomAt(local(e), Math.exp(-e.deltaY * 0.0015));
    requestDraw();
  };

  const onLeave = () => { st.current.mouse = null; st.current.hover = null; st.current.hoverLabel = null; st.current.hoverName = null; requestDraw(); };

  return (
    <canvas
      ref={canvasRef}
      className="board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onLeave}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** Aperçu fantôme de l'objet en cours de construction. */
function preview(ctx: CanvasRenderingContext2D, c: Construction, vp: Viewport, tool: Tool, pending: string[], mouse: Vec, th: Theme) {
  if (!pending.length) return;
  const S = vp.toScreen;
  const P = (id: string) => c.comp(id)?.pt;
  ctx.strokeStyle = th.select;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 5]);
  ctx.globalAlpha = 0.8;
  const m = S(mouse);
  const line = (a: Vec, b: Vec, extend: 'none' | 'ray' | 'both') => {
    let p0 = S(a), p1 = S(b);
    const dir = G.norm(G.sub(p1, p0));
    const L = vp.w + vp.h;
    if (extend !== 'none') p1 = G.add(p0, G.mul(dir, L));
    if (extend === 'both') p0 = G.sub(S(a), G.mul(dir, L));
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  };
  const a = P(pending[0]);
  switch (tool.id) {
    case 'segment': case 'distance': if (a) line(a, mouse, 'none'); break;
    case 'line': if (a) line(a, mouse, 'both'); break;
    case 'ray': if (a) line(a, mouse, 'ray'); break;
    case 'circle2': if (a) { const s = S(a); ctx.beginPath(); ctx.arc(s.x, s.y, G.dist(s, m), 0, Math.PI * 2); ctx.stroke(); } break;
    case 'compassThrough': if (a) { const s = S(a); ctx.beginPath(); ctx.arc(s.x, s.y, G.dist(s, m), 0, Math.PI * 2); ctx.stroke(); } break;
    case 'compass': {
      const b = P(pending[1]);
      if (a && b) { ctx.beginPath(); ctx.arc(m.x, m.y, G.dist(S(a), S(b)), 0, Math.PI * 2); ctx.stroke(); }
      else if (a) line(a, mouse, 'none');
      break;
    }
    case 'polygon': {
      ctx.beginPath();
      pending.forEach((id, i) => { const p = P(id); if (p) { const s = S(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); } });
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      break;
    }
    case 'perp': case 'parallel': {
      const l = c.comp(pending[0])?.line;
      if (l) { const dir = tool.id === 'perp' ? G.perp(l.d) : l.d; line(mouse, G.add(mouse, dir), 'both'); }
      break;
    }
    case 'bisector': if (a) { const md = G.mid(a, mouse); line(md, G.add(md, G.perp(G.sub(mouse, a))), 'both'); } break;
    case 'angle': case 'angleBisector': {
      const pts = pending.map(P).filter(Boolean) as Vec[];
      ctx.beginPath();
      pts.forEach((p, i) => { const s = S(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      break;
    }
  }
}
