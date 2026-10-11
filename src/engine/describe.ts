// Textes lisibles : définition (au format des commandes) et valeur de chaque objet.
import type { Construction, GeoObject } from './construction';
import { fmt, polygonArea } from './geom';

/** Nom « scolaire » : [AB], (AB), [AB), ABC… */
export function displayName(c: Construction, o: GeoObject): string {
  const n = (id: string) => c.nameOf(id);
  const d = o.def;
  if (d.k === 'segment') return `[${n(d.a)}${n(d.b)}]`;
  if (d.k === 'line') return `(${n(d.a)}${n(d.b)})`;
  if (d.k === 'ray') return `[${n(d.a)}${n(d.b)})`;
  if (d.k === 'polygon') return d.pts.map(n).join('');
  if (d.k === 'distance') return `${n(d.a)}${n(d.b)}`;
  if (d.k === 'angle') return `${o.name} = ${n(d.a)}${n(d.b)}̂${n(d.c)}`;
  return o.name;
}

export function defToCommand(c: Construction, o: GeoObject): string {
  // Les droites auxiliaires (masquées) sont désignées par leur notation (AB).
  const n = (id: string) => { const x = c.get(id); return x?.aux ? displayName(c, x) : c.nameOf(id); };
  const d = o.def;
  switch (d.k) {
    case 'free': return `(${fmt(d.x)} ; ${fmt(d.y)})`;
    case 'coords': return `(${d.x} ; ${d.y})`;
    case 'midpoint': return `Milieu(${n(d.a)}, ${n(d.b)})`;
    case 'intersect': return `Intersection(${n(d.a)}, ${n(d.b)}, ${d.i + 1})`;
    case 'on': return `PointSur(${n(d.o)})`;
    case 'reflectLine': return `SymetrieAxiale(${n(d.p)}, ${n(d.l)})`;
    case 'reflectPoint': return `SymetrieCentrale(${n(d.p)}, ${n(d.c)})`;
    case 'translate': return `Translation(${n(d.p)}, ${n(d.a)}, ${n(d.b)})`;
    case 'rotate': return `Rotation(${n(d.p)}, ${n(d.c)}, ${d.angle})`;
    case 'segment': return `Segment(${n(d.a)}, ${n(d.b)})`;
    case 'line': return `Droite(${n(d.a)}, ${n(d.b)})`;
    case 'ray': return `DemiDroite(${n(d.a)}, ${n(d.b)})`;
    case 'perp': return `Perpendiculaire(${n(d.p)}, ${n(d.l)})`;
    case 'parallel': return `Parallele(${n(d.p)}, ${n(d.l)})`;
    case 'bisector': return `Mediatrice(${n(d.a)}, ${n(d.b)})`;
    case 'angleBisector': return `Bissectrice(${n(d.a)}, ${n(d.b)}, ${n(d.c)})`;
    case 'circle2': return `Cercle(${n(d.c)}, ${n(d.p)})`;
    case 'circleR': return `Cercle(${n(d.c)}, ${d.r})`;
    case 'polygon': return `Polygone(${d.pts.map(n).join(', ')})`;
    case 'function': return `${o.name}(x) = ${d.expr}`;
    case 'slider': return `Curseur(${fmt(d.min)}, ${fmt(d.max)})`;
    case 'distance': return `Distance(${n(d.a)}, ${n(d.b)})`;
    case 'angle': return `Angle(${n(d.a)}, ${n(d.b)}, ${n(d.c)})`;
  }
}

/** Valeur courante lisible, ou « non défini ». */
export function valueText(c: Construction, o: GeoObject): string {
  const k = c.comp(o.id);
  if (!k) return 'non défini';
  if (k.pt) return `(${fmt(k.pt.x)} ; ${fmt(k.pt.y)})`;
  if (o.def.k === 'segment' && k.line) return `longueur ${fmt(Math.hypot(k.line.d.x, k.line.d.y))}`;
  if (k.circle) return `rayon ${fmt(k.circle.r)}`;
  if (k.poly) return `aire ${fmt(polygonArea(k.poly))}`;
  if (o.def.k === 'angle') return `${fmt(k.value!, 1)}°`;
  if (k.value !== undefined) return fmt(k.value);
  if (o.def.k === 'function') return `y = ${o.def.expr}`;
  if (k.line) return lineEquation(k.line.p, k.line.d);
  return '';
}

/** Équation réduite y = mx + p (ou x = c), utile pour les fonctions affines. */
function lineEquation(p: { x: number; y: number }, d: { x: number; y: number }) {
  if (Math.abs(d.x) < 1e-12) return `x = ${fmt(p.x)}`;
  const m = d.y / d.x, q = p.y - m * p.x;
  const qs = Math.abs(q) < 1e-9 ? '' : q > 0 ? ` + ${fmt(q)}` : ` − ${fmt(-q)}`;
  return `y = ${fmt(m)}x${qs}`;
}

/** Description complète de la figure, envoyée à l'IA comme contexte. */
export function describeConstruction(c: Construction): string {
  const lines = c.objects.filter((o) => !o.aux).map((o) => {
    const def = o.def.k === 'function' ? defToCommand(c, o) : `${o.name} = ${defToCommand(c, o)}`;
    const shown = displayName(c, o) !== o.name ? ` noté ${displayName(c, o)}` : '';
    return `- ${def}${shown} → ${valueText(c, o)}${o.visible ? '' : ' (masqué)'}`;
  });
  return lines.length ? lines.join('\n') : '(figure vide)';
}
