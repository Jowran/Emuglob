const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const { romHash } = require('./romhash');
const { identify } = require('./discid');
const { SaveVault } = require('./saves');
const { DiscordPresence } = require('./discord');

let win;
let vault = null;
const getVault = () => vault || (vault = new SaveVault(path.join(app.getPath('userData'), 'saves')));
const discord = new DiscordPresence((m) => embedLog(m));
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const coverDir = () => path.join(app.getPath('userData'), 'covers');
const raCacheDir = () => path.join(app.getPath('userData'), 'ra-cache');
const backupDir = () => path.join(app.getPath('userData'), 'backups');
const winStatePath = () => path.join(app.getPath('userData'), 'window.json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const listBackupFiles = () => { try { return fs.readdirSync(backupDir()).filter((f) => /^config-.*\.json$/.test(f)).sort(); } catch { return []; } };

// lecture : si le fichier est présent mais illisible, on reprend la dernière sauvegarde valable plutôt que de repartir d'une bibliothèque vide
const readCfg = () => {
  try { return readJson(cfgPath()); } catch (err) {
    if (fs.existsSync(cfgPath())) {
      for (const f of listBackupFiles().reverse()) {
        try { const d = readJson(path.join(backupDir(), f)); embedLog(`config illisible (${err.message}) : reprise de ${f}`); return d; } catch { /* sauvegarde suivante */ }
      }
    }
    return { ralibretro: '', games: [] };
  }
};

function backupNow(tag) {
  try {
    if (!fs.existsSync(cfgPath())) return;
    fs.mkdirSync(backupDir(), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    fs.copyFileSync(cfgPath(), path.join(backupDir(), `config-${stamp}${tag ? '-' + tag : ''}.json`));
    const all = listBackupFiles();
    while (all.length > 10) fs.unlinkSync(path.join(backupDir(), all.shift()));
  } catch { /* la sauvegarde est un plus */ }
}
function maybeBackup() {   // une sauvegarde automatique au plus toutes les 6 heures (10 conservées)
  const files = listBackupFiles();
  if (files.length) {
    try { if (Date.now() - fs.statSync(path.join(backupDir(), files[files.length - 1])).mtimeMs < 6 * 3600 * 1000) return; } catch { /* on sauvegarde */ }
  }
  backupNow('');
}
function writeConfig(data) {   // écriture atomique : un plantage en cours d'écriture ne peut plus corrompre la bibliothèque
  fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
  const tmp = cfgPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, cfgPath());
}

// ---------- fenêtre : mémorise taille et position ----------
const onScreen = (b) => screen.getAllDisplays().some((d) => {
  const a = d.workArea;
  return b.x < a.x + a.width - 50 && b.x + b.width > a.x + 50 && b.y < a.y + a.height - 50 && b.y + b.height > a.y + 50;
});
function saveWinState() {
  if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
  try { fs.writeFileSync(winStatePath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* ignoré */ }
}
function createWindow() {
  let st = null;
  try { st = readJson(winStatePath()); } catch { /* première ouverture */ }
  const opts = {
    width: 1400, height: 820, backgroundColor: '#140e3a', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  };
  if (st && st.width >= 600 && st.height >= 400) {
    opts.width = st.width; opts.height = st.height;
    if (Number.isFinite(st.x) && Number.isFinite(st.y) && onScreen(st)) { opts.x = st.x; opts.y = st.y; }   // jamais hors écran (second écran débranché)
  }
  win = new BrowserWindow(opts);
  win.setMenuBarVisibility(false);
  if (st && st.maximized) win.maximize();
  if (readCfg().startFullscreen) win.setFullScreen(true);
  let t;
  const later = () => { clearTimeout(t); t = setTimeout(saveWinState, 500); };
  win.on('resize', later); win.on('move', later); win.on('close', saveWinState);
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

let saveLockedUntil = 0;   // empêche l'ancienne configuration en mémoire d'écraser une restauration / un import
ipcMain.handle('config:load', () => readCfg());
ipcMain.handle('config:save', (_e, data) => {
  if (Date.now() < saveLockedUntil) return true;
  maybeBackup();
  writeConfig(data);
  return true;
});

ipcMain.handle('backups:list', () => listBackupFiles().reverse().map((f) => {
  const p = path.join(backupDir(), f);
  let games = null;
  try { games = (readJson(p).games || []).length; } catch { /* illisible */ }
  return { name: f, mtime: fs.statSync(p).mtimeMs, games };
}));
ipcMain.handle('backups:restore', (_e, name) => {
  if (!/^config-[\w-]+\.json$/.test(name)) return { ok: false, error: 'nom invalide' };
  try {
    const d = readJson(path.join(backupDir(), name));
    if (!Array.isArray(d.games)) throw new Error('sauvegarde sans liste de jeux');
    backupNow('avant-restauration');
    saveLockedUntil = Date.now() + 5000;
    writeConfig(d);
    win.webContents.reloadIgnoringCache();
    return { ok: true, games: d.games.length };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('backups:export', async () => {
  const r = await dialog.showSaveDialog(win, { title: 'Exporter la configuration', defaultPath: 'emuglob-config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return { ok: false, canceled: true };
  try { fs.copyFileSync(cfgPath(), r.filePath); return { ok: true, path: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('backups:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Importer une configuration', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return { ok: false, canceled: true };
  try {
    const d = readJson(r.filePaths[0]);
    if (!Array.isArray(d.games)) throw new Error('fichier sans liste de jeux');
    backupNow('avant-import');
    saveLockedUntil = Date.now() + 5000;
    writeConfig(d);
    win.webContents.reloadIgnoringCache();
    return { ok: true, games: d.games.length };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('dialog:files', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Ajouter des jeux', properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:exe', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choisir l'exécutable", properties: ['openFile'],
    filters: [{ name: 'Exécutable', extensions: ['exe'] }, { name: 'Tous', extensions: ['*'] }],
  });
  return r.canceled ? '' : r.filePaths[0];
});

async function pickImage(title, prefix) {
  const r = await dialog.showOpenDialog(win, {
    title, properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  if (r.canceled) return '';
  fs.mkdirSync(coverDir(), { recursive: true });
  const dest = path.join(coverDir(), `${prefix}-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase()}`);
  fs.copyFileSync(r.filePaths[0], dest);
  return dest;
}
ipcMain.handle('dialog:cover', (_e, id) => pickImage('Choisir une jaquette', id));
ipcMain.handle('dialog:wallpaper', () => pickImage("Choisir un fond d'écran", 'wallpaper'));

function scanDir(dir, wanted) {
  const files = [];
  const skipped = {};   // gros fichiers (50 Mo et +) dont l'extension n'est pas reconnue : peut-être des jeux
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (wanted.has(ext)) files.push(p);
      else { try { if (fs.statSync(p).size >= 50 * 1024 * 1024) skipped[ext || '(sans extension)'] = (skipped[ext || '(sans extension)'] || 0) + 1; } catch { /* ignoré */ } }
    }
  };
  walk(dir);
  return { files, skipped };
}
ipcMain.handle('scan:folder', async (_e, extensions) => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossier de ROMs', properties: ['openDirectory'] });
  if (r.canceled) return { files: [], skipped: {}, dir: '' };
  return { ...scanDir(r.filePaths[0], new Set(extensions)), dir: r.filePaths[0] };
});
ipcMain.handle('scan:path', (_e, { dir, extensions }) => (fs.existsSync(dir) ? scanDir(dir, new Set(extensions)) : { files: [], skipped: {}, missing: true }));
ipcMain.handle('files:exist', (_e, paths) => Promise.all(paths.map((p) => fs.promises.access(p).then(() => true, () => false))));
ipcMain.handle('shell:reveal', (_e, p) => { shell.showItemInFolder(p); });

/* ---------- intégration de la fenêtre de l'émulateur dans Emuglob (Windows) ----------
   Un petit programme C# (tools/EmbedHelper.cs) est compilé au premier usage avec le csc.exe de Windows, puis piloté en texte (stdin/stdout). */
const embedLogPath = () => path.join(app.getPath('userData'), 'embed.log');
function embedLog(msg) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(embedLogPath(), new Date().toISOString() + ' ' + msg + '\n');
  } catch { /* le journal est un plus */ }
}

class Helper {
  constructor(cmd, args, env) {
    this.alive = true; this.buf = ''; this.listeners = new Set();
    this.proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...env } });
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString('utf8');
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        embedLog('module> ' + line);
        for (const f of [...this.listeners]) f(line);
      }
    });
    this.proc.stderr.on('data', (d) => embedLog('module! ' + d.toString().trim()));
    this.proc.on('exit', () => { this.alive = false; });
    this.proc.on('error', (e) => { this.alive = false; embedLog('module erreur : ' + e.message); });
  }
  send(line) { embedLog('->module ' + line); if (this.alive) this.proc.stdin.write(line + '\n'); }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
}

async function compileHelper() {
  const code = fs.readFileSync(path.join(__dirname, 'tools', 'EmbedHelper.cs'));
  const hash = crypto.createHash('md5').update(code).digest('hex').slice(0, 8);
  const dir = path.join(app.getPath('userData'), 'embed');
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, `EmbedHelper-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) throw new Error('compilateur .NET (csc.exe) introuvable');
  const src = path.join(dir, `EmbedHelper-${hash}.cs`);
  fs.writeFileSync(src, code);
  await new Promise((res, rej) =>
    execFile(csc, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${exe}`, src], { windowsHide: true, timeout: 60000 },
      (err, out, errout) => (err ? rej(new Error("compilation du module d'intégration échouée : " + String(out || errout || err.message).slice(0, 300))) : res())));
  embedLog('module compilé : ' + exe);
  return exe;
}

let helperObj = null;
async function getHelper() {
  if (helperObj && helperObj.alive) return helperObj;
  helperObj = null;
  let h;
  if (process.env.EMUGLOB_FAKE_EMBED) h = new Helper(process.execPath, [path.join(__dirname, 'tools', 'fake-embed.js')], { ELECTRON_RUN_AS_NODE: '1' });
  else if (process.platform !== 'win32') throw new Error("l'intégration n'existe que sous Windows");
  else h = new Helper(await compileHelper(), [], {});
  helperObj = h;
  return h;
}

function embedWindow(helper, pid, rect, mode) {
  return new Promise((resolve) => {
    const b = win.getNativeWindowHandle();
    const parent = (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
    let t;
    const off = helper.on((line) => {
      if (line.startsWith('embedded')) { off(); clearTimeout(t); resolve({ ok: true }); }
      else if (line.startsWith('error')) { off(); clearTimeout(t); resolve({ ok: false, reason: line.slice(6) }); }
    });
    t = setTimeout(() => { off(); resolve({ ok: false, reason: 'délai dépassé' }); }, 26000);
    helper.send(`embed ${pid} ${parent} ${rect.x} ${rect.y} ${rect.w} ${rect.h} 20000 ${mode === 'child' ? 'child' : 'overlay'}`);
  });
}

function killTree(pid) {
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(pid); } catch { /* déjà fermé */ } }
}

// Lancement : l'émulateur est intégré à la fenêtre d'Emuglob ; à défaut, Emuglob se met en retrait pendant le jeu.
// Dans les deux cas Emuglob revient tout seul quand l'émulateur se ferme.
const RECOVER = 'CommandOrControl+Shift+E';
let current = null;   // { child, gameId, embedded }
function backToApp() {
  globalShortcut.unregister(RECOVER);
  if (win && !win.isDestroyed()) { win.show(); win.focus(); }
}
ipcMain.handle('game:launch', (_e, { exe, args, gameId, hide, embed, rect, mode, sync }) =>
  new Promise((resolve) => {
    if (!exe || !fs.existsSync(exe)) return resolve({ ok: false, error: 'Exécutable introuvable : ' + exe });
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return resolve({ ok: false, error: 'Arguments invalides.' });
    // sauvegardes partagées : la plus récente (autre émulateur ou coffre Emuglob) est mise en place avant le lancement
    let saves = null;
    if (sync && sync.rom && sync.emu) {
      try { saves = getVault().prepare(sync); } catch (err) { saves = { action: 'error', error: err.message }; }
      embedLog('sauvegardes : ' + JSON.stringify(saves));
    }
    try {
      embedLog(`lancement : ${exe} ${args.join(' ')} (intégration : ${embed ? 'oui, mode ' + (mode || 'overlay') : 'non'})`);
      const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
      child.once('error', (err) => resolve({ ok: false, error: err.message }));
      child.once('spawn', () => {
        child.unref();
        const t0 = Date.now();
        current = { child, gameId, embedded: false, psb: powerSaveBlocker.start('prevent-display-sleep') };   // l'écran ne se met pas en veille (jeu à la manette)
        const legacyHide = () => {
          if (!hide) return;
          // on laisse l'émulateur ouvrir sa fenêtre par-dessus avant de masquer Emuglob (pas de bureau visible entre les deux)
          setTimeout(() => {
            if (child.exitCode === null && win && !win.isDestroyed()) { win.hide(); globalShortcut.register(RECOVER, backToApp); }
          }, 2500);
        };
        child.once('exit', (code) => {
          const seconds = Math.round((Date.now() - t0) / 1000);
          if (current && current.child === child) { try { powerSaveBlocker.stop(current.psb); } catch { /* déjà arrêté */ } current = null; }
          embedLog(`émulateur fermé après ${seconds}s (code ${code})`);
          let saved = null;
          if (sync && sync.rom && sync.emu) {
            try { saved = getVault().collect(sync); } catch (err) { saved = { action: 'error', error: err.message }; }
            embedLog('sauvegarde récupérée : ' + JSON.stringify(saved));
          }
          backToApp();
          if (win && !win.isDestroyed()) win.webContents.send('game:exit', { id: gameId, seconds, short: seconds < 4, code, saved });
        });
        if (embed && rect) {
          (async () => {
            try {
              const helper = await getHelper();
              const r = await embedWindow(helper, child.pid, rect, mode);
              if (!r.ok) throw new Error(r.reason);
              if (current && current.child === child) current.embedded = true;
              if (win && !win.isDestroyed()) win.webContents.send('game:embedded', { ok: true });
            } catch (err) {
              embedLog("échec de l'intégration : " + err.message);
              if (win && !win.isDestroyed()) win.webContents.send('game:embedded', { ok: false, reason: err.message });
              legacyHide();
            }
          })();
          resolve({ ok: true, embedding: true, saves });
        } else {
          legacyHide();
          resolve({ ok: true, embedding: false, saves });
        }
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  })
);
ipcMain.handle('game:move', (_e, r) => { if (helperObj && current && current.embedded) helperObj.send(`move ${r.x} ${r.y} ${r.w} ${r.h}`); });
ipcMain.handle('game:focus', () => { if (helperObj && current && current.embedded) helperObj.send('focus'); });
ipcMain.handle('game:stop', () => {
  if (!current) return;
  const c = current.child;
  if (helperObj && current.embedded) { helperObj.send('close'); setTimeout(() => { if (c.exitCode === null) killTree(c.pid); }, 4000); }   // fermeture douce, puis forcée
  else killTree(c.pid);
});
ipcMain.handle('saves:open', (_e, gameId) => { const d = getVault().dir(String(gameId)); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
ipcMain.handle('discord:set', (_e, { clientId, activity }) => { discord.set(clientId, activity); return discord.status; });
ipcMain.handle('discord:status', () => discord.status);
ipcMain.handle('embed:openlog', () => shell.openPath(embedLogPath()));
app.on('before-quit', () => { discord.close(); if (helperObj && current && current.embedded) helperObj.send('close'); });

ipcMain.handle('win:fullscreen', (_e, force) => {
  const next = typeof force === 'boolean' ? force : !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});
ipcMain.handle('app:quit', () => app.quit());

/* ---------- RetroAchievements (appels faits ici : la clé ne quitte jamais ce processus) ---------- */
const RA_ALLOWED = new Set(['GetUserProfile', 'GetUserRecentAchievements', 'GetGameInfoAndUserProgress', 'GetGameList', 'GetUsersIFollow', 'GetGame', 'GetUserAwards', 'GetUserCompletionProgress']);
const mem = new Map();

ipcMain.handle('ra:call', async (_e, { endpoint, params = {}, ttl = 60 }) => {
  if (!RA_ALLOWED.has(endpoint)) return { ok: false, error: 'Endpoint non autorisé' };
  const ra = readCfg().ra || {};
  if (!ra.user || !ra.key) return { ok: false, error: 'RetroAchievements non configuré' };

  const q = new URLSearchParams();
  q.set('y', ra.key);
  if (endpoint !== 'GetGameList') q.set('u', ra.user);
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));

  const id = [endpoint, ra.user, ...[...q].filter(([k]) => k !== 'y').map(([k, v]) => k + '=' + v)].join('|');
  const hit = mem.get(id);
  if (hit && Date.now() - hit.t < ttl * 1000) return { ok: true, data: hit.data };

  const diskFile = endpoint === 'GetGameList' ? path.join(raCacheDir(), `list-${params.i}-${params.h ? 'h' : 'n'}.json`) : null;
  if (diskFile && ttl > 0) {
    try {
      const st = fs.statSync(diskFile);
      if (Date.now() - st.mtimeMs < ttl * 1000) {
        const data = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
        mem.set(id, { t: Date.now(), data });
        return { ok: true, data };
      }
    } catch { /* pas de cache disque */ }
  }

  try {
    const res = await fetch(`https://retroachievements.org/API/API_${endpoint}.php?${q}`, {
      signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': 'Emuglob-Launcher/1.0' },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Pseudo ou clé API refusés' };
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    mem.set(id, { t: Date.now(), data });
    if (diskFile) {
      fs.mkdirSync(raCacheDir(), { recursive: true });
      fs.writeFileSync(diskFile, JSON.stringify(data));
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'Délai dépassé' : err.message };
  }
});

/* ---------- reconnaissance des jeux et jaquettes ---------- */
ipcMain.handle('game:hash', (_e, { file, system }) => {
  try { return romHash(file, system); } catch { return ''; }
});

// liste des jaquettes disponibles dans le dépôt libretro-thumbnails d'une console (cache 30 jours)
ipcMain.handle('thumbs:list', async (_e, folder) => {
  const repo = String(folder).replace(/ /g, '_');
  const file = path.join(raCacheDir(), `thumbs-${repo}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 30 * 86400 * 1000) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { /* pas de cache */ }
  try {
    const res = await fetch(`https://api.github.com/repos/libretro-thumbnails/${encodeURIComponent(repo)}/git/trees/master?recursive=1`, {
      signal: AbortSignal.timeout(40000),
      headers: { 'User-Agent': 'Emuglob-Launcher/1.0', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const names = (d.tree || []).filter((x) => x.path.startsWith('Named_Boxarts/') && x.path.endsWith('.png')).map((x) => x.path.slice(14, -4));
    if (!names.length) return null;
    fs.mkdirSync(raCacheDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(names));
    return names;
  } catch {
    return null;
  }
});

// télécharge une jaquette dans le dossier de l'app (hôtes autorisés uniquement)
ipcMain.handle('cover:download', async (_e, { url, id }) => {
  if (!/^https:\/\/(raw\.githubusercontent\.com\/(libretro-thumbnails|xlenore)\/|media\.retroachievements\.org\/|art\.gametdb\.com\/)/.test(url)) return '';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Emuglob-Launcher/1.0' } });
    if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return '';
    fs.mkdirSync(coverDir(), { recursive: true });
    const dest = path.join(coverDir(), `${String(id).replace(/[^a-z0-9]/gi, '')}-auto.png`);
    fs.writeFileSync(dest, buf);
    return dest;
  } catch {
    return '';
  }
});

// identifie une image disque (Wii, GameCube, PS1, PS2, PSP) ou une ROM DS : plateforme + numéro de série
ipcMain.handle('game:identify', (_e, file) => {
  try { return identify(file); } catch { return { platform: 'unknown', id: '' }; }
});

// cores libretro réellement présents dans le dossier Cores de RALibretro (à côté de son exe)
ipcMain.handle('cores:installed', (_e, exe) => {
  try {
    const dir = path.join(path.dirname(exe), 'Cores');
    return fs.readdirSync(dir).filter((f) => /_libretro\.(dll|so|dylib)$/i.test(f)).map((f) => f.replace(/\.(dll|so|dylib)$/i, ''));
  } catch {
    return [];
  }
});

ipcMain.handle('game:status', () => ({ playing: !!current, awake: !!(current && powerSaveBlocker.isStarted(current.psb)) }));

/* ---------- informations, démarrage avec Windows, mise à jour depuis un fichier ---------- */
const buildInfo = () => { try { return readJson(path.join(__dirname, 'build-info.json')); } catch { return {}; } };
const updTarget = () => process.env.EMUGLOB_UPDATE_TARGET || path.join(process.resourcesPath, 'app.asar');
const canUpdate = () => app.isPackaged || !!process.env.EMUGLOB_UPDATE_TARGET;
ipcMain.handle('app:info', () => ({
  built: buildInfo().built || '', version: app.getVersion(), packaged: canUpdate(),
  hasBackup: canUpdate() && fs.existsSync(updTarget() + '.bak'),
  autostart: app.getLoginItemSettings().openAtLogin,
}));
ipcMain.handle('app:autostart', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath }); return app.getLoginItemSettings().openAtLogin; });

// vérifie qu'un fichier est bien un app.asar d'Emuglob (en-tête asar + fichiers indispensables)
function asarFiles(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (head.readUInt32LE(0) !== 4) throw new Error("ce n'est pas un fichier asar");
    const len = head.readUInt32LE(12);
    if (len < 2 || len > 50 * 1024 * 1024) throw new Error('en-tête asar invalide');
    const json = Buffer.alloc(len);
    fs.readSync(fd, json, 0, len, 16);
    return JSON.parse(json.toString('utf8')).files || {};
  } finally { fs.closeSync(fd); }
}
function launchUpdater(src) {
  const script = path.join(app.getPath('userData'), 'apply-update.js');
  fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'tools', 'apply-update.js')));   // copié hors de l'asar : celui-ci sera remplacé pendant l'exécution
  spawn(process.execPath, [script, String(process.pid), src, updTarget(), process.env.EMUGLOB_UPDATE_EXE || process.execPath], {
    detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).unref();
  setTimeout(() => app.quit(), 300);
}
ipcMain.handle('update:pick', async () => {
  if (!canUpdate()) return { ok: false, error: "disponible seulement dans l'application installée (pas en mode développement)" };
  const r = await dialog.showOpenDialog(win, { title: 'Choisir le nouvel app.asar', properties: ['openFile'], filters: [{ name: 'app.asar', extensions: ['asar'] }] });
  if (r.canceled) return { ok: false, canceled: true };
  try {
    const files = asarFiles(r.filePaths[0]);
    for (const need of ['main.js', 'index.html', 'preload.js', 'package.json']) if (!files[need]) throw new Error(`il manque ${need} : ce n'est pas un app.asar d'Emuglob`);
    return { ok: true, path: r.filePaths[0], size: fs.statSync(r.filePaths[0]).size };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update:apply', (_e, src) => {
  if (!canUpdate()) return { ok: false, error: "disponible seulement dans l'application installée" };
  try { asarFiles(src); launchUpdater(src); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
/* ---------- recherche de mises à jour en ligne (Releases GitHub) ---------- */
// Repo PUBLIC qui porte les Releases (ce repo) (aucun token : l'API ne voit pas les Releases d'un repo privé).
// Chaque Release doit avoir un tag « vX.Y.Z » supérieur à la version de package.json et, pour une mise à jour automatique, un fichier « app.asar » attaché.
const UPDATE_REPO = process.env.EMUGLOB_UPDATE_REPO || 'Jowran/emuglob';
const verParts = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const newerThan = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
async function ghFetch(url, accept) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Emuglob-updater', Accept: accept || 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) throw new Error('aucune version publiée (ou repo introuvable/privé)');
  if (r.status === 403 || r.status === 429) throw new Error('GitHub limite les requêtes, réessaie plus tard');
  if (!r.ok) throw new Error('GitHub a répondu ' + r.status);
  return r;
}
let lastRelease = null;
ipcMain.handle('update:check', async () => {
  try {
    const rel = await (await ghFetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`)).json();
    const asar = (rel.assets || []).find((a) => a.name === 'app.asar');
    lastRelease = rel;
    return {
      ok: true, current: app.getVersion(), latest: String(rel.tag_name || '').replace(/^v/i, ''),
      available: newerThan(rel.tag_name, app.getVersion()), name: rel.name || rel.tag_name, notes: rel.body || '',
      url: rel.html_url, auto: !!asar && canUpdate(), size: asar ? asar.size : 0,
    };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update:download', async () => {
  if (!canUpdate()) return { ok: false, error: "disponible seulement dans l'application installée" };
  const rel = lastRelease;
  const asset = rel && (rel.assets || []).find((a) => a.name === 'app.asar');
  if (!asset) return { ok: false, error: "cette version n'a pas de fichier app.asar : télécharge-la à la main" };
  try {
    const ofs = require('original-fs');   // écriture d'un fichier .asar sans la « magie asar » d'Electron
    const dir = path.join(app.getPath('userData'), 'update');
    ofs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(await (await ghFetch(asset.browser_download_url, 'application/octet-stream')).arrayBuffer());
    if (asset.size && buf.length !== asset.size) throw new Error('téléchargement incomplet');
    const want = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
    if (want && crypto.createHash('sha256').update(buf).digest('hex') !== want[1].toLowerCase()) throw new Error('fichier corrompu (empreinte SHA-256 différente)');
    const file = path.join(dir, `app-${String(rel.tag_name).replace(/[^\w.-]/g, '')}.bin`);
    ofs.writeFileSync(file, buf);
    const files = asarFiles(file);
    for (const need of ['main.js', 'index.html', 'preload.js', 'package.json']) if (!files[need]) throw new Error(`il manque ${need} : ce n'est pas un app.asar d'Emuglob`);
    launchUpdater(file);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update:page', () => { if (lastRelease && /^https:\/\/github\.com\//.test(lastRelease.html_url)) shell.openExternal(lastRelease.html_url); });
ipcMain.handle('update:rollback', () => {
  const bak = updTarget() + '.bak';
  if (!canUpdate() || !fs.existsSync(bak)) return { ok: false, error: 'aucune version précédente' };
  try { launchUpdater(bak); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
