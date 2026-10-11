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
    case 'compass': return `Compas(${n(d.c)}, ${n(d.a)}, ${n(d.b)})`;
    case 'circleR': return `Cercle(${n(d.c)}, ${d.r})`;
    case 'polygon': return `Polygone(${d.pts.map(n).join(', ')})`;
    case 'function': return `${o.name}(x) = ${d.expr}`;
    case 'slider': return `Curseur(${fmt(d.min)}, ${fmt(d.max)})`;
    case 'distance': return `Distance(${n(d.a)}, ${n(d.b)})`;
    case 'angle': return `Angle(${n(d.a)}, ${n(d.b)}, ${n(d.c)})`;
    case 'lock': return '';
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

/** Une étape de construction écrite comme une consigne d'exercice (pour « Rejouer »). */
export function stepText(c: Construction, o: GeoObject): string {
  const n = (id: string) => c.nameOf(id);
  const dn = (id: string) => { const x = c.get(id); return x ? displayName(c, x) : '?'; };
  const d = o.def;
  switch (d.k) {
    case 'free': return `Place le point ${o.name}.`;
    case 'coords': return `Place le point ${o.name} (${d.x} ; ${d.y}).`;
    case 'on': return `Place un point ${o.name} sur ${dn(d.o)}.`;
    case 'midpoint': return `Place le point ${o.name}, milieu de [${n(d.a)}${n(d.b)}].`;
    case 'intersect': return `Marque le point ${o.name}, à l’intersection de ${dn(d.a)} et ${dn(d.b)}.`;
    case 'segment': return `À la règle, trace le segment [${n(d.a)}${n(d.b)}].`;
    case 'line': return `À la règle, trace la droite (${n(d.a)}${n(d.b)}).`;
    case 'ray': return `À la règle, trace la demi-droite [${n(d.a)}${n(d.b)}).`;
    case 'circle2': return o.arc
      ? `Au compas : pointe en ${n(d.c)}, règle l’écartement sur ${n(d.c)}${n(d.p)} et trace un arc de cercle.`
      : `Trace le cercle de centre ${n(d.c)} passant par ${n(d.p)}.`;
    case 'compass': return `Au compas : prends l’écartement ${n(d.a)}${n(d.b)}, pointe en ${n(d.c)} et trace un arc de cercle.`;
    case 'circleR': return `Trace le cercle de centre ${n(d.c)} et de rayon ${d.r}.`;
    case 'perp': return `Trace la perpendiculaire à ${dn(d.l)} passant par ${n(d.p)}.`;
    case 'parallel': return `Trace la parallèle à ${dn(d.l)} passant par ${n(d.p)}.`;
    case 'bisector': return `Trace la médiatrice de [${n(d.a)}${n(d.b)}].`;
    case 'angleBisector': return `Trace la bissectrice de l’angle ${n(d.a)}${n(d.b)}${n(d.c)}.`;
    case 'polygon': return `Trace le polygone ${d.pts.map(n).join('')}.`;
    case 'reflectLine': return `Construis le symétrique de ${n(d.p)} par rapport à ${dn(d.l)} : ${o.name}.`;
    case 'reflectPoint': return `Construis le symétrique de ${n(d.p)} par rapport à ${n(d.c)} : ${o.name}.`;
    case 'translate': return `Construis l’image de ${n(d.p)} par la translation de ${n(d.a)} vers ${n(d.b)} : ${o.name}.`;
    case 'rotate': return `Construis l’image de ${n(d.p)} par la rotation de centre ${n(d.c)} et d’angle ${d.angle}° : ${o.name}.`;
    case 'function': return `Trace la courbe de ${o.name}(x) = ${d.expr}.`;
    case 'slider': return `Crée le curseur ${o.name}.`;
    case 'distance': return `Mesure la longueur ${n(d.a)}${n(d.b)}.`;
    case 'angle': return `Mesure l’angle ${n(d.a)}${n(d.b)}${n(d.c)}.`;
    case 'lock': return '';
  }
}
