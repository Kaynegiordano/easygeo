// Assistant IA : conversation avec Ollama, voix (Whisper + synthèse), photo de dessin à main levée.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Construction } from './engine/construction';
import { CommandRunner } from './engine/commands';
import { describeConstruction } from './engine/describe';
import {
  chat, chatLlama, DEFAULT_URL, extractCommands, isPureQuestion, isVisionModel, LITE_SYSTEM_PROMPT, listModels, looksLikeConstruction,
  RECOMMENDED_MODEL, RECOMMENDED_VISION_MODEL, sketchRequest, SUGGESTIONS, SYSTEM_PROMPT, VISION_PROMPT, visibleText,
  warmLlama, type ChatMsg,
} from './ai';
import { isSpeaking, onSpeaking, Recorder, speak, stopSpeaking, transcribe, whisperStatus } from './voice';
import { Icon } from './icons';
import { bridge, LITE, LLAMA_URL, type AiInfo, type AiStatus, type UpgradeProgress } from './edition';

interface CmdLog { cmd: string; ok: boolean; msg: string }
interface UiMsg {
  role: 'user' | 'assistant';
  text: string;
  image?: string;
  /** Description lue sur la photo par le modèle de vision. */
  seen?: string;
  cmds?: CmdLog[];
  /** Commandes proposées, en attente de validation par l'élève. */
  proposal?: string[];
  error?: string;
  busy?: boolean;
  status?: string;
}

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

/** Réduit l'image (côté max 1280 px) et renvoie le JPEG en base64 + une URL d'aperçu. */
async function prepareImage(file: Blob): Promise<{ b64: string; url: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.9);
  return { b64: url.split(',')[1], url };
}

export function AiPanel({ c, commit, onClose, onFigure }: { c: Construction; commit: () => void; onClose: () => void; onFigure?: () => void }) {
  const runner = useMemo(() => new CommandRunner(c), [c]);
  const [url] = useState(() => load('easygeo.ollama', DEFAULT_URL));
  const [model, setModel] = useState(() => load('easygeo.model', ''));
  const [models, setModels] = useState<string[] | null>(null);
  const [status, setStatus] = useState<'checking' | 'ok' | 'off'>('checking');
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [speakOn, setSpeakOn] = useState(() => load('easygeo.speak', '0') === '1');
  // Valeur lue pendant les réponses longues (la fonction d'envoi garde l'ancien rendu en mémoire).
  const speakRef = useRef(speakOn);
  speakRef.current = !LITE && speakOn;
  const [talking, setTalking] = useState(isSpeaking());
  const [talkingMsg, setTalkingMsg] = useState<number | null>(null);
  useEffect(() => onSpeaking((s) => { setTalking(s); if (!s) setTalkingMsg(null); }), []);
  const [image, setImage] = useState<{ b64: string; url: string } | null>(null);
  const [rec, setRec] = useState<'idle' | 'rec' | 'stt'>('idle');
  const [level, setLevel] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const recorder = useRef<Recorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const history = useRef<ChatMsg[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const textModels = (models ?? []).filter((m) => !isVisionModel(m) || m === model);
  const visionModel = (models ?? []).find((m) => m.startsWith('qwen3-vl')) ?? (models ?? []).find(isVisionModel);

  const refresh = async () => {
    setStatus('checking');
    try {
      const m = await listModels(url);
      setModels(m);
      setStatus('ok');
      if (!m.includes(model) || isVisionModel(model)) {
        const text = m.filter((x) => !isVisionModel(x));
        const pick = text.find((x) => x.startsWith('qwen3')) ?? text.find((x) => /qwen|mistral|llama|gemma/i.test(x)) ?? text[0] ?? m[0] ?? '';
        setModel(pick);
        save('easygeo.model', pick);
      }
    } catch {
      setStatus('off');
      setModels(null);
    }
  };

  // ---------- édition Lite : moteur d'IA embarqué ----------
  const [engine, setEngine] = useState<AiStatus>({ state: 'starting', model: 'light', error: '' });
  const [info, setInfo] = useState<AiInfo | null>(null);
  const [engineTick, setEngineTick] = useState(0);
  const [upgrade, setUpgrade] = useState<{ open: boolean; progress?: UpgradeProgress; error?: string; running: boolean }>({ open: false, running: false });

  /** État du moteur : via l'application, ou directement (navigateur de développement). */
  const readEngine = async (): Promise<AiStatus> => {
    if (bridge?.aiStatus) return bridge.aiStatus();
    try {
      const r = await fetch(`${LLAMA_URL}/health`, { signal: AbortSignal.timeout(1500) });
      return { state: r.status === 200 ? 'ready' : 'starting', model: 'light', error: '' };
    } catch { return { state: 'error', model: 'light', error: 'Moteur d’IA introuvable.' }; }
  };

  useEffect(() => {
    if (!LITE) return;
    let stop = false;
    const tick = async () => {
      const s = await readEngine();
      if (stop) return;
      setEngine(s);
      if (s.state === 'starting') setTimeout(tick, 700);
    };
    tick();
    bridge?.aiInfo?.().then((i) => { if (!stop) setInfo(i); });
    return () => { stop = true; };
  }, [engineTick]);

  // Dès que le moteur est prêt, on « chauffe » la consigne : la première vraie question part alors tout de suite.
  useEffect(() => {
    if (LITE && engine.state === 'ready') warmLlama(LLAMA_URL, LITE_SYSTEM_PROMPT).catch(() => {});
  }, [engine.state, engine.model]);

  useEffect(() => bridge?.onAiUpgradeProgress?.((p) => setUpgrade((u) => ({ ...u, progress: p }))), []);

  const startUpgrade = async () => {
    setUpgrade({ open: true, running: true, progress: { done: 0, total: 1 } });
    const r = await bridge?.aiUpgrade?.();
    setUpgrade({ open: !r?.ok, running: false, error: r?.ok ? undefined : r?.error });
    if (r?.ok) { setEngine({ state: 'starting', model: 'precise', error: '' }); setEngineTick((n) => n + 1); }
  };
  const backToLight = async () => {
    await bridge?.aiDowngrade?.();
    setEngine({ state: 'starting', model: 'light', error: '' });
    setEngineTick((n) => n + 1);
  };

  useEffect(() => { if (!LITE) refresh(); }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);
  useEffect(() => () => stopSpeaking(), []);

  // Animation du niveau sonore pendant l'enregistrement
  useEffect(() => {
    if (rec !== 'rec') return;
    const t = setInterval(() => setLevel(recorder.current?.level ?? 0), 80);
    return () => clearInterval(t);
  }, [rec]);

  const update = (i: number, patch: Partial<UiMsg>) => setMsgs((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const execute = (cmds: string[]): CmdLog[] => {
    const logs = cmds.map((cmd) => {
      const r = runner.run(cmd);
      return { cmd, ok: r.ok, msg: r.message };
    });
    onFigure?.(); // recadre la vue si la figure construite sort de l'écran
    return logs;
  };

  const withContext = (t: string) => `Figure actuelle :\n${describeConstruction(c)}\n\n${t}`;

  /** Appel du modèle : moteur embarqué (Lite) ou Ollama. */
  const llm = (messages: ChatMsg[], onText: (full: string) => void, signal: AbortSignal) =>
    LITE ? chatLlama(LLAMA_URL, messages, onText, signal) : chat(url, model, messages, onText, signal);
  const systemPrompt = LITE ? LITE_SYSTEM_PROMPT : SYSTEM_PROMPT;

  /** Conversation texte classique : l'IA construit directement. */
  const sendText = async (text: string, ai: number, ctl: AbortController) => {
    const turn: ChatMsg = { role: 'user', content: withContext(`Demande de l'élève : ${text}`) };
    // Petit modèle : peu d'historique (contexte court, réponses plus rapides).
    const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt }, ...history.current.slice(LITE ? -4 : -8), turn];
    let full = await llm(messages, (t) => update(ai, { text: visibleText(t) }), ctl.signal);
    let cmds = extractCommands(full);
    // Une construction sans bloc de commandes (oubli fréquent des petits modèles) : on redemande une fois.
    if (!cmds.length && looksLikeConstruction(text)) {
      update(ai, { status: 'Je construis la figure…' });
      const again = await llm(
        [...messages, { role: 'assistant', content: full }, { role: 'user', content: `Écris maintenant uniquement le bloc geo avec les commandes pour : ${text}` }],
        () => {}, ctl.signal,
      );
      cmds = extractCommands(again);
      if (cmds.length) full += `\n\`\`\`geo\n${cmds.join('\n')}\n\`\`\``;
      update(ai, { status: undefined });
    }
    history.current.push({ role: 'user', content: `Demande de l'élève : ${text}` }, { role: 'assistant', content: full });
    if (speakRef.current) { speak(visibleText(full)); setTalkingMsg(ai); }

    if (!cmds.length || isPureQuestion(text)) return;
    commit(); // une seule annulation pour toute l'action de l'IA
    let logs = execute(cmds);
    update(ai, { cmds: logs });
    const failed = logs.filter((l) => !l.ok);
    if (!failed.length) return;
    // Une tentative de correction automatique.
    update(ai, { status: 'Correction en cours…' });
    const fix: ChatMsg = {
      role: 'user',
      content: withContext(`Ces commandes ont échoué :\n${failed.map((f) => `- ${f.cmd} → ${f.msg}`).join('\n')}\nLes autres ont réussi et sont déjà dans la figure ci-dessus. Renvoie uniquement un bloc geo avec les commandes corrigées, sans explication.`),
    };
    full = await llm([...messages, { role: 'assistant', content: full }, fix], () => {}, ctl.signal);
    cmds = extractCommands(full);
    if (cmds.length) logs = [...logs.filter((l) => l.ok), ...execute(cmds)];
    update(ai, { cmds: logs, status: undefined });
  };

  /** Photo d'un dessin : lecture par le modèle de vision, puis construction proposée (à valider). */
  const sendImage = async (text: string, img: string, ai: number, ctl: AbortController) => {
    if (!visionModel) throw new Error(`Aucun modèle de vision installé. Dans un terminal : ollama pull ${RECOMMENDED_VISION_MODEL}`);
    update(ai, { status: 'Je regarde ton dessin…' });
    const seen = await chat(url, visionModel, [
      { role: 'system', content: VISION_PROMPT },
      { role: 'user', content: text || 'Quelle figure est dessinée ?', images: [img] },
    ], (t) => update(ai, { seen: t }), ctl.signal);
    update(ai, { seen, status: 'Je construis la figure exacte…' });

    const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: sketchRequest(seen + (text ? `\nPrécision de l'élève : ${text}` : '')) }];
    const full = await chat(url, model, messages, (t) => update(ai, { text: visibleText(t) }), ctl.signal);
    history.current.push({ role: 'user', content: `(photo d'un dessin) ${text}` }, { role: 'assistant', content: full });
    const cmds = extractCommands(full);
    update(ai, { proposal: cmds.length ? cmds : undefined, status: undefined });
    if (speakRef.current) { speak(visibleText(full) + (cmds.length ? ' Tu peux appliquer la figure si elle te convient.' : '')); setTalkingMsg(ai); }
  };

  const send = async (text: string) => {
    const img = image;
    if ((!text.trim() && !img) || busy || !ready) return;
    setInput('');
    setImage(null);
    setBusy(true);
    stopSpeaking();
    const ctl = new AbortController();
    abort.current = ctl;
    const base = msgs.length;
    setMsgs((m) => [...m, { role: 'user', text, image: img?.url }, { role: 'assistant', text: '', busy: true }]);
    const ai = base + 1;
    try {
      if (img) await sendImage(text, img.b64, ai, ctl);
      else await sendText(text, ai, ctl);
      update(ai, { busy: false });
    } catch (e) {
      const err = (e as Error).name === 'AbortError' ? 'Arrêté.' : `Erreur : ${(e as Error).message}`;
      update(ai, { busy: false, status: undefined, error: err });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const applyProposal = (i: number, replace: boolean) => {
    const m = msgs[i];
    if (!m.proposal) return;
    commit();
    if (replace) { c.clear(); c.changed(); }
    const logs = execute(m.proposal);
    update(i, { proposal: undefined, cmds: logs });
  };

  // ---------- voix ----------
  const toggleMic = async () => {
    if (rec === 'stt') return;
    if (rec === 'rec') {
      setRec('stt');
      try {
        const wav = await recorder.current!.stop();
        const text = await transcribe(wav);
        setRec('idle');
        if (text) send(text);
        else setMsgs((m) => [...m, { role: 'assistant', text: '', error: "Je n'ai rien entendu. Vérifie le micro et parle un peu plus fort." }]);
      } catch (e) {
        setRec('idle');
        setMsgs((m) => [...m, { role: 'assistant', text: '', error: `Micro : ${(e as Error).message}` }]);
      }
      return;
    }
    const st = await whisperStatus();
    if (st === 'missing' || st === 'error') {
      setMsgs((m) => [...m, {
        role: 'assistant', text: '',
        error: "La reconnaissance vocale n'est pas disponible (elle fonctionne dans l'application EasyGeo pour Windows).",
      }]);
      return;
    }
    try {
      stopSpeaking();
      recorder.current = new Recorder();
      await recorder.current.start();
      setRec('rec');
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: '', error: "Impossible d'accéder au micro." }]);
    }
  };

  const toggleSpeak = () => {
    const v = !speakOn;
    setSpeakOn(v);
    save('easygeo.speak', v ? '1' : '0');
    if (v) speak('Lecture vocale activée.'); // confirmation audible : on entend tout de suite que ça marche
    else stopSpeaking();
  };

  /** Lecture à la demande d'une réponse précise (marche même interrupteur coupé). */
  const listen = (i: number) => {
    if (talking && talkingMsg === i) { stopSpeaking(); return; }
    speak(msgs[i].text);
    setTalkingMsg(i);
  };

  const takeImage = async (f: Blob | null | undefined) => {
    if (LITE || !f || !f.type.startsWith('image/')) return;
    try { setImage(await prepareImage(f)); } catch { /* image illisible */ }
  };

  const ready = LITE ? engine.state === 'ready' : status === 'ok' && !!model;
  const dotState = LITE ? (engine.state === 'ready' ? 'ok' : engine.state === 'starting' ? 'checking' : 'off') : status;
  const upgradeOffer = LITE && !!bridge?.aiUpgrade && !!info && info.ramGB >= 7;
  const pct = upgrade.progress ? Math.min(100, Math.round((upgrade.progress.done / upgrade.progress.total) * 100)) : 0;

  return (
    <aside className={`ai-panel ${dragOver ? 'drop' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); takeImage(e.dataTransfer.files[0]); }}>
      <div className="panel-head">
        <span className="ai-title"><Icon name="sparkle" size={18} /> Assistant</span>
        <div className="ai-model">
          <span className={`status-dot ${dotState}`} title={LITE
            ? (engine.state === 'ready' ? 'Assistant prêt' : engine.state === 'starting' ? 'L’assistant démarre…' : 'Assistant indisponible')
            : (status === 'ok' ? 'Ollama connecté' : status === 'off' ? 'Ollama introuvable' : 'Connexion…')} />
          {!LITE && textModels.length > 0 && (
            <select value={model} onChange={(e) => { setModel(e.target.value); save('easygeo.model', e.target.value); }}>
              {textModels.map((m) => <option key={m}>{m}</option>)}
            </select>
          )}
          <button className="icon-btn ghost" data-tip="Actualiser" onClick={LITE ? () => setEngineTick((n) => n + 1) : refresh}><Icon name="refresh" size={16} /></button>
          <button className="icon-btn ghost" data-tip="Fermer" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
      </div>

      {!LITE && (
        <div className="voice-row">
          <button role="switch" aria-checked={speakOn} className={`switch ${speakOn ? 'on' : ''}`} onClick={toggleSpeak}>
            <span className="knob" />
          </button>
          <span className="voice-label" onClick={toggleSpeak}>
            <Icon name={speakOn ? 'speaker' : 'speakerOff'} size={16} />
            Lire les réponses à voix haute
            <b>{speakOn ? 'Activé' : 'Désactivé'}</b>
          </span>
          {talking && <button className="btn small" onClick={stopSpeaking}>■ Stop</button>}
        </div>
      )}

      {LITE && upgradeOffer && (
        <div className="lite-row">
          {engine.model === 'precise'
            ? <><span>✨ Assistant <b>précis</b></span><button className="btn small" onClick={backToLight}>Revenir au léger</button></>
            : upgrade.running
              ? <div className="dl"><div className="bar"><i style={{ width: `${pct}%` }} /></div><span>{pct} % · {Math.round((upgrade.progress?.done ?? 0) / 1e6)} / {Math.round((upgrade.progress?.total ?? 0) / 1e6)} Mo</span>
                  <button className="btn small" onClick={() => bridge?.aiUpgradeCancel?.()}>Annuler</button></div>
              : <><span>Assistant <b>léger</b> (rapide)</span><button className="btn small" onClick={() => setUpgrade({ ...upgrade, open: !upgrade.open })}>Plus précis…</button></>}
        </div>
      )}
      {LITE && upgradeOffer && upgrade.open && !upgrade.running && engine.model === 'light' && (
        <div className="upgrade-card">
          <b>Un assistant plus précis ?</b>
          <p>Télécharge un modèle plus gros ({info?.preciseSizeGB} Go, une seule fois). Il se trompe beaucoup moins en géométrie, mais répond un peu plus lentement. Il faut une connexion internet pour le téléchargement.</p>
          {upgrade.error && <div className="feedback err">{upgrade.error}</div>}
          <div className="proposal-actions">
            <button className="btn" onClick={() => setUpgrade({ ...upgrade, open: false })}>Plus tard</button>
            <button className="btn primary" onClick={startUpgrade}>Télécharger</button>
          </div>
        </div>
      )}

      <div className="ai-msgs" ref={scroller}>
        {LITE && engine.state === 'starting' && (
          <div className="ai-setup">
            <h4><span className="spinner" /> L’assistant se réveille…</h4>
            <p>Il se charge sur ton ordinateur, ça prend quelques secondes. Tu peux déjà dessiner pendant ce temps !</p>
          </div>
        )}
        {LITE && (engine.state === 'error' || engine.state === 'missing') && (
          <div className="ai-setup">
            <h4>L’assistant n’a pas pu démarrer</h4>
            <p>{engine.error || 'Le moteur d’IA est introuvable.'}</p>
            <p>Ferme puis rouvre EasyGeo. Si le problème continue, vérifie qu’il reste au moins 3 Go de mémoire libre.</p>
            <div className="proposal-actions"><button className="btn primary" onClick={() => setEngineTick((n) => n + 1)}>Réessayer</button></div>
          </div>
        )}
        {!LITE && status === 'off' && (
          <div className="ai-setup">
            <h4>Connecte une IA locale</h4>
            <p>L'assistant utilise <b>Ollama</b>, qui fait tourner l'IA directement sur ton PC (gratuit, hors ligne).</p>
            <ol>
              <li>Installe Ollama depuis <a href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com/download</a></li>
              <li>Dans un terminal : <code>ollama pull {RECOMMENDED_MODEL}</code></li>
              <li>Clique sur <Icon name="refresh" size={13} /> ci-dessus.</li>
            </ol>
          </div>
        )}
        {!LITE && status === 'ok' && models?.length === 0 && (
          <div className="ai-setup">
            <h4>Aucun modèle installé</h4>
            <p>Dans un terminal : <code>ollama pull {RECOMMENDED_MODEL}</code>, puis actualise.</p>
          </div>
        )}
        {ready && msgs.length === 0 && (
          <div className="ai-welcome">
            {LITE
              ? <p>Décris en une phrase ce que tu veux construire ou pose-moi une question de géométrie : je trace la figure et je t'explique.</p>
              : <p>Décris ce que tu veux construire, <b>parle</b> avec le micro <Icon name="mic" size={13} />, ou envoie la <b>photo d'un dessin</b> fait à main levée <Icon name="camera" size={13} /> : je le refais au propre.</p>}
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.image && <img className="msg-img" src={m.image} alt="Dessin envoyé" />}
            {m.seen && (
              <details className="cmds seen">
                <summary>👁 Ce que j'ai vu sur le dessin</summary>
                <Rich text={m.seen} />
              </details>
            )}
            {m.text && <Rich text={m.text} />}
            {!LITE && m.role === 'assistant' && m.text && !m.busy && (
              <button className={`listen ${talking && talkingMsg === i ? 'on' : ''}`} onClick={() => listen(i)}>
                <Icon name={talking && talkingMsg === i ? 'stop' : 'speaker'} size={13} />
                {talking && talkingMsg === i ? 'Arrêter' : 'Écouter'}
              </button>
            )}
            {m.status && <div className="ai-status"><span className="spinner" />{m.status}</div>}
            {m.busy && !m.text && !m.status && <div className="typing"><span /><span /><span /></div>}
            {m.proposal && (
              <div className="proposal">
                <details className="cmds"><summary>{m.proposal.length} commande{m.proposal.length > 1 ? 's' : ''} proposée{m.proposal.length > 1 ? 's' : ''}</summary>
                  {m.proposal.map((p, j) => <div key={j}><code>{p}</code></div>)}
                </details>
                <div className="proposal-actions">
                  {c.objects.length > 0 && <button className="btn" onClick={() => applyProposal(i, false)}>Ajouter à ma figure</button>}
                  <button className="btn primary" onClick={() => applyProposal(i, c.objects.length > 0)}>{c.objects.length ? 'Remplacer ma figure' : 'Construire la figure'}</button>
                </div>
              </div>
            )}
            {m.cmds && m.cmds.length > 0 && (
              <details className="cmds">
                <summary>
                  {m.cmds.every((l) => l.ok) ? '✓' : '⚠'} {m.cmds.filter((l) => l.ok).length} commande{m.cmds.length > 1 ? 's' : ''} appliquée{m.cmds.length > 1 ? 's' : ''}
                  {m.cmds.some((l) => !l.ok) && ` · ${m.cmds.filter((l) => !l.ok).length} erreur(s)`}
                </summary>
                {m.cmds.map((l, j) => <div key={j} className={l.ok ? 'ok' : 'err'}><code>{l.cmd}</code>{!l.ok && <span> — {l.msg}</span>}</div>)}
              </details>
            )}
            {m.error && <div className="feedback err">{m.error}</div>}
          </div>
        ))}
      </div>

      {dragOver && <div className="drop-hint"><Icon name="camera" size={28} />Dépose la photo de ton dessin</div>}

      <div className="ai-input-wrap">
        {image && (
          <div className="attach">
            <img src={image.url} alt="" />
            <span>Photo du dessin — ajoute une précision si tu veux, puis envoie.</span>
            <button className="icon-btn ghost" onClick={() => setImage(null)}><Icon name="close" size={14} /></button>
          </div>
        )}
        <div className="ai-input">
          {!LITE && <button className="icon-btn ghost att" data-tip="Photo d'un dessin" disabled={!ready || busy} onClick={() => fileInput.current?.click()}><Icon name="camera" size={19} /></button>}
          <textarea
            rows={2}
            value={input}
            disabled={!ready || rec !== 'idle'}
            placeholder={rec === 'rec' ? 'Je t’écoute… clique à nouveau sur le micro quand tu as fini.' : rec === 'stt' ? 'Je transcris…' : ready ? 'Ex. : construis un parallélogramme ABCD…' : LITE && engine.state === 'starting' ? 'L’assistant démarre…' : 'Assistant indisponible'}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); takeImage(f); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          />
          {busy ? (
            <button className="icon-btn primary" title="Arrêter" onClick={() => { abort.current?.abort(); stopSpeaking(); }}><Icon name="stop" size={18} /></button>
          ) : input.trim() || image || LITE ? (
            <button className="icon-btn primary" title="Envoyer" disabled={!ready || !input.trim()} onClick={() => send(input)}><Icon name="send" size={18} /></button>
          ) : (
            <button className={`icon-btn primary mic ${rec}`} title={rec === 'rec' ? 'Terminer' : 'Parler'} disabled={!ready || rec === 'stt'}
              style={{ '--lvl': level } as React.CSSProperties} onClick={toggleMic}>
              {rec === 'stt' ? <span className="spinner light" /> : <Icon name={rec === 'rec' ? 'stop' : 'mic'} size={18} />}
            </button>
          )}
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { takeImage(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </aside>
  );
}

/** Mise en forme minimale : paragraphes, listes, **gras**, `code`. */
function Rich({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code>
      : part);
  // Regroupe les lignes consécutives en paragraphes ou en listes.
  const bullet = /^\s*([-*•]|\d+[.)])\s+/;
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) { blocks.push({ list: false, lines: [] }); continue; }
    const list = bullet.test(raw);
    const last = blocks[blocks.length - 1];
    if (last && last.list === list && last.lines.length) last.lines.push(raw);
    else blocks.push({ list, lines: [raw] });
  }
  return (
    <div className="rich">
      {blocks.filter((b) => b.lines.length).map((b, i) => b.list
        ? <ul key={i}>{b.lines.map((l, j) => <li key={j}>{inline(l.replace(bullet, ''))}</li>)}</ul>
        : <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l.replace(/^#+\s*/, ''))}</span>)}</p>)}
    </div>
  );
}
