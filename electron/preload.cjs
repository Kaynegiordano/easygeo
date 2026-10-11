// Pont sécurisé entre la page et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easygeo', {
  edition: ipcRenderer.sendSync('edition'),
  // voix (édition full)
  transcribe: (wav) => ipcRenderer.invoke('transcribe', wav),
  whisperStatus: () => ipcRenderer.invoke('whisper-status'),
  // IA embarquée (édition lite)
  aiStatus: () => ipcRenderer.invoke('ai-status'),
  aiInfo: () => ipcRenderer.invoke('ai-info'),
  aiUpgrade: () => ipcRenderer.invoke('ai-upgrade'),
  aiUpgradeCancel: () => ipcRenderer.invoke('ai-upgrade-cancel'),
  aiDowngrade: () => ipcRenderer.invoke('ai-downgrade'),
  onAiUpgradeProgress: (cb) => {
    const f = (_e, p) => cb(p);
    ipcRenderer.on('ai-upgrade-progress', f);
    return () => ipcRenderer.removeListener('ai-upgrade-progress', f);
  },
});
