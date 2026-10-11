// Langage de commandes en français (barre de saisie + IA).
// Exemples : A=(2;3)  f(x)=2x+1  Cercle(A;3)  I=Milieu(A,B)  Perpendiculaire(C,(AB))
import { Construction, COLORS, isValidExpr, type Def } from './construction';

export interface CmdResult { ok: boolean; message: string; created: string[] }

const NAME = String.raw`[\p{L}][\p{L}\d_]*'*`;
const reName = new RegExp(`^${NAME}$`, 'u');

/** Minuscules sans accents ni espaces : « Symétrie Axiale » → « symetrieaxiale ». */
const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_-]/g, '').toLowerCase();

/** Découpe au niveau 0 des parenthèses/crochets. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** Arguments : « ; » prioritaire (virgule décimale alors permise), sinon « , ». */
function splitArgs(s: string): string[] {
  if (!s.trim()) return [];
  const semi = splitTop(s, ';');
  if (semi.length > 1) return semi.map((a) => a.replace(/(\d),(\d)/g, '$1.$2'));
  return splitTop(s, ',');
}

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && s.trim() !== '' ? n : null;
};

export class CommandRunner {
  constructor(private c: Construction) {}

  // ---------- résolution des arguments ----------

  /** Argument écrit comme une commande imbriquée, ex. Droite(B, C) : on l'exécute et on renvoie l'objet créé. */
  private nested(arg: string, type?: string): string | null {
    const m = arg.match(/^([\p{L}][\p{L}_-]*)\s*\((.*)\)$/su);
    if (!m || this.c.byName(m[1])) return null;
    const before = new Set(this.c.objects.map((o) => o.id));
    this.command(key(m[1]), splitArgs(m[2]));
    this.c.recompute();
    const made = this.c.objects.filter((o) => !before.has(o.id) && (!type || o.type === type));
    return made.length ? made[made.length - 1].id : null;
  }

  point(arg: string): string {
    const o = this.c.byName(arg);
    if (o?.type === 'point') return o.id;
    const n = this.nested(arg, 'point');
    if (n) return n;
    const m = arg.match(/^\((.*)\)$/s);
    if (m) {
      const parts = splitArgs(m[1]);
      if (parts.length === 2) return this.makePoint(parts[0], parts[1]);
    }
    if (o) throw new Error(`« ${arg} » n'est pas un point.`);
    throw new Error(`Point « ${arg} » introuvable.`);
  }

  private makePoint(xs: string, ys: string, name?: string): string {
    const x = num(xs), y = num(ys);
    if (x !== null && y !== null) return this.c.add({ k: 'free', x, y }, { name });
    if (!isValidExpr(xs) || !isValidExpr(ys)) throw new Error(`Coordonnées invalides : (${xs} ; ${ys})`);
    return this.c.add({ k: 'coords', x: xs, y: ys }, { name });
  }

  /** Droite : nom, ou notation (AB), [AB], [AB) — créée en auxiliaire si absente. */
  line(arg: string): string {
    // « (B, C) » ou « [B ; C] » → « (BC) », « [BC] »
    const pair = arg.match(/^([\[(])\s*([^,;\s]+)\s*[,;]\s*([^,;\s]+)\s*([\])])$/);
    if (pair && this.c.byName(pair[2])?.type === 'point' && this.c.byName(pair[3])?.type === 'point') arg = `${pair[1]}${pair[2]}${pair[3]}${pair[4]}`;
    const o = this.c.byName(arg);
    if (o?.type === 'line') return o.id;
    const inner = arg.match(/^\((.+)\)$/)?.[1].trim();
    if (inner && this.c.byName(inner)?.type === 'line') return this.c.byName(inner)!.id;
    const n = this.nested(arg, 'line');
    if (n) return n;
    const m = arg.match(new RegExp(`^([\\[(])\\s*(${NAME})\\s*(${NAME})\\s*([\\])])$`, 'u'));
    if (m) {
      const a = this.c.byName(m[2]), b = this.c.byName(m[3]);
      if (a?.type === 'point' && b?.type === 'point') {
        const k: Def['k'] = m[1] === '(' ? 'line' : m[4] === ']' ? 'segment' : 'ray';
        const found = this.c.objects.find((x) => x.def.k === k && 'a' in x.def && x.def.a === a.id && 'b' in x.def && x.def.b === b.id);
        if (found) return found.id;
        // Pour une perpendiculaire/parallèle seule la direction compte : droite auxiliaire.
        return this.c.add({ k: 'line', a: a.id, b: b.id }, { aux: true });
      }
    }
    if (o) throw new Error(`« ${arg} » n'est pas une droite.`);
    throw new Error(`Droite « ${arg} » introuvable.`);
  }

  obj(arg: string): string {
    const o = this.c.byName(arg);
    if (o) return o.id;
    if (/^[\[(]/.test(arg)) return this.line(arg);
    const n = this.nested(arg);
    if (n) return n;
    const poly = this.c.objects.find((x) => x.def.k === 'polygon' && x.def.pts.map((p) => this.c.nameOf(p)).join('') === arg);
    if (poly) return poly.id;
    throw new Error(`Objet « ${arg} » introuvable.`);
  }

  expr(arg: string): string {
    if (!isValidExpr(arg)) throw new Error(`Expression invalide : ${arg}`);
    return arg.replace(/(\d),(\d)/g, '$1.$2');
  }

  // ---------- exécution ----------
  run(input: string): CmdResult {
    const line = input.trim().replace(/\s*;\s*$/, '');
    if (!line || line.startsWith('#') || line.startsWith('//')) return { ok: true, message: '', created: [] };
    const before = new Set(this.c.objects.map((o) => o.id));
    try {
      const msg = this.exec(line);
      this.c.changed();
      const created = this.c.objects.filter((o) => !before.has(o.id) && !o.aux).map((o) => o.id);
      return { ok: true, message: msg ?? (created.length ? `Créé : ${created.map((id) => this.c.nameOf(id)).join(', ')}` : 'OK'), created };
    } catch (e) {
      // Annule les objets partiellement créés.
      this.c.objects = this.c.objects.filter((o) => before.has(o.id));
      this.c.changed();
      return { ok: false, message: (e as Error).message, created: [] };
    }
  }

  private exec(line: string): string | void {
    const c = this.c;
    let m: RegExpMatchArray | null;

    // f(x) = ...
    if ((m = line.match(new RegExp(`^(${NAME})\\s*\\(\\s*x\\s*\\)\\s*=\\s*(.+)$`, 'u')))) {
      const [, name, body] = m;
      const existing = c.byName(name);
      if (existing?.def.k === 'function') { existing.def.expr = this.expr(body); return `${name} modifiée`; }
      c.add({ k: 'function', expr: this.expr(body) }, { name });
      return;
    }
    // y = 2x+1  → fonction anonyme
    if ((m = line.match(/^y\s*=\s*(.+)$/))) { c.add({ k: 'function', expr: this.expr(m[1]) }); return; }

    // A(2;3)  (notation de collège)
    if ((m = line.match(new RegExp(`^(${NAME})\\s*\\(([^()]*[;][^()]*)\\)$`, 'u'))) && /^\p{Lu}/u.test(m[1])) {
      return this.assignPoint(m[1], splitArgs(m[2]));
    }

    // nom = ...
    let name: string | undefined;
    let rhs = line;
    if ((m = line.match(new RegExp(`^(${NAME})\\s*=\\s*(.+)$`, 'u')))) { name = m[1]; rhs = m[2].trim(); }
    if (name && !reName.test(name)) throw new Error(`Nom invalide : ${name}`);

    // (x ; y)
    if ((m = rhs.match(/^\((.*)\)$/s)) && !/^\p{L}/u.test(rhs)) {
      const parts = splitArgs(m[1]);
      if (parts.length === 2) {
        if (name) return this.assignPoint(name, parts);
        this.makePoint(parts[0], parts[1]);
        return;
      }
    }

    // Commande(args)
    if ((m = rhs.match(/^([\p{L}][\p{L}\s_-]*?)\s*\((.*)\)$/su))) {
      return this.command(key(m[1]), splitArgs(m[2]), name);
    }

    // a = 3  → curseur (ou mise à jour)
    if (name) {
      const existing = c.byName(name);
      const val = num(rhs);
      if (existing?.def.k === 'slider' && val !== null) {
        existing.def.value = Math.min(existing.def.max, Math.max(existing.def.min, val));
        return `${name} = ${val}`;
      }
      if (existing) throw new Error(`Le nom « ${name} » est déjà utilisé.`);
      if (val !== null) {
        const span = Math.max(10, Math.ceil(Math.abs(val) * 2));
        c.add({ k: 'slider', value: val, min: Math.min(0, -span), max: span, step: 0.1 }, { name });
        return;
      }
    }
    throw new Error(`Je ne comprends pas « ${line} ». Exemples : A=(2;3), Segment(A,B), f(x)=2x+1`);
  }

  private assignPoint(name: string, parts: string[]): string | void {
    if (parts.length !== 2) throw new Error('Un point a deux coordonnées : A=(x ; y)');
    const existing = this.c.byName(name);
    if (existing) {
      const x = num(parts[0]), y = num(parts[1]);
      if (existing.def.k === 'free' && x !== null && y !== null) {
        existing.def.x = x; existing.def.y = y;
        return `${name} déplacé`;
      }
      throw new Error(`Le nom « ${name} » est déjà utilisé.`);
    }
    this.makePoint(parts[0], parts[1], name);
  }

  private need(args: string[], n: number, usage: string) {
    if (args.length < n) throw new Error(`Usage : ${usage}`);
  }

  private command(cmd: string, args: string[], name?: string): string | void {
    const c = this.c;
    const add = (def: Def) => c.add(def, { name });
    switch (cmd) {
      case 'point': {
        this.need(args, 2, 'Point(x, y)');
        return this.assignPoint(name ?? c.autoName('point'), args);
      }
      case 'pointsur': {
        this.need(args, 1, 'PointSur(objet)');
        const o = this.obj(args[0]);
        const k = c.comp(o);
        const t = args[1] !== undefined ? num(args[1]) ?? 0 : k?.line ? 0.5 : k?.circle ? Math.PI / 4 : 1;
        add({ k: 'on', o, t });
        return;
      }
      case 'milieu': {
        this.need(args, 1, 'Milieu(A, B) ou Milieu([AB])');
        if (args.length === 1) {
          const s = c.get(this.line(args[0]));
          if (s && 'a' in s.def && 'b' in s.def) { add({ k: 'midpoint', a: s.def.a as string, b: s.def.b as string }); return; }
        }
        add({ k: 'midpoint', a: this.point(args[0]), b: this.point(args[1]) });
        return;
      }
      case 'intersection': {
        this.need(args, 2, 'Intersection(objet1, objet2[, n])');
        const a = this.obj(args[0]), b = this.obj(args[1]);
        c.recompute();
        if (args[2] !== undefined || name) {
          const i = Math.max(1, num(args[2] ?? '1') ?? 1) - 1;
          add({ k: 'intersect', a, b, i });
          return;
        }
        const n = c.intersectionCount(a, b);
        if (n === 0) throw new Error('Ces objets ne se coupent pas.');
        for (let i = 0; i < n; i++) c.add({ k: 'intersect', a, b, i });
        return;
      }
      case 'segment': this.need(args, 2, 'Segment(A, B)'); add({ k: 'segment', a: this.point(args[0]), b: this.point(args[1]) }); return;
      case 'droite': this.need(args, 2, 'Droite(A, B)'); add({ k: 'line', a: this.point(args[0]), b: this.point(args[1]) }); return;
      case 'demidroite': this.need(args, 2, 'DemiDroite(A, B)'); add({ k: 'ray', a: this.point(args[0]), b: this.point(args[1]) }); return;
      case 'perpendiculaire': case 'parallele': {
        this.need(args, 2, `${cmd === 'parallele' ? 'Parallele' : 'Perpendiculaire'}(A, droite) ou (A, B, C) pour passer par A et être ⟂/∥ à (BC)`);
        const p = this.point(args[0]);
        const l = args.length >= 3 ? this.line(`(${args[1]}${args[2]})`) : this.line(args[1]);
        add({ k: cmd === 'parallele' ? 'parallel' : 'perp', p, l });
        return;
      }
      case 'mediatrice': {
        this.need(args, 1, 'Mediatrice(A, B)');
        if (args.length === 1) {
          const s = c.get(this.line(args[0]));
          if (s && 'a' in s.def && 'b' in s.def) { add({ k: 'bisector', a: s.def.a as string, b: s.def.b as string }); return; }
        }
        add({ k: 'bisector', a: this.point(args[0]), b: this.point(args[1]) });
        return;
      }
      case 'bissectrice': this.need(args, 3, 'Bissectrice(A, B, C) — angle de sommet B'); add({ k: 'angleBisector', a: this.point(args[0]), b: this.point(args[1]), c: this.point(args[2]) }); return;
      case 'cercle': {
        this.need(args, 2, 'Cercle(centre, point) ou Cercle(centre, rayon)');
        const center = this.point(args[0]);
        const o = c.byName(args[1]);
        if (o?.type === 'point' || /^\(.*\)$/.test(args[1])) add({ k: 'circle2', c: center, p: this.point(args[1]) });
        else add({ k: 'circleR', c: center, r: this.expr(args[1]) });
        return;
      }
      case 'polygone': case 'triangle': case 'quadrilatere': {
        this.need(args, 3, 'Polygone(A, B, C, …)');
        add({ k: 'polygon', pts: args.map((a) => this.point(a)) });
        return;
      }
      case 'polygoneregulier': case 'carre': {
        const n = cmd === 'carre' ? 4 : num(args[2] ?? '') ?? 0;
        // Limite haute : un « n » démesuré (erreur de saisie ou d'IA) ferait créer des millions de points.
        if (!Number.isInteger(n) || n < 3 || n > 40) throw new Error('Usage : PolygoneRegulier(A, B, n) avec n entre 3 et 40, ou Carre(A, B)');
        regularPolygon(c, this.point(args[0]), this.point(args[1]), n, name);
        return;
      }
      case 'symetrieaxiale': case 'symetriecentrale': case 'symetrie': case 'translation': case 'rotation': {
        this.need(args, 2, 'SymetrieAxiale(objet, droite) · SymetrieCentrale(objet, O) · Translation(objet, A, B) · Rotation(objet, O, angle)');
        // Les paramètres de la transformation sont à la fin ; tout ce qui précède est à transformer.
        const isPoint = (a: string) => c.byName(a)?.type === 'point';
        const isLineArg = (a: string) => c.byName(a)?.type === 'line' || /^[\[(].*[\])]$/.test(a) && !/^\(\s*-?[\d.]/.test(a);
        let mk: PointMaker;
        let nParams: number;
        const last = args[args.length - 1];
        if (cmd === 'symetriecentrale' || (cmd === 'symetrie' && isPoint(last) && (args.length === 2 || !isPoint(args[args.length - 2])))) {
          const ctr = this.point(last);
          mk = (p) => ({ k: 'reflectPoint', p, c: ctr });
          nParams = 1;
        } else if (cmd === 'symetrieaxiale' || cmd === 'symetrie') {
          let l: string;
          if (isLineArg(last) || args.length === 2) { l = this.line(last); nParams = 1; }
          else { l = this.line(`(${args[args.length - 2]}${last})`); nParams = 2; }
          mk = (p) => ({ k: 'reflectLine', p, l });
        } else if (cmd === 'translation') {
          this.need(args, 3, 'Translation(objet, A, B) — vecteur AB');
          const a = this.point(args[args.length - 2]), b = this.point(last);
          mk = (p) => ({ k: 'translate', p, a, b });
          nParams = 2;
        } else {
          this.need(args, 3, 'Rotation(objet, centre, angle en degrés)');
          const ctr = this.point(args[args.length - 2]), angle = this.expr(last.replace(/°/g, ''));
          mk = (p) => ({ k: 'rotate', p, c: ctr, angle });
          nParams = 2;
        }
        const targets = args.slice(0, args.length - nParams).map((a) => this.obj(a));
        if (!targets.length) throw new Error("Indique l'objet à transformer en premier argument.");
        // Plusieurs points qui sont exactement les sommets d'un polygone → on transforme le polygone.
        const poly = targets.length >= 3 && c.objects.find((o) => o.def.k === 'polygon'
          && o.def.pts.length === targets.length && o.def.pts.every((p) => targets.includes(p)));
        const ids = poly ? [imageOf(c, poly.id, mk)] : targets.map((t) => imageOf(c, t, mk));
        if (name && ids.length === 1) c.rename(ids[0], name);
        return;
      }
      case 'distance': case 'longueur': {
        this.need(args, 1, 'Distance(A, B)');
        if (args.length === 1) {
          const s = c.get(this.line(args[0]));
          if (s && 'a' in s.def && 'b' in s.def) { add({ k: 'distance', a: s.def.a as string, b: s.def.b as string }); return; }
        }
        add({ k: 'distance', a: this.point(args[0]), b: this.point(args[1]) });
        return;
      }
      case 'angle': this.need(args, 3, 'Angle(A, B, C) — sommet B'); add({ k: 'angle', a: this.point(args[0]), b: this.point(args[1]), c: this.point(args[2]) }); return;
      case 'curseur': {
        const min = num(args[0] ?? '') ?? -5, max = num(args[1] ?? '') ?? 5;
        const value = num(args[2] ?? '') ?? Math.min(max, Math.max(min, 1));
        add({ k: 'slider', value, min, max, step: num(args[3] ?? '') ?? 0.1 });
        return;
      }
      case 'supprimer': case 'effacer': {
        if (!args.length) { c.clear(); return 'Figure effacée'; }
        for (const a of args) c.remove(this.obj(a));
        return 'Supprimé';
      }
      case 'toutsupprimer': case 'nouveau': c.clear(); return 'Figure effacée';
      case 'couleur': {
        this.need(args, 2, 'Couleur(objet, rouge|bleu|vert|…|#hex)');
        const o = c.get(this.obj(args[0]))!;
        const col = COLORS[key(args[1])] ?? (/^#[0-9a-f]{3,8}$/i.test(args[1]) ? args[1] : null);
        if (!col) throw new Error(`Couleur inconnue. Disponibles : ${Object.keys(COLORS).join(', ')}`);
        o.color = col;
        return 'Couleur modifiée';
      }
      case 'masquer': case 'cacher': for (const a of args) c.get(this.obj(a))!.visible = false; return 'Masqué';
      case 'afficher': case 'montrer': for (const a of args) c.get(this.obj(a))!.visible = true; return 'Affiché';
      case 'renommer': {
        this.need(args, 2, 'Renommer(objet, nouveauNom)');
        if (!reName.test(args[1])) throw new Error(`Nom invalide : ${args[1]}`);
        c.rename(this.obj(args[0]), args[1]);
        return 'Renommé';
      }
    }
    throw new Error(`Commande inconnue : ${cmd}. Tape « aide » dans la barre pour voir la liste.`);
  }
}

// ---------- transformations ----------

export type PointMaker = (pointId: string) => Def;

/** Construit l'image d'un objet : images de ses points de définition + même construction. */
export function imageOf(c: Construction, id: string, mk: PointMaker): string {
  const cache = new Map<string, string>();
  const img = (pid: string) => {
    if (!cache.has(pid)) cache.set(pid, c.add(mk(pid), { name: c.primeName(c.nameOf(pid)) }));
    return cache.get(pid)!;
  };
  const o = c.get(id);
  if (!o) throw new Error('Objet introuvable.');
  const d = o.def;
  const opts = { color: o.color };
  switch (d.k) {
    case 'segment': case 'line': case 'ray': case 'bisector': case 'distance':
      return c.add({ k: d.k, a: img(d.a), b: img(d.b) }, opts);
    case 'circle2': return c.add({ k: 'circle2', c: img(d.c), p: img(d.p) }, opts);
    case 'circleR': return c.add({ k: 'circleR', c: img(d.c), r: d.r }, opts);
    case 'polygon': return c.add({ k: 'polygon', pts: d.pts.map(img) }, opts);
    case 'angleBisector': case 'angle': return c.add({ k: d.k, a: img(d.a), b: img(d.b), c: img(d.c) }, opts);
  }
  if (o.type === 'point') return img(id);
  throw new Error(`L'image de « ${o.name} » n'est pas encore prise en charge (essaie sur ses points).`);
}

/** Polygone régulier direct construit sur [AB] par rotations successives. */
export function regularPolygon(c: Construction, a: string, b: string, n: number, name?: string): string {
  const interior = (180 * (n - 2)) / n;
  const pts = [a, b];
  for (let k = 2; k < Math.min(n, 40); k++) {
    pts.push(c.add({ k: 'rotate', p: pts[k - 2], c: pts[k - 1], angle: String(-interior) }));
  }
  return c.add({ k: 'polygon', pts }, { name });
}

/** Aide-mémoire affiché dans l'interface et donné à l'IA. */
export const COMMAND_HELP: [string, string][] = [
  ['A = (2 ; 3)', 'point de coordonnées (2 ; 3)'],
  ['f(x) = 2x + 1', 'fonction'],
  ['a = 2', 'curseur (nombre réglable)'],
  ['Segment(A, B)', 'segment [AB]'],
  ['Droite(A, B)', 'droite (AB)'],
  ['DemiDroite(A, B)', 'demi-droite [AB)'],
  ['Milieu(A, B)', 'milieu de [AB]'],
  ['Cercle(O, A)', 'cercle de centre O passant par A'],
  ['Cercle(O, 3)', 'cercle de centre O et de rayon 3'],
  ['Perpendiculaire(C, (AB))', 'perpendiculaire à (AB) passant par C'],
  ['Parallele(C, (AB))', 'parallèle à (AB) passant par C'],
  ['Mediatrice(A, B)', 'médiatrice de [AB]'],
  ['Bissectrice(A, B, C)', "bissectrice de l'angle de sommet B"],
  ['Intersection(d1, c1)', 'point(s) d’intersection'],
  ['PointSur(c1)', 'point mobile sur un objet'],
  ['Polygone(A, B, C)', 'polygone (Triangle(…) aussi)'],
  ['PolygoneRegulier(A, B, 6)', 'polygone régulier (Carre(A, B) aussi)'],
  ['SymetrieAxiale(ABC, (d))', 'image par symétrie axiale'],
  ['SymetrieCentrale(ABC, O)', 'image par symétrie centrale'],
  ['Translation(ABC, A, B)', 'image par la translation de vecteur AB'],
  ['Rotation(ABC, O, 90)', 'image par rotation (degrés, sens direct)'],
  ['Distance(A, B)', 'longueur AB'],
  ['Angle(A, B, C)', 'mesure de l’angle de sommet B'],
  ['Couleur(c1, rouge)', 'change la couleur'],
  ['Masquer(d1) / Afficher(d1)', 'masque ou affiche'],
  ['Renommer(A, M)', 'renomme'],
  ['Supprimer(A)', 'supprime (et ce qui en dépend)'],
];
