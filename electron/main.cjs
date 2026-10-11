// Fenêtre Electron d'EasyGeo : charge le build Vite (dist/) ou le serveur de dev.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'EasyGeo',
    backgroundColor: '#f5f6fa',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  win.on('page-title-updated', (e) => e.preventDefault()); // garde « EasyGeo » dans la barre de titre

  // Aucune autorisation spéciale (micro, caméra, etc.) : l'application n'en a pas besoin.
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

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
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
