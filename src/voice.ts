// Mode vocal : enregistrement micro → WAV 16 kHz → Whisper local ; lecture des réponses à voix haute.

export const WHISPER_URL = 'http://127.0.0.1:8178';

/** Pont fourni par electron/preload.cjs (absent dans un navigateur classique). */
interface Bridge {
  transcribe: (wav: ArrayBuffer) => Promise<string>;
  whisperStatus: () => Promise<'ready' | 'starting' | 'missing' | 'error'>;
}
const bridge = (window as unknown as { easygeo?: Bridge }).easygeo;

export class Recorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;
  private chunks: Float32Array[] = [];
  /** Niveau sonore 0–1, pour animer le bouton. */
  level = 0;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(d));
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      this.level = Math.min(1, Math.sqrt(s / d.length) * 6);
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** Arrête et renvoie le WAV (PCM 16 bits mono 16 kHz). */
  async stop(): Promise<ArrayBuffer> {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    const rate = this.ctx?.sampleRate ?? 16000;
    await this.ctx?.close();
    const n = this.chunks.reduce((s, c) => s + c.length, 0);
    const pcm = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) { pcm.set(c, o); o += c.length; }
    // Normalisation : un micro réglé trop bas est amplifié (Whisper comprend mieux une voix forte).
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak > 0.003 && peak < 0.5) {
      const k = Math.min(30, 0.8 / peak);
      for (let i = 0; i < pcm.length; i++) pcm[i] *= k;
    }
    return encodeWav(pcm, rate);
  }
}

export function encodeWav(pcm: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (off: number, s: string) => [...s].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return buf;
}

/** Vocabulaire donné à Whisper pour bien reconnaître les termes de géométrie. */
export const WHISPER_PROMPT =
  'Géométrie au collège : triangle ABC rectangle en A, segment [AB], droite (AB), milieu, médiatrice, bissectrice, ' +
  'hypoténuse, théorème de Pythagore, Thalès, cosinus, cercle circonscrit, symétrique, translation, rotation, perpendiculaire, parallèle, parallélogramme, losange.';

export async function transcribe(wav: ArrayBuffer): Promise<string> {
  if (bridge) return bridge.transcribe(wav);
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'voix.wav');
  fd.append('response_format', 'json');
  fd.append('language', 'fr');
  fd.append('temperature', '0');
  fd.append('prompt', WHISPER_PROMPT);
  const r = await fetch(`${WHISPER_URL}/inference`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Whisper : ${r.status}`);
  return cleanTranscript(((await r.json()) as { text?: string }).text ?? '');
}

export async function whisperStatus(): Promise<'ready' | 'starting' | 'missing' | 'error'> {
  if (bridge) return bridge.whisperStatus();
  try {
    const r = await fetch(WHISPER_URL, { signal: AbortSignal.timeout(1500) });
    return r.ok ? 'ready' : 'error';
  } catch { return 'missing'; }
}

/** Nettoie la transcription : espaces, marqueurs [Musique], « A B » → « AB »… */
export function cleanTranscript(s: string) {
  return s
    .replace(/\[[^\]]*\]|\([^)]*musique[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- synthèse vocale ----------

let voice: SpeechSynthesisVoice | null | undefined;
function frenchVoice() {
  if (voice !== undefined && voice) return voice;
  const all = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('fr'));
  // Voix « naturelles » d'abord (Denise, Henri…), puis Hortense / Julie / Paul.
  voice = all.find((v) => /natural|online/i.test(v.name)) ?? all.find((v) => /denise|hortense|julie/i.test(v.name)) ?? all[0] ?? null;
  return voice;
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { voice = undefined; };

/** Texte adapté à l'oral : notations mathématiques lues correctement. */
export function toSpeech(s: string) {
  return s
    .replace(/\*\*|`|#+/g, '')
    .replace(/\[([A-Z]'?)([A-Z]'?)\]/g, 'le segment $1 $2')
    .replace(/\(([A-Z]'?)([A-Z]'?)\)/g, 'la droite $1 $2')
    .replace(/([A-Z0-9)])²/g, '$1 au carré')
    .replace(/³/g, ' au cube')
    .replace(/√\s*\(?/g, 'racine de ')
    .replace(/×/g, ' fois ')
    .replace(/÷/g, ' divisé par ')
    .replace(/≈/g, ' environ ')
    .replace(/(\d)\s*°/g, '$1 degrés')
    .replace(/\b([A-Z])([A-Z])([A-Z])?([A-Z])?\b/g, (_m, ...g: string[]) => g.slice(0, 4).filter(Boolean).join(' '))
    .replace(/\b([A-Z])'/g, '$1 prime ')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '');
}

// ---- état « en train de parler » (pour l'interface) ----
let speaking = false;
let session = 0;
const listeners = new Set<(s: boolean) => void>();
const setSpeaking = (s: boolean) => { if (s !== speaking) { speaking = s; listeners.forEach((f) => f(s)); } };
export const onSpeaking = (f: (s: boolean) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const isSpeaking = () => speaking;

/** Découpe en phrases : Chromium coupe net une longue lecture après ~15 s. */
function sentences(s: string) {
  return s.match(/[^.!?:\n]+[.!?:]?/g)?.map((x) => x.trim()).filter((x) => /\p{L}|\d/u.test(x)) ?? [];
}

/** Lit le texte à voix haute (remplace la lecture en cours). */
export function speak(text: string) {
  if (typeof speechSynthesis === 'undefined') return;
  const mine = ++session;
  speechSynthesis.cancel();
  const parts = sentences(toSpeech(text));
  if (!parts.length) { setSpeaking(false); return; }
  setSpeaking(true);
  // Petit délai : lancer speak() juste après cancel() peut faire perdre la lecture.
  setTimeout(() => {
    if (mine !== session) return;
    const v = frenchVoice();
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = 'fr-FR';
      if (v) u.voice = v;
      u.rate = 1.02;
      const done = () => { if (mine === session && i === parts.length - 1) setSpeaking(false); };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }, 60);
}

export const stopSpeaking = () => {
  session++;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  setSpeaking(false);
};
