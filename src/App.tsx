import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Construction, type Snapshot } from './engine/construction';
import { nameBox, Viewport } from './engine/render';
import { GROUPS, RC_TOOLS, TOOLS, toolById, type Tool } from './engine/tools';
import { stepText } from './engine/describe';
import { CanvasView } from './CanvasView';
import { Sidebar } from './Sidebar';
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

interface Prefs { grid: boolean; axes: boolean; snap: boolean; theme: 'light' | 'dark'; measures: MeasureOpts; /** Mode « règle et compas » */ rc: boolean }

const NO_MEASURES: MeasureOpts = { lengths: false, angles: false, marks: false, unit: false };

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
      grid: true, axes: true, snap: true, rc: false,
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

  // Rejeu de la construction : n étapes déjà tracées.
  const [replay, setReplay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const steps = c.objects.filter((o) => !o.aux && o.def.k !== 'lock');
  const hiddenIds = useMemo(
    () => (replay === null ? undefined : new Set(steps.slice(replay).map((o) => o.id))),
    [c.version, replay], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!playing || replay === null) return;
    const t = setTimeout(() => { if (replay >= steps.length) setPlaying(false); else setReplay(replay + 1); }, 1500);
    return () => clearTimeout(t);
  }, [playing, replay, steps.length]);
  const startReplay = () => {
    if (!steps.length) { setToast('Il n’y a encore rien à rejouer : construis une figure d’abord.'); return; }
    setToolId('move'); setSelected(null); setMenu2(null); setAsk(null); setReplay(1); setPlaying(true);
  };
  const toggleRc = () => { setReplay(null); setPlaying(false); setToolId('move'); setSelected(null); setPref('rc', !prefs.rc); };

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
      if (replay !== null && !typing) {
        if (e.key === 'Escape') { setPlaying(false); setReplay(null); }
        else if (e.key === 'ArrowRight') { setPlaying(false); setReplay(Math.min(steps.length, replay + 1)); }
        else if (e.key === 'ArrowLeft') { setPlaying(false); setReplay(Math.max(1, replay - 1)); }
        else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
        return;
      }
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
          {prefs.rc ? (
            <div className="tool-group">
              {RC_TOOLS.map(([id, label]) => (
                <button key={id} className={`tool ${toolId === id ? 'on' : ''}`} data-tip={label} aria-label={label}
                  onClick={() => { setToolId(id); setSelected(null); }}>
                  <Icon name={id} />
                </button>
              ))}
            </div>
          ) : GROUPS.map((g) => (
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
          <button className="icon-btn" data-tip="Rejouer la construction pas à pas" onClick={startReplay}><Icon name="play" size={19} /></button>
          <button className={`mode-toggle ${prefs.rc ? 'on' : ''}`} data-tip="Construire seulement avec une règle et un compas" onClick={toggleRc}>
            <Icon name="rc" size={18} /> Règle et compas
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        </div>
      </header>

      <main className="main">
        <Sidebar c={c} selected={selected} onSelect={setSelected} commit={commit} onRename={(id) => openPrompt(renamePrompt(c, id))} />
        <div className="stage">
          <CanvasView c={c} vp={vp} tool={tool} grid={prefs.grid && !prefs.rc} axes={prefs.axes && !prefs.rc} snap={prefs.snap && !prefs.rc} theme={prefs.theme}
            selected={replay !== null ? steps[replay - 1]?.id ?? null : selected} onSelect={setSelected} commit={commit}
            hiddenIds={hiddenIds} frozen={replay !== null}
            onAsk={toolAsk}
            measures={prefs.rc || replay !== null ? NO_MEASURES : prefs.measures}
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
          {replay === null && <div className="hint">
            {edgePick ? <><b>Côtés égaux</b><span>{edgePick.hint} (Échap pour annuler)</span></> : <><b>{(prefs.rc && RC_TOOLS.find(([id]) => id === tool.id)?.[1]) || tool.label}</b><span>{hint}</span></>}
          </div>}
          {replay !== null && steps.length > 0 && (
            <div className="replay-bar">
              <button className="icon-btn" data-tip="Début" onClick={() => { setPlaying(false); setReplay(1); }}><Icon name="prev" size={18} /></button>
              <button className="icon-btn" data-tip="Étape précédente" onClick={() => { setPlaying(false); setReplay(Math.max(1, replay - 1)); }}><Icon name="back" size={18} /></button>
              <button className="icon-btn on" data-tip={playing ? 'Pause' : 'Lecture'} onClick={() => { if (!playing && replay >= steps.length) setReplay(1); setPlaying(!playing); }}><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
              <button className="icon-btn" data-tip="Étape suivante" onClick={() => { setPlaying(false); setReplay(Math.min(steps.length, replay + 1)); }}><Icon name="fwd" size={18} /></button>
              <button className="icon-btn" data-tip="Fin" onClick={() => { setPlaying(false); setReplay(steps.length); }}><Icon name="next" size={18} /></button>
              <div className="replay-text"><b>Étape {replay}/{steps.length}</b><span>{stepText(c, steps[replay - 1])}</span></div>
              <button className="btn small" onClick={() => { setPlaying(false); setReplay(null); }}>Quitter</button>
            </div>
          )}
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
            {!prefs.rc && <>
              <button className={`icon-btn ${prefs.grid ? 'on' : ''}`} data-tip="Grille" onClick={() => setPref('grid', !prefs.grid)}><Icon name="grid" size={18} /></button>
              <button className={`icon-btn ${prefs.axes ? 'on' : ''}`} data-tip="Axes" onClick={() => setPref('axes', !prefs.axes)}><Icon name="axes" size={18} /></button>
              <button className={`icon-btn ${prefs.snap ? 'on' : ''}`} data-tip="Aimanter à la grille" onClick={() => setPref('snap', !prefs.snap)}><Icon name="magnet" size={18} /></button>
              <button className={`icon-btn ${measureMenu ? 'on' : ''}`} data-tip={measureMenu ? undefined : 'Mesures affichées'} onClick={() => setMeasureMenu(!measureMenu)}><Icon name="ruler" size={18} /></button>
              <span className="hsep" />
            </>}
            <button className="icon-btn" data-tip="Zoom +" onClick={() => zoom(1.25)}><Icon name="plus" size={18} /></button>
            <button className="icon-btn" data-tip="Zoom −" onClick={() => zoom(0.8)}><Icon name="minus" size={18} /></button>
            <button className="icon-btn" data-tip="Vue initiale" onClick={resetView}><Icon name="home" size={18} /></button>
          </div>
          {measureMenu && !prefs.rc && (
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
              </main>
    </div>
  );
}
