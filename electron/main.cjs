// Fenêtre Electron d'EasyGeo : charge le build Vite (dist/) ou le serveur de dev.
//  - Édition « full » : démarre Whisper (reconnaissance vocale) s'il est installé ; l'IA passe par Ollama.
//  - Édition « lite » : pas de voix ; démarre le moteur d'IA embarqué (llama.cpp + petit modèle), sans rien à installer.
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------- édition ----------
function readEdition() {
  if (process.env.EASYGEO_EDITION) return process.env.EASYGEO_EDITION === 'lite' ? 'lite' : 'full';
  try { return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'edition.json'), 'utf8')).edition === 'lite' ? 'lite' : 'full'; } catch { return 'full'; }
}
const EDITION = readEdition();
const LITE = EDITION === 'lite';

// ====================================================================
//  Reconnaissance vocale (édition full)
// ====================================================================
const WHISPER_PORT = 8178;
const WHISPER_DIR = path.join(__dirname, '..', 'tools', 'whisper');
const WHISPER_MODEL = path.join(WHISPER_DIR, 'ggml-large-v3-turbo-q5_0.bin');
const WHISPER_PROMPT =
  'Géométrie au collège : triangle ABC rectangle en A, segment [AB], droite (AB), milieu, médiatrice, bissectrice, ' +
  'hypoténuse, théorème de Pythagore, Thalès, cosinus, cercle circonscrit, symétrique, translation, rotation, perpendiculaire, parallèle, parallélogramme, losange.';

/** @type {import('child_process').ChildProcess | null} */
let whisper = null;
let whisperState = 'missing'; // missing | starting | ready | error

function startWhisper() {
  if (LITE || !fs.existsSync(WHISPER_MODEL)) return;
  // GPU (CUDA) d'abord ; si le serveur s'arrête avant d'être prêt, repli sur la version CPU.
  const variants = ['cuda', 'cpu'].map((v) => path.join(WHISPER_DIR, v, 'Release', 'whisper-server.exe')).filter((p) => fs.existsSync(p));
  const tryNext = () => {
    const exe = variants.shift();
    if (!exe) { whisperState = 'error'; return; }
    whisperState = 'starting';
    const p = spawn(exe, ['-m', WHISPER_MODEL, '--host', '127.0.0.1', '--port', String(WHISPER_PORT), '-l', 'fr', '-t', '8'], {
      cwd: path.dirname(exe),
      windowsHide: true,
    });
    whisper = p;
    // La sortie console du serveur n'est pas fiable (tampon) : on interroge directement le port.
    p.stdout.resume();
    p.stderr.resume();
    const poll = setInterval(async () => {
      if (whisper !== p) return clearInterval(poll);
      try {
        const r = await fetch(`http://127.0.0.1:${WHISPER_PORT}/`, { signal: AbortSignal.timeout(1000) });
        if (r.status < 500) { clearInterval(poll); whisperState = 'ready'; warmUp(); }
      } catch { /* pas encore prêt */ }
    }, 500);
    p.on('exit', () => {
      clearInterval(poll);
      if (whisper !== p) return;
      whisper = null;
      if (whisperState !== 'ready') tryNext();
      else whisperState = 'error';
    });
  };
  tryNext();
}

/** Première inférence « à blanc » (1 s de silence) : compile les noyaux GPU avant que l'élève parle. */
function warmUp() {
  const n = 16000, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'warmup.wav');
  fetch(`http://127.0.0.1:${WHISPER_PORT}/inference`, { method: 'POST', body: fd }).catch(() => {});
}

ipcMain.handle('whisper-status', () => whisperState);

ipcMain.handle('transcribe', async (_e, wav) => {
  // Si le serveur démarre encore, on patiente (jusqu'à 60 s) plutôt que d'échouer.
  for (let i = 0; i < 120 && whisperState === 'starting'; i++) await new Promise((r) => setTimeout(r, 500));
  if (whisperState !== 'ready') throw new Error('Reconnaissance vocale indisponible.');
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'voix.wav');
  fd.append('response_format', 'json');
  fd.append('language', 'fr');
  fd.append('temperature', '0');
  fd.append('prompt', WHISPER_PROMPT);
  const r = await fetch(`http://127.0.0.1:${WHISPER_PORT}/inference`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Whisper : ${r.status}`);
  const j = await r.json();
  return String(j.text ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
});

// ====================================================================
//  Moteur d'IA embarqué (édition lite) : llama.cpp + petit modèle
// ====================================================================
const AI_PORT = 8179;
const AI_DIR = app.isPackaged ? path.join(process.resourcesPath, 'ai') : path.join(__dirname, '..', 'tools', 'lite', 'ai');
const AI_EXE = path.join(AI_DIR, 'llama-server.exe');
const LIGHT_MODEL = path.join(AI_DIR, 'model-light.gguf');
/** Modèle plus précis, téléchargé à la demande (Qwen3-4B-Instruct, ~2,5 Go). */
const PRECISE = {
  file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  size: 2497281120,
};
const userFile = (...p) => path.join(app.getPath('userData'), ...p);
const preciseModelPath = () => userFile('models', PRECISE.file);
const settingsPath = () => userFile('ai-settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; } };
const writeSettings = (s) => { try { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(s)); } catch { /* disque en lecture seule */ } };
const preciseInstalled = () => { try { return fs.statSync(preciseModelPath()).size === PRECISE.size; } catch { return false; } };

/** @type {import('child_process').ChildProcess | null} */
let llama = null;
let aiState = 'missing'; // missing | starting | ready | error
let aiModel = 'light'; // light | precise
let aiError = '';
let llamaLog = '';

/** Nombre de threads de calcul : on garde de la marge pour l'interface (et on plafonne : au-delà de ~8, aucun gain). */
function aiThreads() {
  const n = os.cpus().length;
  return Math.min(8, Math.max(2, n - 2));
}

function stopLlama() {
  const p = llama;
  llama = null;
  if (p && !p.killed) { try { p.kill(); } catch { /* déjà arrêté */ } }
}

function startLlama() {
  stopLlama();
  const wantPrecise = readSettings().model === 'precise' && preciseInstalled();
  aiModel = wantPrecise ? 'precise' : 'light';
  const model = wantPrecise ? preciseModelPath() : LIGHT_MODEL;
  if (!fs.existsSync(AI_EXE) || !fs.existsSync(model)) { aiState = 'missing'; aiError = 'Moteur ou modèle introuvable.'; return; }
  aiState = 'starting';
  aiError = '';
  llamaLog = '';
  const p = spawn(AI_EXE, [
    '-m', model, '--host', '127.0.0.1', '--port', String(AI_PORT),
    '-c', '6144', '-t', String(aiThreads()), '--reasoning', 'off', '--no-webui', '-np', '1',
  ], { cwd: AI_DIR, windowsHide: true });
  llama = p;
  const keep = (d) => { llamaLog = (llamaLog + d).slice(-4000); };
  p.stdout.on('data', keep);
  p.stderr.on('data', keep);
  const poll = setInterval(async () => {
    if (llama !== p) return clearInterval(poll);
    try {
      const r = await fetch(`http://127.0.0.1:${AI_PORT}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.status === 200) { clearInterval(poll); aiState = 'ready'; }
    } catch { /* pas encore prêt */ }
  }, 500);
  p.on('exit', (code) => {
    clearInterval(poll);
    if (llama !== p) return; // arrêt volontaire (changement de modèle, fermeture)
    llama = null;
    aiState = 'error';
    aiError = `Le moteur d'IA s'est arrêté (code ${code}). ${llamaLog.split('\n').filter(Boolean).slice(-2).join(' ')}`;
  });
}

ipcMain.on('edition', (e) => { e.returnValue = EDITION; });
ipcMain.handle('ai-status', () => ({ state: aiState, model: aiModel, error: aiError }));
ipcMain.handle('ai-info', () => ({
  model: aiModel,
  preciseInstalled: preciseInstalled(),
  preciseSizeGB: +(PRECISE.size / 1e9).toFixed(1),
  ramGB: Math.round(os.totalmem() / 1e9),
  threads: aiThreads(),
}));

// ---- téléchargement du modèle précis (reprise possible) ----
let dl = null; // { abort: AbortController }
ipcMain.handle('ai-upgrade', async (e) => {
  if (dl) return { ok: false, error: 'Téléchargement déjà en cours.' };
  const target = preciseModelPath();
  const part = target + '.part';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const ctl = new AbortController();
  dl = { abort: ctl };
  const send = (p) => { if (!e.sender.isDestroyed()) e.sender.send('ai-upgrade-progress', p); };
  try {
    if (preciseInstalled()) { writeSettings({ ...readSettings(), model: 'precise' }); startLlama(); return { ok: true }; }
    let have = 0;
    try { have = fs.statSync(part).size; } catch { /* nouveau téléchargement */ }
    if (have >= PRECISE.size) { fs.rmSync(part, { force: true }); have = 0; }
    const res = await fetch(PRECISE.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctl.signal });
    if (!res.ok && res.status !== 206) throw new Error(`Serveur de téléchargement : ${res.status}`);
    if (res.status === 200) have = 0; // le serveur ignore la reprise : on repart de zéro
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    let done = have, last = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      done += value.length;
      const now = Date.now();
      if (now - last > 300) { last = now; send({ done, total: PRECISE.size }); }
    }
    await new Promise((r) => out.end(r));
    if (fs.statSync(part).size !== PRECISE.size) throw new Error('Téléchargement incomplet. Relance-le pour reprendre.');
    fs.renameSync(part, target);
    send({ done: PRECISE.size, total: PRECISE.size });
    writeSettings({ ...readSettings(), model: 'precise' });
    startLlama();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: ctl.signal.aborted ? 'Téléchargement annulé (il reprendra où il s’est arrêté).' : String(err.message ?? err) };
  } finally {
    dl = null;
  }
});
ipcMain.handle('ai-upgrade-cancel', () => { dl?.abort.abort(); return true; });
ipcMain.handle('ai-downgrade', () => { writeSettings({ ...readSettings(), model: 'light' }); startLlama(); return true; });

// ====================================================================
//  Fenêtre
// ====================================================================
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: LITE ? 'EasyGeo Lite' : 'EasyGeo',
    backgroundColor: '#f5f6fa',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });

  win.on('page-title-updated', (e) => e.preventDefault()); // garde « EasyGeo Lite » dans la barre de titre

  // Micro autorisé pour le mode vocal ; le reste est refusé.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' && !LITE));

  if (process.env.EASYGEO_DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

Menu.setApplicationMenu(null);

// Une seule fenêtre : relancer l'application ramène la fenêtre existante.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    if (LITE) startLlama(); else startWhisper();
    createWindow();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { whisper?.kill(); stopLlama(); });
