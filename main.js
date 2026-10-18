const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

const PARTITION = 'persist:facebook'; // keeps your Facebook login between launches
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HANDLED = new Set(['d', 'a', 'e', 'q', 'x', 'z', 'u', 'o', ' ']);
const stateFile = () => path.join(app.getPath('userData'), 'triage-state.json');

let win;
let hotkeysOn = true;

// Remove frame-blocking headers so pages also work inside iframes.
function relaxSession(ses) {
  ses.setUserAgent(UA);
  ses.webRequest.onHeadersReceived((details, cb) => {
    const h = details.responseHeaders || {};
    for (const k of Object.keys(h)) {
      const l = k.toLowerCase();
      if (l === 'x-frame-options') delete h[k];
      if (l === 'content-security-policy') {
        h[k] = h[k].map(v => v.replace(/frame-ancestors[^;]*;?/gi, ''));
      }
    }
    cb({ responseHeaders: h });
  });
}

function writeState(json) {
  const tmp = stateFile() + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, stateFile()); // atomic: a crash never leaves a half-written file
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: '#0b0f17',
    title: 'FB Photo Triage',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      webviewTag: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  // Guest page (the Facebook <webview>) gets web security off but no Node access.
  win.webContents.on('will-attach-webview', (_e, prefs) => {
    prefs.webSecurity = false;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
  });

  // Keys pressed while the webview has focus never reach the host page,
  // so intercept them here and forward them to the renderer.
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('before-input-event', (event, input) => {
      if (!hotkeysOn || input.type !== 'keyDown') return;
      if (input.control || input.meta || input.alt) return;
      const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
      if (HANDLED.has(k)) {
        event.preventDefault();
        win.webContents.send('hotkey', k);
      }
    });
  });
}

app.whenReady().then(() => {
  relaxSession(session.defaultSession);
  relaxSession(session.fromPartition(PARTITION));
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------
ipcMain.handle('state:load', () => {
  try { return fs.readFileSync(stateFile(), 'utf8'); } catch { return null; }
});
ipcMain.on('state:save', (_e, json) => { try { writeState(json); } catch (err) { console.error(err); } });
ipcMain.on('state:save-sync', (e, json) => { try { writeState(json); } catch (err) { console.error(err); } e.returnValue = true; });

ipcMain.on('hotkeys', (_e, on) => { hotkeysOn = !!on; });

ipcMain.handle('external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('file:open', async (_e, kind) => {
  const filters = kind === 'json'
    ? [{ name: 'JSON', extensions: ['json'] }]
    : [{ name: 'Text', extensions: ['txt'] }];
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});

ipcMain.handle('file:save', async (_e, { name, kind, content }) => {
  const filters = kind === 'json'
    ? [{ name: 'JSON', extensions: ['json'] }]
    : [{ name: 'Text', extensions: ['txt'] }];
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content);
  return r.filePath;
});
