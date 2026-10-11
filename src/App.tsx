import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Construction, type Snapshot } from './engine/construction';
import { nameBox, Viewport } from './engine/render';
import { GROUPS, TOOLS, toolById, type Tool } from './engine/tools';
import { CanvasView } from './CanvasView';
import { Sidebar } from './Sidebar';
import { AiPanel } from './AiPanel';
import { Icon } from './icons';
import { moveFreePoint } from './engine/solve';
import { buildMenu, ContextMenu, labelPrompt, primaryEdit, renamePrompt, type EdgePick, type MenuItem, type PromptSpec } from './ContextMenu';
import { collectMeasures, DEFAULT_MEASURES, type MeasureOpts } from './engine/labels';
import { alternatives, applyShape, recognize, type Shape, type ShapeKind } from './engine/sketch';
import type { Vec } from './engine/geom';

const STORE = 'easygeo.figure';
const PREFS = 'easygeo.prefs';

const readJSON = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };
const writeJSON = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

interface Prefs { grid: boolean; axes: boolean; snap: boolean; theme: 'light' | 'dark'; ai: boolean; measures: MeasureOpts }

export function App() {
  const c = useMemo(() => {
    const k = new Construction();
    const saved = readJSON<{ objects: never[]; nextId: number }>(STORE);
    if (saved?.objects) k.load(saved); else k.changed();
    return k;
  }, []);
  useSyncExternalStore((f) => c.subscribe(f), () => c.version);

  const vp = useRef(new Viewport({ ox: 0, oy: 0, scale: 50 })).current;
  const [toolId, setToolId] = useState('move');
  const tool = toolById(toolId);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const saved = readJSON<Partial<Prefs>>(PREFS);
    return {
      grid: true, axes: true, snap: true, ai: true,
      theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      ...saved,
      measures: { ...DEFAULT_MEASURES, ...saved?.measures },
    };
  });
  const [measureMenu, setMeasureMenu] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  /** Petite saisie (rayon, longueur, angle…) affichée près du curseur ou en haut du dessin. */
  const [ask, setAsk] = useState<(PromptSpec & { x?: number; y?: number; orig?: string; seq?: number }) | null>(null);
  const askSeq = useRef(0);
  const nudgeAt = useRef(0);
  const [menu2, setMenu2] = useState<{ x: number; y: number; title: string; items: MenuItem[] } | null>(null);
  /** Mode « clique sur un côté » (même longueur que…). */
  const [edgePick, setEdgePick] = useState<EdgePick | null>(null);
  const [sketch, setSketch] = useState<{ summary: string; stroke: Vec[]; shape: Shape } | null>(null);
  const [cancelToken, setCancelToken] = useState(0);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const [, force] = useState(0);
  const [menu, setMenu] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; writeJSON(PREFS, prefs); }, [prefs]);

  // Sauvegarde automatique
  useEffect(() => {
    const t = setTimeout(() => writeJSON(STORE, c.toJSON()), 400);
    return () => clearTimeout(t);
  }, [c.version]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const commit = () => {
    undo.current.push(c.snapshot());
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    force((n) => n + 1);
  };
  const doUndo = () => {
    const s = undo.current.pop();
    if (!s) return;
    redo.current.push(c.snapshot());
    c.restore(s);
    setSelected(null);
  };
  const doRedo = () => {
    const s = redo.current.pop();
    if (!s) return;
    undo.current.push(c.snapshot());
    c.restore(s);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); doRedo(); }
      else if (e.key === 'Escape') {
        if (ask || menu2 || edgePick) { setAsk(null); setMenu2(null); setEdgePick(null); return; }
        setCancelToken((n) => n + 1); setToolId('move');
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !typing) {
        commit(); c.remove(selected); c.changed(); setSelected(null);
      }
      else if (e.key === 'F2' && selected && c.get(selected) && !typing) { e.preventDefault(); openPrompt(renamePrompt(c, selected)); }
      else if (e.key.startsWith('Arrow') && selected && !typing && !ask && !menu2) {
        // Flèches : déplacent finement le point sélectionné (Maj = très fin).
        const o = c.get(selected);
        const p = o?.def.k === 'free' ? c.comp(o.id)?.pt : undefined;
        if (o && p) {
          e.preventDefault();
          const step = e.shiftKey ? 0.1 : 0.5;
          const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
          const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
          if (Date.now() - nudgeAt.current > 900) commit();
          nudgeAt.current = Date.now();
          const r = (v: number) => Math.round(v * 1e4) / 1e4;
          moveFreePoint(c, o.id, { x: r(p.x + dx), y: r(p.y + dy) });
          c.changed();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Exécute une retouche avec sauvegarde pour Ctrl+Z ; en cas d'erreur, rien n'est modifié. */
  const act = (fn: () => void): boolean => {
    const snap = c.snapshot();
    commit();
    try { fn(); c.changed(); return true; } catch (e) {
      undo.current.pop();
      c.restore(snap);
      setToast((e as Error).message);
      return false;
    }
  };
  const runAsk = () => {
    if (!ask) return;
    const out: { msg?: string } = {};
    if (act(() => { out.msg = ask.apply(ask.value) ?? undefined; })) { setAsk(null); if (out.msg) setToast(out.msg); }
  };
  /** Tab / Maj+Tab dans une saisie de nom : valide et passe au point suivant / précédent. */
  const askStep = (dir: 1 | -1) => {
    if (!ask?.next) return;
    const cur = ask, at = cur.x !== undefined ? { x: cur.x, y: cur.y! } : undefined;
    const nxt = cur.next!(dir);
    const out: { msg?: string } = {};
    if (cur.value !== cur.orig && !act(() => { out.msg = cur.apply(cur.value) ?? undefined; })) return;
    if (out.msg) setToast(out.msg);
    if (nxt) openPrompt(nxt, at); else setAsk(null);
  };
  const toolAsk = (t: Tool, ids: string[]) => setAsk({
    label: t.ask!.label, value: t.ask!.default, suffix: t.ask!.suffix,
    apply: (v) => t.run?.(c, ids, v),
  });
  const openPrompt = (p: PromptSpec, at?: Vec) => {
    if (p.focus) setSelected(p.focus);
    setAsk({ ...p, x: at?.x, y: at?.y, orig: p.value, seq: ++askSeq.current });
  };

  /** Réinterprète le dernier tracé (bouton « C'était plutôt… »). */
  const reinterpret = (kind: ShapeKind) => {
    if (!sketch) return;
    doUndo();
    commit();
    try {
      const shape = recognize(sketch.stroke, kind);
      const summary = applyShape(c, vp, shape, prefs.snap);
      setSketch({ ...sketch, summary, shape });
    } catch (e) { setToast((e as Error).message); }
    c.changed();
  };

  useEffect(() => {
    if (!sketch) return;
    const t = setTimeout(() => setSketch(null), 6000);
    return () => clearTimeout(t);
  }, [sketch]);

  const download = (name: string, href: string) => {
    const a = document.createElement('a');
    a.href = href; a.download = name; a.click();
  };
  const saveFile = () => {
    const blob = new Blob([JSON.stringify({ ...c.toJSON(), view: vp.view }, null, 1)], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    download('figure.easygeo.json', u);
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  const openFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.objects)) throw new Error();
      commit();
      c.load(data);
      if (data.view) Object.assign(vp.view, data.view);
      c.changed();
    } catch { setToast("Ce fichier n'est pas une figure EasyGeo."); }
  };
  const exportPng = () => {
    const cv = document.querySelector<HTMLCanvasElement>('canvas.board');
    if (cv) download('figure.png', cv.toDataURL('image/png'));
  };
  const newFigure = () => {
    if (c.objects.length && !confirm('Effacer la figure actuelle ? (tu pourras annuler avec Ctrl+Z)')) return;
    commit(); c.clear(); c.changed(); setSelected(null);
  };
  /** Recadre la vue sur la figure, seulement si elle sort de l'écran ou y est minuscule. */
  const ensureVisible = () => {
    const pts: Vec[] = [];
    for (const o of c.objects) {
      if (!o.visible || o.aux) continue;
      const k = c.comp(o.id);
      if (k?.pt) pts.push(k.pt);
      else if (k?.circle) pts.push({ x: k.circle.c.x - k.circle.r, y: k.circle.c.y - k.circle.r }, { x: k.circle.c.x + k.circle.r, y: k.circle.c.y + k.circle.r });
      else if (k?.poly) pts.push(...k.poly);
    }
    if (!pts.length || !vp.w || !vp.h) return;
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    const b = vp.bounds, mx = (b.x1 - b.x0) * 0.06, my = (b.y1 - b.y0) * 0.06;
    const inside = x0 > b.x0 + mx && x1 < b.x1 - mx && y0 > b.y0 + my && y1 < b.y1 - my;
    const small = Math.max((x1 - x0) / (b.x1 - b.x0), (y1 - y0) / (b.y1 - b.y0)) < 0.2;
    if (inside && !small) return;
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
    vp.view.scale = Math.min(110, Math.max(18, Math.min((vp.w * 0.78) / w, (vp.h * 0.78) / h)));
    vp.view.ox = (x0 + x1) / 2;
    vp.view.oy = (y0 + y1) / 2;
    c.changed();
  };
  const zoom = (f: number) => { vp.zoomAt({ x: vp.w / 2, y: vp.h / 2 }, f); c.changed(); };
  const resetView = () => { Object.assign(vp.view, { ox: 0, oy: 0, scale: 50 }); c.changed(); };

  const hint = tool.hints[Math.min(pendingCount, tool.hints.length - 1)];

  // Accès pour les tests automatiques (activé par localStorage « easygeo.debug » = 1).
  try {
    if (localStorage.getItem('easygeo.debug') === '1') {
      (window as unknown as Record<string, unknown>).__easygeo = { c, vp, labels: () => collectMeasures(c, vp, prefs.measures), names: () => c.objects.filter((o) => o.type === 'point').map((o) => ({ id: o.id, name: o.name, box: nameBox(c, vp, o), pt: c.comp(o.id)?.pt })) };
    }
  } catch { /* stockage indisponible */ }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="var(--accent)" /><path d="M7 24 L16 7 L25 24 Z" fill="none" stroke="white" strokeWidth="2.5" strokeLinejoin="round" /><circle cx="16" cy="7" r="2.6" fill="white" /></svg>
          <span>EasyGeo</span>
        </div>

        <nav className="tools">
          {GROUPS.map((g) => (
            <div className="tool-group" key={g.id}>
              {TOOLS.filter((t) => t.group === g.id).map((t) => (
                <button key={t.id} className={`tool ${toolId === t.id ? 'on' : ''}`} data-tip={t.label} aria-label={t.label}
                  onClick={() => { setToolId(t.id); setSelected(null); }}>
                  <Icon name={t.id} />
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="actions">
          <button className="icon-btn" data-tip="Annuler (Ctrl+Z)" disabled={!undo.current.length} onClick={doUndo}><Icon name="undo" size={19} /></button>
          <button className="icon-btn" data-tip="Rétablir (Ctrl+Y)" disabled={!redo.current.length} onClick={doRedo}><Icon name="redo" size={19} /></button>
          <span className="sep" />
          <div className="menu-wrap">
            <button className={`icon-btn ${menu ? 'on' : ''}`} data-tip={menu ? undefined : 'Fichier'} onClick={() => setMenu(!menu)}><Icon name="file" size={19} /></button>
            {menu && (
              <div className="menu" onClick={() => setMenu(false)}>
                <button onClick={newFigure}><Icon name="file" size={17} /> Nouvelle figure</button>
                <button onClick={() => fileInput.current?.click()}><Icon name="open" size={17} /> Ouvrir…</button>
                <button onClick={saveFile}><Icon name="save" size={17} /> Enregistrer</button>
                <button onClick={exportPng}><Icon name="image" size={17} /> Exporter en image (PNG)</button>
              </div>
            )}
          </div>
          <button className="icon-btn" data-tip={prefs.theme === 'dark' ? 'Thème clair' : 'Thème sombre'} onClick={() => setPref('theme', prefs.theme === 'dark' ? 'light' : 'dark')}>
            <Icon name={prefs.theme === 'dark' ? 'sun' : 'moon'} size={19} />
          </button>
          <button className={`ai-toggle ${prefs.ai ? 'on' : ''}`} onClick={() => setPref('ai', !prefs.ai)}>
            <Icon name="sparkle" size={18} /> Assistant
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        </div>
      </header>

      <main className="main">
        <Sidebar c={c} selected={selected} onSelect={setSelected} commit={commit} onRename={(id) => openPrompt(renamePrompt(c, id))} />
        <div className="stage">
          <CanvasView c={c} vp={vp} tool={tool} grid={prefs.grid} axes={prefs.axes} snap={prefs.snap} theme={prefs.theme}
            selected={selected} onSelect={setSelected} commit={commit}
            onAsk={toolAsk}
            measures={prefs.measures}
            edgePick={edgePick ? (edge) => {
              const spec = edgePick;
              setEdgePick(null);
              if (!edge) { setToast('Il faut cliquer sur un côté (un segment ou un côté de polygone).'); return; }
              act(() => spec.apply(edge));
            } : null}
            onEditLabel={(l, at) => { setMenu2(null); openPrompt(labelPrompt(c, l, prefs.measures.unit), at); }}
            onEditName={(id, at) => { setMenu2(null); openPrompt(renamePrompt(c, id), at); }}
            onPending={setPendingCount} onError={setToast} cancelToken={cancelToken}
            onContext={(info) => { setAsk(null); setMenu2({ x: info.client.x, y: info.client.y, ...buildMenu(c, info) }); }}
            onEdit={(info) => {
              const p = primaryEdit(c, info);
              if (p) openPrompt(p, info.client);
              else setMenu2({ x: info.client.x, y: info.client.y, ...buildMenu(c, info) });
            }}
            onSketch={(summary, stroke, shape) => setSketch({ summary, stroke, shape })} />
          <div className="hint">
            {edgePick ? <><b>Côtés égaux</b><span>{edgePick.hint} (Échap pour annuler)</span></> : <><b>{tool.label}</b><span>{hint}</span></>}
          </div>
          {toast && <div className="toast">{toast}</div>}
          {sketch && !toast && (
            <div className="sketch-bar">
              <span>✓ {sketch.summary}</span>
              {alternatives(sketch.shape).length > 0 && <span className="muted">C'était plutôt</span>}
              {alternatives(sketch.shape).map((a) => (
                <button key={a.kind} className="btn small" onClick={() => reinterpret(a.kind)}>{a.label}</button>
              ))}
              <button className="btn small" onClick={() => { doUndo(); setSketch(null); }}>Annuler</button>
            </div>
          )}
          {menu2 && (
            <ContextMenu {...menu2} onClose={() => setMenu2(null)}
              onRun={(fn) => act(fn)}
              onPrompt={(p) => openPrompt(p, { x: menu2.x, y: menu2.y })}
              onPickEdge={(p) => setEdgePick(p)} />
          )}
          <div className="zoom">
            <button className={`icon-btn ${prefs.grid ? 'on' : ''}`} data-tip="Grille" onClick={() => setPref('grid', !prefs.grid)}><Icon name="grid" size={18} /></button>
            <button className={`icon-btn ${prefs.axes ? 'on' : ''}`} data-tip="Axes" onClick={() => setPref('axes', !prefs.axes)}><Icon name="axes" size={18} /></button>
            <button className={`icon-btn ${prefs.snap ? 'on' : ''}`} data-tip="Aimanter à la grille" onClick={() => setPref('snap', !prefs.snap)}><Icon name="magnet" size={18} /></button>
            <button className={`icon-btn ${measureMenu ? 'on' : ''}`} data-tip={measureMenu ? undefined : 'Mesures affichées'} onClick={() => setMeasureMenu(!measureMenu)}><Icon name="ruler" size={18} /></button>
            <span className="hsep" />
            <button className="icon-btn" data-tip="Zoom +" onClick={() => zoom(1.25)}><Icon name="plus" size={18} /></button>
            <button className="icon-btn" data-tip="Zoom −" onClick={() => zoom(0.8)}><Icon name="minus" size={18} /></button>
            <button className="icon-btn" data-tip="Vue initiale" onClick={resetView}><Icon name="home" size={18} /></button>
          </div>
          {measureMenu && (
            <div className="measure-pop">
              <div className="ctx-title">Mesures sur la figure</div>
              {([
                ['lengths', 'Longueurs des côtés', '5 cm'],
                ['angles', 'Valeurs des angles', '63°'],
                ['marks', 'Angles droits et côtés égaux', '⌐ ‖'],
                ['unit', 'Écrire l’unité « cm »', ''],
              ] as const).map(([k, label, ex]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={prefs.measures[k]} onChange={(e) => setPref('measures', { ...prefs.measures, [k]: e.target.checked })} />
                  <span>{label}</span><em>{ex}</em>
                </label>
              ))}
              <p>Clique sur une valeur de la figure pour la modifier.</p>
            </div>
          )}
          {ask && (
            <div className={`ask ${ask.x !== undefined ? 'at' : ''}`}
              style={ask.x !== undefined ? { left: Math.min(ask.x + 8, window.innerWidth - 340), top: Math.min(ask.y! + 8, window.innerHeight - 170) } : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runAsk();
                else if (e.key === 'Tab' && ask.next) { e.preventDefault(); askStep(e.shiftKey ? -1 : 1); }
              }}>
              <label>{ask.label}</label>
              <div className="ask-row">
                <input key={ask.seq} autoFocus value={ask.value} onChange={(e) => setAsk({ ...ask, value: e.target.value })} onFocus={(e) => e.target.select()} />
                {ask.suffix && <span>{ask.suffix}</span>}
              </div>
              {ask.hint && <div className="ask-hint">{ask.hint}</div>}
              <div className="ask-actions">
                <button className="btn" onClick={() => setAsk(null)}>Annuler</button>
                <button className="btn primary" onClick={runAsk}>Valider</button>
              </div>
            </div>
          )}
        </div>
        {prefs.ai && <AiPanel c={c} commit={commit} onClose={() => setPref('ai', false)} onFigure={ensureVisible} />}
      </main>
    </div>
  );
}
