// Menu contextuel (clic droit) et retouches au double-clic.
import { useEffect, useRef } from 'react';
import { COLORS, type Construction } from './engine/construction';
import { displayName } from './engine/describe';
import { parseNumber, releaseLock, renameObject, setAngle, setCoords, setEqualLength, setLength, setRadius, vertexOf } from './engine/edit';
import { findLenLock } from './engine/solve';
import * as G from './engine/geom';
import type { Vec } from './engine/geom';
import type { MLabel } from './engine/labels';

/** Ce qui se trouve sous le clic. */
export interface PickInfo {
  /** Position écran (fenêtre) pour placer le menu. */
  client: Vec;
  world: Vec;
  hit: string | null;
  /** Côté de polygone visé, s'il y en a un. */
  edge?: [string, string];
  /** Valeur écrite sur la figure (longueur, angle) visée par le clic. */
  label?: MLabel;
}

/** Choix d'un second côté : l'application passe en mode « clique sur un côté ». */
export interface EdgePick { hint: string; apply: (edge: [string, string]) => void }

export interface PromptSpec {
  label: string;
  value: string;
  suffix?: string;
  /** Applique la saisie ; peut renvoyer un message à afficher. */
  apply: (v: string) => string | void;
  /** Petite aide sous la saisie. */
  hint?: string;
  /** Objet à mettre en évidence pendant la saisie. */
  focus?: string;
  /** Saisie suivante (Tab) ou précédente (Maj+Tab). */
  next?: (dir: 1 | -1) => PromptSpec | null;
}

/** Saisie du nom d'un objet. Pour un point, Tab passe au point suivant (pratique pour nommer toute une figure). */
export function renamePrompt(c: Construction, id: string): PromptSpec {
  const o = c.get(id)!;
  const isPoint = o.type === 'point';
  const cycle = (dir: 1 | -1): PromptSpec | null => {
    const pts = c.objects.filter((x) => x.type === 'point' && x.visible && !x.aux);
    const i = pts.findIndex((x) => x.id === id);
    if (i < 0 || pts.length < 2) return null;
    return renamePrompt(c, pts[(i + dir + pts.length) % pts.length].id);
  };
  return {
    label: isPoint ? `Nom du point ${o.name}` : `Nouveau nom pour ${o.name}`,
    value: o.name,
    focus: id,
    hint: isPoint ? 'Tab : point suivant · Entrée : valider' : undefined,
    next: isPoint ? cycle : undefined,
    apply: (v) => renameObject(c, id, v),
  };
}

export interface MenuItem {
  label: string;
  /** Action immédiate (la figure est sauvegardée pour Ctrl+Z avant). */
  run?: () => void;
  /** Ouvre une petite saisie. */
  prompt?: PromptSpec;
  /** Demande de cliquer sur un autre côté. */
  pickEdge?: EdgePick;
  /** Ligne de pastilles de couleur. */
  colors?: (color: string) => void;
  danger?: boolean;
  sep?: boolean;
}

const f = (n: number) => G.fmt(n);

/** Valeur numérique saisie, ou erreur explicite. */
const num = (s: string) => parseNumber(s);

/** Saisie associée à une valeur écrite sur la figure (clic sur « 4,5 cm » ou « 63° »). */
export function labelPrompt(c: Construction, l: MLabel, unit: boolean): PromptSpec {
  if (l.kind === 'len') {
    const name = `[${c.nameOf(l.a)}${c.nameOf(l.b)}]`;
    return { label: `Longueur de ${name}`, value: f(l.value), suffix: unit ? 'cm' : undefined, apply: (v) => setLength(c, l.a, l.b, num(v)) };
  }
  const name = `${c.nameOf(l.p)}${c.nameOf(l.v)}${c.nameOf(l.n)}`;
  return {
    label: `Angle ${name}`, value: f(l.value), suffix: '°',
    apply: (v) => {
      if (l.value >= 180) throw new Error('Cet angle rentrant ne peut pas être réglé directement.');
      setAngle(c, l.p, l.v, l.n, num(v));
    },
  };
}

/** « Même longueur qu'un autre côté » : proposé quand les extrémités sont libres. */
function equalItem(c: Construction, a: string, b: string): MenuItem[] {
  if (![a, b].every((id) => c.get(id)?.def.k === 'free')) return [];
  const name = `[${c.nameOf(a)}${c.nameOf(b)}]`;
  return [{
    label: 'Même longueur qu’un autre côté…',
    pickEdge: { hint: `Clique sur le côté qui doit avoir la même longueur que ${name}`, apply: ([x, y]) => setEqualLength(c, a, b, x, y) },
  }];
}

function segmentItems(c: Construction, a: string, b: string): MenuItem[] {
  const A = c.comp(a)?.pt, B = c.comp(b)?.pt;
  if (!A || !B) return [];
  const name = `[${c.nameOf(a)}${c.nameOf(b)}]`;
  const hasDist = c.objects.some((o) => o.def.k === 'distance' && ((o.def.a === a && o.def.b === b) || (o.def.a === b && o.def.b === a)));
  const lock = findLenLock(c, a, b);
  return [
    { label: `Longueur de ${name}…`, prompt: { label: `Longueur de ${name}`, value: f(G.dist(A, B)), apply: (v) => setLength(c, a, b, num(v)) } },
    ...(lock ? [{ label: 'Libérer la longueur (elle pourra varier)', run: () => releaseLock(c, lock.id) }] : []),
    ...equalItem(c, a, b),
    ...(hasDist ? [] : [{ label: 'Afficher la longueur', run: () => { c.add({ k: 'distance', a, b }); } }]),
    { label: 'Placer le milieu', run: () => { c.add({ k: 'midpoint', a, b }); } },
    { label: 'Tracer la médiatrice', run: () => { c.add({ k: 'bisector', a, b }); } },
    { label: 'Prolonger en droite', run: () => { c.add({ k: 'line', a, b }); } },
  ];
}

function common(c: Construction, id: string): MenuItem[] {
  const o = c.get(id)!;
  return [
    { label: '', sep: true },
    { label: 'Couleur', colors: (col) => { o.color = col; } },
    { label: 'Renommer…', prompt: renamePrompt(c, id) },
    ...(o.type === 'point' ? [
      { label: o.noName ? 'Afficher le nom' : 'Masquer le nom', run: () => { o.noName = o.noName ? undefined : true; } },
      ...(o.labelOff ? [{ label: 'Replacer le nom', run: () => { delete o.labelOff; } }] : []),
    ] : []),
    { label: 'Masquer', run: () => { o.visible = false; } },
    { label: 'Supprimer', danger: true, run: () => c.remove(id) },
  ];
}

/** Menu d'une valeur écrite sur la figure (clic droit sur « 4,5 cm » ou « 63° »). */
function labelMenu(c: Construction, l: MLabel): { title: string; items: MenuItem[] } {
  const items: MenuItem[] = [{ label: 'Modifier la valeur…', prompt: labelPrompt(c, l, true) }];
  if (l.lockId) items.push({ label: 'Libérer (la valeur pourra de nouveau varier)', run: () => releaseLock(c, l.lockId!) });
  if (l.kind === 'len') items.push(...equalItem(c, l.a, l.b));
  const title = l.kind === 'len' ? `Longueur [${c.nameOf(l.a)}${c.nameOf(l.b)}]${l.lockId ? ' — imposée' : ''}` : `Angle ${c.nameOf(l.p)}${c.nameOf(l.v)}${c.nameOf(l.n)}${l.lockId ? ' — imposé' : ''}`;
  return { title, items };
}

export function buildMenu(c: Construction, info: PickInfo): { title: string; items: MenuItem[] } {
  if (info.label) return labelMenu(c, info.label);
  const { hit, edge } = info;
  if (!hit && !edge) {
    return {
      title: 'Figure',
      items: [{ label: 'Placer un point ici', run: () => { c.add({ k: 'free', x: +info.world.x.toFixed(2), y: +info.world.y.toFixed(2) }); } }],
    };
  }
  const o = c.get(hit ?? '')!;

  if (o?.type === 'point') {
    const p = c.comp(o.id)?.pt;
    const items: MenuItem[] = [];
    if (o.def.k === 'free' && p) {
      items.push({
        label: 'Coordonnées…',
        prompt: {
          label: `Coordonnées de ${o.name} (x ; y)`, value: `${f(p.x)} ; ${f(p.y)}`,
          apply: (v) => {
            const parts = v.replace(/[()]/g, '').split(/\s*;\s*/);
            if (parts.length !== 2) throw new Error('Écris les coordonnées sous la forme x ; y');
            setCoords(c, o.id, num(parts[0]), num(parts[1]));
          },
        },
      });
    }
    for (const { prev, next } of vertexOf(c, o.id).slice(0, 1)) {
      const P = c.comp(prev)?.pt, N = c.comp(next)?.pt;
      if (!P || !p || !N) continue;
      const nm = `${c.nameOf(prev)}${o.name}${c.nameOf(next)}`;
      items.push(
        { label: `Angle ${nm}…`, prompt: { label: `Mesure de l'angle ${nm}`, value: f(G.angleDeg(P, p, N)), suffix: '°', apply: (v) => setAngle(c, prev, o.id, next, num(v)) } },
        { label: `Angle droit en ${o.name}`, run: () => setAngle(c, prev, o.id, next, 90) },
        { label: `Afficher l'angle ${nm}`, run: () => { c.add({ k: 'angle', a: prev, b: o.id, c: next }); } },
      );
    }
    return { title: `Point ${o.name}`, items: [...items, ...common(c, o.id)] };
  }

  if (edge) {
    const poly = o?.def.k === 'polygon' ? o : undefined;
    const items = segmentItems(c, edge[0], edge[1]);
    if (poly) items.push(...polygonItems(c, poly.id));
    return { title: `Côté [${c.nameOf(edge[0])}${c.nameOf(edge[1])}]`, items: [...items, ...(poly ? common(c, poly.id) : [])] };
  }

  const d = o.def;
  if (d.k === 'segment') return { title: `Segment ${displayName(c, o)}`, items: [...segmentItems(c, d.a, d.b), ...common(c, o.id)] };
  if (d.k === 'polygon') return { title: `Polygone ${displayName(c, o)}`, items: [...polygonItems(c, o.id), ...common(c, o.id)] };
  if (o.type === 'circle') {
    const r = c.comp(o.id)?.circle?.r ?? 1;
    return {
      title: `Cercle ${o.name}`,
      items: [{ label: 'Rayon…', prompt: { label: `Rayon du cercle ${o.name}`, value: f(r), apply: (v) => setRadius(c, o.id, num(v)) } }, ...common(c, o.id)],
    };
  }
  if (d.k === 'function') {
    return {
      title: `Fonction ${o.name}`,
      items: [{ label: `Modifier ${o.name}(x)…`, prompt: { label: `${o.name}(x) =`, value: d.expr, apply: (v) => { d.expr = v; } } }, ...common(c, o.id)],
    };
  }
  return { title: displayName(c, o), items: common(c, o.id) };
}

function polygonItems(c: Construction, polyId: string): MenuItem[] {
  const d = c.get(polyId)!.def;
  if (d.k !== 'polygon') return [];
  const pts = d.pts;
  return [
    { label: '', sep: true },
    {
      label: 'Afficher toutes les longueurs',
      run: () => pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        if (!c.objects.some((o) => o.def.k === 'distance' && ((o.def.a === a && o.def.b === b) || (o.def.a === b && o.def.b === a)))) c.add({ k: 'distance', a, b });
      }),
    },
    {
      label: 'Afficher tous les angles',
      run: () => pts.forEach((v, i) => {
        const p = pts[(i - 1 + pts.length) % pts.length], n = pts[(i + 1) % pts.length];
        if (!c.objects.some((o) => o.def.k === 'angle' && o.def.b === v)) c.add({ k: 'angle', a: p, b: v, c: n });
      }),
    },
  ];
}

/** Action principale au double-clic : la valeur la plus naturelle à modifier. */
export function primaryEdit(c: Construction, info: PickInfo): PromptSpec | null {
  // Un point : on change son nom (les coordonnées restent dans le menu du clic droit).
  const o = info.label ? undefined : c.get(info.hit ?? '');
  if (o?.type === 'point' && !info.edge) return renamePrompt(c, o.id);
  const { items } = buildMenu(c, info);
  return items.find((i) => i.prompt)?.prompt ?? null;
}

export function ContextMenu({ x, y, title, items, onRun, onPrompt, onPickEdge, onClose }: {
  x: number; y: number; title: string; items: MenuItem[];
  onRun: (fn: () => void) => void; onPrompt: (p: PromptSpec) => void; onPickEdge: (p: EdgePick) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    el.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    const close = (e: PointerEvent) => { if (!el.contains(e.target as Node)) onClose(); };
    setTimeout(() => window.addEventListener('pointerdown', close), 0);
    return () => window.removeEventListener('pointerdown', close);
  }, [x, y]);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{title}</div>
      {items.map((it, i) => it.sep ? <div key={i} className="hsep" /> : it.colors ? (
        <div key={i} className="ctx-colors">
          {Object.entries(COLORS).map(([n, col]) => (
            <button key={n} title={n} style={{ background: col }} onClick={() => { onRun(() => it.colors!(col)); onClose(); }} />
          ))}
        </div>
      ) : (
        <button key={i} className={it.danger ? 'danger' : ''} onClick={() => {
          onClose();
          if (it.prompt) onPrompt(it.prompt);
          else if (it.pickEdge) onPickEdge(it.pickEdge);
          else if (it.run) onRun(it.run);
        }}>{it.label}</button>
      ))}
    </div>
  );
}
