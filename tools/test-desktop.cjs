// Démarrage du vrai binaire autonome ; aucune figure ni préférence modifiée.
const path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const app = await _electron.launch({ executablePath: path.join(root, 'release/win-unpacked/EasyGeo.exe') });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.hide()));
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('canvas');
    await page.getByRole('button', { name: 'Règle et compas', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('button[data-tip="Rejouer la construction pas à pas"]').count(), 1);
    const native = await app.evaluate(({ app }) => ({ version: app.getVersion(), path: app.getAppPath(), packaged: app.isPackaged }));
    assert.equal(native.version, require('../package.json').version);
    assert(native.packaged && native.path.includes('app.asar'));
    assert.deepEqual(errors, []);
    console.log('OK EasyGeo autonome : vrai binaire empaqueté, canevas, règle et compas, relecture et aucune erreur JavaScript');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
