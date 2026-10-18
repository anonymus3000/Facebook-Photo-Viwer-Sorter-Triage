const { ipcRenderer } = require('electron');
const $ = id => document.getElementById(id);
const wv = $('wv');

const HANDLED = new Set(['d', 'a', 'e', 'q', 'x', 'z', 'u', 'o', ' ']);
const FILTERS = {
  all: () => true,
  saved: s => s === 1,
  discarded: s => s === 2,
  unreviewed: s => s === 0,
};
const CHIPS = [
  ['Unreviewed', 'bg-slate-700 text-slate-200'],
  ['Saved', 'bg-emerald-500/20 text-emerald-300'],
  ['Discarded', 'bg-rose-500/20 text-rose-300'],
];

// status: 0 = unreviewed, 1 = saved, 2 = discarded
let S = { urls: [], status: [], cur: 0, history: [], filter: 'all' };
let hotkeysOn = true;
let saveTimer = null;

// ---------- persistence ----------
const serialize = () => JSON.stringify({
  v: 1, urls: S.urls, status: S.status.join(''), cur: S.cur, history: S.history, filter: S.filter,
});

function applyState(o) {
  if (!o || !Array.isArray(o.urls) || typeof o.status !== 'string' || o.status.length !== o.urls.length) {
    throw new Error('Not a valid progress file');
  }
  S = {
    urls: o.urls,
    status: o.status.split('').map(Number),
    cur: Math.min(Math.max(o.cur | 0, 0), Math.max(o.urls.length - 1, 0)),
    history: Array.isArray(o.history) ? o.history : [],
    filter: FILTERS[o.filter] ? o.filter : 'all',
  };
  wv.dataset.url = '';
  render();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (S.urls.length) ipcRenderer.send('state:save', serialize());
  }, 150);
}
window.addEventListener('beforeunload', () => {
  if (S.urls.length) ipcRenderer.sendSync('state:save-sync', serialize());
});

// ---------- rendering ----------
function render() {
  const n = S.urls.length;
  let sv = 0, dc = 0;
  for (const s of S.status) { if (s === 1) sv++; else if (s === 2) dc++; }
  const un = n - sv - dc;

  $('progress').textContent = `${n ? S.cur + 1 : 0} / ${n}`;
  $('saved').textContent = sv;
  $('discarded').textContent = dc;
  $('unreviewed').textContent = un;

  const inView = { all: n, saved: sv, discarded: dc, unreviewed: un }[S.filter];
  $('viewcount').textContent = S.filter === 'all' ? '' : `${inView} link${inView === 1 ? '' : 's'} in this view`;
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('seg-on', b.dataset.filter === S.filter));

  $('empty').classList.toggle('hidden', n > 0);
  const chip = $('chip');
  if (n) {
    const [label, cls] = CHIPS[S.status[S.cur]];
    chip.textContent = label;
    chip.className = `rounded-md px-2.5 py-1 text-xs font-semibold ${cls}`;
    const url = S.urls[S.cur];
    $('url').textContent = url;
    if (wv.dataset.url !== url) { wv.dataset.url = url; wv.src = url; }
  } else {
    chip.textContent = '';
    $('url').textContent = '—';
  }
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---------- navigation ----------
const matches = i => FILTERS[S.filter](S.status[i]);

function findNext(from, dir) {
  for (let i = from + dir; i >= 0 && i < S.urls.length; i += dir) if (matches(i)) return i;
  return -1;
}

function go(i) {
  if (!S.urls.length) return;
  S.cur = Math.min(Math.max(i, 0), S.urls.length - 1);
  render(); save();
}

function move(n) {
  if (!S.urls.length) return;
  const dir = Math.sign(n);
  let i = S.cur;
  for (let k = 0; k < Math.abs(n); k++) {
    const j = findNext(i, dir);
    if (j < 0) { toast(dir > 0 ? 'End of list' : 'Start of list'); break; }
    i = j;
  }
  go(i);
}

function mark(st) {
  if (!S.urls.length) return;
  S.history.push({ i: S.cur, p: S.status[S.cur] });
  if (S.history.length > 2000) S.history.splice(0, S.history.length - 2000);
  S.status[S.cur] = st;
  const j = findNext(S.cur, 1);
  if (j >= 0) S.cur = j; else toast('End of list');
  render(); save();
}

function undo() {
  const h = S.history.pop();
  if (!h) return toast('Nothing to undo');
  S.status[h.i] = h.p;
  S.cur = h.i;
  render(); save();
  toast('Undone');
}

function openExternal() {
  if (S.urls.length) ipcRenderer.invoke('external', S.urls[S.cur]);
}

function setFilter(f) {
  const prev = S.filter;
  S.filter = f;
  if (!S.urls.some((_, i) => matches(i))) {
    S.filter = prev;
    return toast('No links in that view yet');
  }
  if (!matches(S.cur)) {
    let j = findNext(S.cur, 1);
    if (j < 0) j = findNext(S.cur, -1);
    if (j >= 0) S.cur = j;
  }
  render(); save();
}

// ---------- hotkeys ----------
function handleKey(k) {
  switch (k) {
    case 'd': return mark(1);
    case 'a': return mark(2);
    case 'e': return move(1);
    case 'q': return move(-1);
    case 'x': return move(10);
    case 'z': return move(-10);
    case 'u': return undo();
    case 'o': case ' ': return openExternal();
  }
}

// Keys pressed while the host page has focus
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return; // typing in "Jump to"
  if (!hotkeysOn || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (HANDLED.has(k)) { e.preventDefault(); handleKey(k); }
});
// Keys pressed while the Facebook webview has focus (forwarded by main.js)
ipcRenderer.on('hotkey', (_e, k) => { if (hotkeysOn) handleKey(k); });

// Drop button focus after clicks so Space never "clicks" a focused button
document.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });

// ---------- Jump to ----------
$('jump').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const n = parseInt(e.target.value, 10);
  if (!S.urls.length) return toast('Load a list first');
  if (!(n >= 1 && n <= S.urls.length)) return toast(`Enter a number from 1 to ${S.urls.length}`);
  go(n - 1);
  e.target.value = '';
  e.target.blur();
});

// ---------- file actions ----------
async function loadText() {
  const text = await ipcRenderer.invoke('file:open', 'txt');
  if (text == null) return;
  const urls = text.split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
  if (!urls.length) return toast('No http(s) links found in that file');
  if (S.urls.length && S.status.some(Boolean) && !confirm('Replace the current list and discard its progress?')) return;
  S = { urls, status: new Array(urls.length).fill(0), cur: 0, history: [], filter: 'all' };
  wv.dataset.url = '';
  render(); save();
  toast(`Loaded ${urls.length} links`);
}

async function exportSaved() {
  const saved = S.urls.filter((_, i) => S.status[i] === 1);
  if (!saved.length) return toast('No saved links to export yet');
  const p = await ipcRenderer.invoke('file:save', { name: 'saved-links.txt', kind: 'txt', content: saved.join('\n') + '\n' });
  if (p) toast(`Exported ${saved.length} links`);
}

async function saveJson() {
  if (!S.urls.length) return toast('Nothing to save yet');
  const p = await ipcRenderer.invoke('file:save', { name: 'triage-progress.json', kind: 'json', content: serialize() });
  if (p) toast('Progress saved');
}

async function resumeJson() {
  const text = await ipcRenderer.invoke('file:open', 'json');
  if (text == null) return;
  try { applyState(JSON.parse(text)); save(); toast('Progress restored'); }
  catch (err) { toast(err.message); }
}

$('btnLoad').onclick = $('btnLoadBig').onclick = loadText;
$('btnExport').onclick = exportSaved;
$('btnSaveJson').onclick = saveJson;
$('btnResume').onclick = resumeJson;
$('btnExternal').onclick = openExternal;
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => setFilter(b.dataset.filter));

$('btnPause').onclick = () => {
  hotkeysOn = !hotkeysOn;
  ipcRenderer.send('hotkeys', hotkeysOn);
  $('btnPause').textContent = hotkeysOn ? 'Pause hotkeys (for login)' : 'Resume hotkeys';
  $('pausedNote').classList.toggle('hidden', hotkeysOn);
};

// ---------- webview feedback ----------
wv.addEventListener('did-start-loading', () => $('loading').classList.remove('hidden'));
wv.addEventListener('did-stop-loading', () => $('loading').classList.add('hidden'));
wv.addEventListener('did-fail-load', e => {
  if (e.isMainFrame && e.errorCode !== -3) toast(`Page failed to load: ${e.errorDescription}`);
});

// ---------- startup: restore last session ----------
(async () => {
  const raw = await ipcRenderer.invoke('state:load');
  if (raw) { try { applyState(JSON.parse(raw)); toast('Restored your last session'); } catch { /* ignore corrupt file */ } }
  render();
})();
