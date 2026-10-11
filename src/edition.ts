// Édition de l'application : « full » (voix + photo + IA via Ollama) ou « lite »
// (installable partout : IA très légère embarquée, sans voix ni photo).

export interface AiStatus { state: 'missing' | 'starting' | 'ready' | 'error'; model: 'light' | 'precise'; error: string }
export interface AiInfo { model: 'light' | 'precise'; preciseInstalled: boolean; preciseSizeGB: number; ramGB: number; threads: number }
export interface UpgradeProgress { done: number; total: number }

interface Bridge {
  edition?: 'full' | 'lite';
  aiStatus?: () => Promise<AiStatus>;
  aiInfo?: () => Promise<AiInfo>;
  aiUpgrade?: () => Promise<{ ok: boolean; error?: string }>;
  aiUpgradeCancel?: () => Promise<boolean>;
  aiDowngrade?: () => Promise<boolean>;
  onAiUpgradeProgress?: (cb: (p: UpgradeProgress) => void) => () => void;
}

export const bridge = (window as unknown as { easygeo?: Bridge }).easygeo;

/** `?edition=lite` permet d'essayer l'édition Lite dans un navigateur (développement). */
export const LITE = bridge?.edition === 'lite' || new URLSearchParams(location.search).get('edition') === 'lite';

/** Adresse du moteur d'IA embarqué (llama.cpp). */
export const LLAMA_URL = 'http://127.0.0.1:8179';
