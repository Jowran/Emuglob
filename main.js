const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, screen, powerSaveBlocker, protocol, net, nativeImage, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const { romHash } = require('./romhash');
const { identify } = require('./discid');
const { SaveVault, findExisting, importExisting, cemuSaveDir } = require('./saves');
const { DiscordPresence } = require('./discord');
const emucfg = require('./emucfg');

let win;
let vault = null;
const getVault = () => vault || (vault = new SaveVault(path.join(app.getPath('userData'), 'saves')));
const discord = new DiscordPresence((m) => embedLog(m));
// ID public de l'application Discord « Emuglob » (pas un secret) : intégré pour que l'utilisateur n'ait rien à configurer.
const DISCORD_APP_ID = '1572304397411680318';
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const coverDir = () => path.join(app.getPath('userData'), 'covers');
const raCacheDir = () => path.join(app.getPath('userData'), 'ra-cache');
const backupDir = () => path.join(app.getPath('userData'), 'backups');
const winStatePath = () => path.join(app.getPath('userData'), 'window.json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
// ---------- mode portable : données dans data\ à côté de l'exe, chemins du même disque enregistrés en relatif ----------
const PORT_BASE = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
const isPortable = () => fs.existsSync(path.join(PORT_BASE, 'portable.txt'));
const PTOKEN = '$EMUGLOB$';   // préfixe d'un chemin relatif au dossier d'Emuglob (survit à un changement de lettre de lecteur)
const mapStrings = (v, fn) => (typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map((x) => mapStrings(x, fn)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)])) : v);
const sameDrive = (p) => /^[a-z]:[\\/]/i.test(p) && /^[a-z]:/i.test(PORT_BASE) && p[0].toLowerCase() === PORT_BASE[0].toLowerCase();
const compactPath = (s) => (sameDrive(s) ? PTOKEN + path.win32.relative(PORT_BASE, s) : s);
const expandPath = (s) => (s.startsWith(PTOKEN) ? path.resolve(PORT_BASE, s.slice(PTOKEN.length) || '.') : s);
const cfgIn = (d) => mapStrings(d, expandPath);
const cfgOut = (d) => (isPortable() ? mapStrings(d, compactPath) : mapStrings(d, expandPath));
const listBackupFiles = () => { try { return fs.readdirSync(backupDir()).filter((f) => /^config-.*\.json$/.test(f)).sort(); } catch { return []; } };

// lecture : si le fichier est présent mais illisible, on reprend la dernière sauvegarde valable plutôt que de repartir d'une bibliothèque vide
// langue des boîtes de dialogue : celle choisie dans Emuglob, sinon celle du système
const L = (fr, en) => { let l = ''; try { l = readCfg().lang; } catch { /* config illisible */ } if (l !== 'fr' && l !== 'en') l = /^fr/i.test(app.getLocale()) ? 'fr' : 'en'; return l === 'en' ? en : fr; };
const readCfg = () => {
  try { return cfgIn(readJson(cfgPath())); } catch (err) {
    if (fs.existsSync(cfgPath())) {
      for (const f of listBackupFiles().reverse()) {
        try { const d = cfgIn(readJson(path.join(backupDir(), f))); embedLog(`config illisible (${err.message}) : reprise de ${f}`); return d; } catch { /* sauvegarde suivante */ }
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
  fs.writeFileSync(tmp, JSON.stringify(cfgOut(data), null, 2), 'utf-8');
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
// fond de la fenêtre avant le premier affichage, assorti au thème (évite un flash sombre en thème clair)
const START_BG = { neon: '#080418', oled: '#000000', crt: '#0b0700', clair: '#eef2f7', pastel: '#f3eaff' };
function createWindow() {
  let st = null;
  try { st = readJson(winStatePath()); } catch { /* première ouverture */ }
  const opts = {
    width: 1400, height: 820, backgroundColor: START_BG[(() => { try { return readCfg().theme; } catch { return ''; } })()] || '#140e3a', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'logo.ico' : 'logo.png'),   // logo Emuglob (barre des tâches, fenêtre)
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
  // l'écran de chargement (fenêtre séparée) suit la fenêtre quand on la déplace ou la redimensionne
  // (regroupé, seulement une fois l'écran affiché et seulement si la position change vraiment : sous Windows, des
  //  setBounds pendant le démarrage empêchaient l'animation de s'afficher)
  let ft = null;
  const follow = () => { if (!ft) ft = setTimeout(() => { ft = null; if (cover && coverRect) moveCover(coverRect); }, 30); };
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, follow);
  win.loadFile('index.html');
}

// ---------- mode hors ligne : images (jaquettes, badges, icônes RA) gardées sur disque ----------
// Les images des hôtes connus passent par ce cache : servies tout de suite si déjà vues, et toujours disponibles sans internet.
const IMG_HOSTS = /^(media\.retroachievements\.org|raw\.githubusercontent\.com|art\.gametdb\.com)$/;
const imgCacheDir = () => path.join(app.getPath('userData'), 'img-cache');
function imgType(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  return 'application/octet-stream';
}
function cacheImages() {
  try {
    protocol.handle('https', async (req) => {
      let u;
      try { u = new URL(req.url); } catch { u = null; }
      if (!u || req.method !== 'GET' || !IMG_HOSTS.test(u.hostname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      const file = path.join(imgCacheDir(), crypto.createHash('sha1').update(req.url).digest('hex'));
      const fromDisk = () => { try { const b = fs.readFileSync(file); return new Response(b, { headers: { 'content-type': imgType(b) } }); } catch { return null; } };
      const fresh = /^\/UserPic\//.test(u.pathname);   // avatars : ils peuvent changer, on retente le réseau d'abord
      if (!fresh || !net.isOnline()) { const hit = fromDisk(); if (hit) return hit; }
      try {
        const res = await net.fetch(req.url, { bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(20000) });
        if (!res.ok) return fromDisk() || res;
        const b = Buffer.from(await res.arrayBuffer());
        if (b.length < 16 * 1024 * 1024 && imgType(b).startsWith('image/')) {
          fs.mkdir(imgCacheDir(), { recursive: true }, () => fs.writeFile(file, b, () => {}));
        }
        return new Response(b, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || imgType(b) } });
      } catch {
        return fromDisk() || new Response(null, { status: 504 });   // hors ligne et jamais vue : l'image est simplement masquée
      }
    });
  } catch (e) { embedLog('cache images : ' + e.message); }
}

app.whenReady().then(() => {
  cacheImages();
  // getDisplayMedia() de la page = la fenêtre de l'émulateur en cours (mode stream), rien d'autre
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => { if (streamSource) cb({ video: streamSource }); else cb({}); });
  createWindow();
  // module d'intégration prêt dès le démarrage : au 1er lancement d'un jeu, il cache la fenêtre de l'émulateur dès sa création
  if ((process.platform === 'win32' || process.env.EMUGLOB_FAKE_EMBED) && readCfg().embedGames !== false) setTimeout(() => getHelper().catch((e) => embedLog('module : ' + e.message)), 4000);
});
app.on('window-all-closed', () => app.quit());

let saveLockedUntil = 0;   // empêche l'ancienne configuration en mémoire d'écraser une restauration / un import
ipcMain.handle('config:load', () => readCfg());
ipcMain.handle('config:save', (_e, data) => {
  if (Date.now() < saveLockedUntil) return true;
  maybeBackup();
  writeConfig(data);
  return true;
});

ipcMain.handle('portable:status', () => ({ portable: isPortable(), dir: isPortable() ? app.getPath('userData') : path.join(PORT_BASE, 'data'), data: app.getPath('userData') }));
// « Rendre portable » : copie les données de %APPDATA% dans data\ (l'original reste en place), crée portable.txt et relance
const PORT_KEEP = ['config.json', 'covers', 'saves', 'backups', 'ra-cache', 'img-cache', 'window.json'];
ipcMain.handle('portable:make', () => {
  if (isPortable()) return { ok: false, error: 'Emuglob est déjà en mode portable.' };
  const from = app.getPath('userData'), to = path.join(PORT_BASE, 'data');
  try {
    const probe = path.join(PORT_BASE, '.ecriture-test');
    fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
  } catch (e) { return { ok: false, error: `Impossible d'écrire dans ${PORT_BASE} (${e.code || e.message}). Déplace Emuglob dans un dossier à toi (pas Program Files).` }; }
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const n of PORT_KEEP) {
      const src = path.join(from, n);
      if (fs.existsSync(src) && n !== 'config.json') fs.cpSync(src, path.join(to, n), { recursive: true, force: false, errorOnExist: false });
    }
    // la config pointe vers les jaquettes de %APPDATA% : on la réécrit vers data\ (comparaison sans tenir compte de la casse, comme Windows)
    const low = from.toLowerCase();
    const moved = mapStrings(readCfg(), (s) => (s.toLowerCase().startsWith(low + path.sep) ? to + s.slice(from.length) : s));
    fs.writeFileSync(path.join(PORT_BASE, 'portable.txt'), 'Emuglob : mode portable. Les données sont dans le dossier data. Supprime ce fichier pour revenir à %APPDATA%.\r\n');
    const cfgFile = path.join(to, 'config.json');
    if (fs.existsSync(cfgFile)) fs.copyFileSync(cfgFile, cfgFile + '.avant-portable');
    fs.writeFileSync(cfgFile, JSON.stringify(mapStrings(moved, compactPath), null, 2), 'utf-8');
    embedLog(`mode portable activé : ${from} → ${to}`);
    setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
    return { ok: true, dir: to };
  } catch (e) { return { ok: false, error: e.message }; }
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
// export : chemins complets, pour qu'il marche aussi hors mode portable
ipcMain.handle('backups:export', async () => {
  const r = await dialog.showSaveDialog(win, { title: L('Exporter la configuration', 'Export configuration'), defaultPath: 'emuglob-config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return { ok: false, canceled: true };
  try { fs.writeFileSync(r.filePath, JSON.stringify(readCfg(), null, 2), 'utf-8'); return { ok: true, path: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('backups:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: L('Importer une configuration', 'Import configuration'), properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
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
  const r = await dialog.showOpenDialog(win, { title: L('Ajouter des jeux', 'Add games'), properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:exe', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: L("Choisir l'exécutable", 'Choose the executable'), properties: ['openFile'],
    filters: [{ name: L('Exécutable', 'Executable'), extensions: ['exe'] }, { name: L('Tous', 'All'), extensions: ['*'] }],
  });
  return r.canceled ? '' : r.filePaths[0];
});

// images choisies par l'utilisateur (fond d'écran, jaquette, icône) : formats d'image standard et GIF uniquement.
// On vérifie l'extension ET la signature du fichier (un fichier renommé en .png est refusé), puis on le copie sous un nom neutre.
const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
function imageKind(file) {
  const fd = fs.openSync(file, 'r'), b = Buffer.alloc(12);
  try { fs.readSync(fd, b, 0, 12, 0); } finally { fs.closeSync(fd); }
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('latin1', 0, 2) === 'BM') return 'bmp';
  return null;
}
async function pickImage(title, prefix) {
  const r = await dialog.showOpenDialog(win, {
    title, properties: ['openFile'], filters: [{ name: 'Images (PNG, JPG, WEBP, BMP, GIF)', extensions: IMG_EXT }],
  });
  if (r.canceled || !r.filePaths[0]) return '';
  const src = r.filePaths[0], ext = path.extname(src).slice(1).toLowerCase();
  let kind = null;
  try { if (fs.statSync(src).size <= 50 * 1024 * 1024) kind = imageKind(src); } catch { /* illisible */ }
  if (!IMG_EXT.includes(ext) || !kind) {
    dialog.showMessageBox(win, { type: 'warning', title: L('Fichier refusé', 'File rejected'), message: L("Ce fichier n'est pas une image valide.", 'This file is not a valid image.'), detail: L('Formats acceptés : PNG, JPG, WEBP, BMP et GIF (50 Mo maximum).', 'Accepted formats: PNG, JPG, WEBP, BMP and GIF (50 MB max).') });
    return '';
  }
  fs.mkdirSync(coverDir(), { recursive: true });
  const dest = path.join(coverDir(), `${String(prefix).replace(/[^a-z0-9_-]/gi, '')}-${Date.now()}.${kind}`);
  fs.copyFileSync(src, dest);
  return dest;
}
ipcMain.handle('dialog:cover', (_e, id) => pickImage(L('Choisir une jaquette', 'Choose a cover'), id));
ipcMain.handle('dialog:wallpaper', () => pickImage(L("Choisir un fond d'écran", 'Choose a wallpaper'), 'wallpaper'));

function scanDir(dir, wanted) {
  const files = [];
  const skipped = {};
  const rpxDirs = new Set();   // Wii U extrait : un seul .rpx par jeu (celui du dossier code\)   // gros fichiers (50 Mo et +) dont l'extension n'est pas reconnue : peut-être des jeux
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (ext === '.rpx') { if (wanted.has(ext) && path.basename(d).toLowerCase() === 'code' && !rpxDirs.has(d)) { rpxDirs.add(d); files.push(p); } continue; }
      if (wanted.has(ext)) files.push(p);
      else { try { if (fs.statSync(p).size >= 50 * 1024 * 1024) skipped[ext || '(sans extension)'] = (skipped[ext || '(sans extension)'] || 0) + 1; } catch { /* ignoré */ } }
    }
  };
  walk(dir);
  return { files, skipped };
}
ipcMain.handle('scan:folder', async (_e, extensions) => {
  const r = await dialog.showOpenDialog(win, { title: L('Dossier de ROMs', 'ROM folder'), properties: ['openDirectory'] });
  if (r.canceled) return { files: [], skipped: {}, dir: '' };
  return { ...scanDir(r.filePaths[0], new Set(extensions)), dir: r.filePaths[0] };
});
ipcMain.handle('scan:path', (_e, { dir, extensions }) => (fs.existsSync(dir) ? scanDir(dir, new Set(extensions)) : { files: [], skipped: {}, missing: true }));
// titre d'un jeu Wii U extrait : <jeu>\meta\meta.xml (longname_fr, sinon longname_en) à côté du dossier code\
ipcMain.handle('wiiu:title', (_e, rpx) => {
  try {
    const xml = fs.readFileSync(path.join(path.dirname(path.dirname(rpx)), 'meta', 'meta.xml'), 'utf-8');
    const tag = (n) => { const m = new RegExp(`<${n}[^>]*>([^<]*)</${n}>`).exec(xml); return m ? m[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim() : ''; };
    return tag('longname_fr') || tag('longname_en') || tag('shortname_fr') || tag('shortname_en') || '';
  } catch { return ''; }
});
// jeu Wii U extrait : <jeu>\code\*.rpx avec content\ et meta\ à côté ; un .rpx seul fait planter Cemu
ipcMain.handle('wiiu:check', (_e, rpx) => {
  const code = path.dirname(rpx), root = path.dirname(code), missing = [];
  if (path.basename(code).toLowerCase() !== 'code') return { ok: false, alone: true, missing: ['code', 'content', 'meta'] };
  for (const d of ['content', 'meta']) { try { if (!fs.statSync(path.join(root, d)).isDirectory()) missing.push(d); } catch { missing.push(d); } }
  return { ok: !missing.length, missing, root };
});
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

// mode stream : la fenêtre de l'émulateur est recopiée dans Emuglob (<video>) pour que le partage de la fenêtre Emuglob sur Discord la montre
let streamSource = null;
async function findStreamSource(hwnd) {
  for (let i = 0; i < 8; i++) {
    try {
      const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
      const s = list.find((x) => x.id.startsWith(`window:${hwnd}:`));
      if (s) return s;
    } catch (err) { embedLog('capture : ' + err.message); }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
function embedWindow(helper, pid, rect, mode, stream) {
  return new Promise((resolve) => {
    const b = win.getNativeWindowHandle();
    const parent = (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
    let t;
    const off = helper.on((line) => {
      if (line.startsWith('embedded')) { off(); clearTimeout(t); resolve({ ok: true, hwnd: (line.split(' ')[1] || '').trim() }); }
      else if (line.startsWith('error')) { off(); clearTimeout(t); resolve({ ok: false, reason: line.slice(6) }); }
    });
    t = setTimeout(() => { off(); resolve({ ok: false, reason: 'délai dépassé' }); }, 26000);
    helper.send(`embed ${pid} ${parent} ${rect.x} ${rect.y} ${rect.w} ${rect.h} 20000 ${mode === 'child' ? 'child' : 'overlay'}${stream && mode !== 'child' ? ' stream' : ''}`);
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
// écran de chargement posé AU-DESSUS de la zone de jeu pendant que l'émulateur démarre (fenêtre blanche, liste de jeux d'Azahar…)
let cover = null, coverRect = null, coverAt = 0;
const COVER_DELAY = { azahar: 2500, cemu: 3000, dolphin: 1500, pcsx2: 2000 };   // temps laissé après l'intégration avant de montrer le jeu
function coverBounds(r) {
  const cb = win.getContentBounds(), k = screen.getDisplayMatching(cb).scaleFactor || 1;
  return { x: Math.round(cb.x + r.x / k), y: Math.round(cb.y + r.y / k), width: Math.max(1, Math.round(r.w / k)), height: Math.max(1, Math.round(r.h / k)) };
}
function showCover(r, info) {
  hideCover(true);
  if (!win || win.isDestroyed() || !r || process.env.EMUGLOB_NO_COVER) return;
  coverRect = r;
  cover = new BrowserWindow({ ...coverBounds(r), parent: win, frame: false, show: false, focusable: false, skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false, backgroundColor: '#000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  cover.setAlwaysOnTop(true, 'pop-up-menu');   // au-dessus de la fenêtre de l'émulateur, quelle que soit la façon dont elle est intégrée
  const query = { t: info.title || '', e: info.emu || '', k: info.k === 'disc' ? 'disc' : 'cart', f: String(info.f || '').replace(/[^a-z0-9]/g, '').slice(0, 12), c: String(info.c || '').slice(0, 40), l: L('fr', 'en') };
  coverAt = Date.now();
  if (info.img && /^(file:|https:)/.test(info.img)) query.img = info.img;
  cover.loadFile(path.join(__dirname, 'loading.html'), { query });
  cover.once('ready-to-show', () => { if (cover && !cover.isDestroyed()) { cover.showInactive(); moveCover(coverRect); } });
  cover.on('closed', () => { cover = null; });
  setTimeout(() => hideCover(), 45000);   // sécurité : jamais d'écran de chargement bloqué
}
function hideCover(now) {
  const c = cover;
  if (!c || c.isDestroyed()) { cover = null; return; }
  cover = null;
  if (now) { c.destroy(); return; }
  c.webContents.executeJavaScript("document.body.classList.add('out')").catch(() => {});
  setTimeout(() => { if (!c.isDestroyed()) c.destroy(); }, 280);
}
function moveCover(r) {
  coverRect = r;
  if (!cover || cover.isDestroyed() || !cover.isVisible() || !win || win.isDestroyed()) return;   // pas encore affiché : il sera posé au bon endroit à l'affichage
  const b = coverBounds(r), o = cover.getBounds();
  if (b.x !== o.x || b.y !== o.y || b.width !== o.width || b.height !== o.height) cover.setBounds(b);
}
function backToApp() {
  globalShortcut.unregister(RECOVER);
  if (win && !win.isDestroyed()) { win.show(); win.focus(); }
}
// Mise à l'échelle Windows (125 %, 150 %…) : RALibretro n'est pas « DPI-aware », Windows lui ment sur la taille de sa fenêtre
// et l'image OpenGL est dessinée trop grande puis coupée (on ne voit qu'un bout de l'écran du haut d'un jeu DS).
// On le lance avec la couche de compatibilité HighDpiAware (= Propriétés > Compatibilité > « Remplacer… : Application »),
// uniquement pour ce processus : rien n'est écrit dans le registre.
function emuEnv(exe) {
  if (process.platform !== 'win32' || !/ralibretro/i.test(path.basename(exe))) return process.env;
  const cur = String(process.env.__COMPAT_LAYER || '');
  if (/highdpiaware/i.test(cur)) return process.env;
  const k = screen.getPrimaryDisplay().scaleFactor || 1;
  embedLog(`RALibretro lancé en mode HighDpiAware (échelle Windows ${Math.round(k * 100)} %)`);
  return { ...process.env, __COMPAT_LAYER: (cur.replace(/\b(dpiunaware|gdidpiscaling)\b/ig, '').trim() + ' HighDpiAware').trim() };
}
ipcMain.handle('game:launch', (_e, { exe, args, gameId, hide, embed, rect, mode, sync, stream, cover: coverInfo }) =>
  new Promise((resolve) => {
    if (!exe || !fs.existsSync(exe)) return resolve({ ok: false, error: 'Exécutable introuvable : ' + exe });
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return resolve({ ok: false, error: 'Arguments invalides.' });
    // sauvegardes partagées : la plus récente (autre émulateur ou coffre Emuglob) est mise en place avant le lancement
    let saves = null;
    if (sync && sync.rom && sync.emu && sync.emu.id === 'cemu') {   // Wii U : sauvegarde plus récente d'un autre Cemu du PC
      try { saves = getVault().cemuPrepare({ gameId: sync.gameId, exe, rom: sync.rom, tid: sync.tid, title: sync.title }); } catch (err) { saves = { action: 'error', error: err.message }; }
      embedLog('sauvegardes Cemu : ' + JSON.stringify(saves));
    } else if (sync && sync.rom && sync.emu) {
      try { saves = getVault().prepare(sync); } catch (err) { saves = { action: 'error', error: err.message }; }
      embedLog('sauvegardes : ' + JSON.stringify(saves));
    }
    try {
      embedLog(`lancement : ${exe} ${args.join(' ')} (intégration : ${embed ? 'oui, mode ' + (mode || 'overlay') : 'non'})`);
      const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore', env: emuEnv(exe) });
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
          hideCover(true);
          streamSource = null;
          if (current && current.child === child) { try { powerSaveBlocker.stop(current.psb); } catch { /* déjà arrêté */ } current = null; }
          embedLog(`émulateur fermé après ${seconds}s (code ${code})`);
          let saved = null;
          if (sync && sync.rom && sync.emu && sync.emu.id === 'cemu') {   // Wii U : copie du dossier de sauvegarde du jeu
            try {
              const loc = cemuSaveDir(exe, sync.rom, { tid: sync.tid, since: t0 });
              saved = loc.dir ? { ...getVault().snapDir(sync.gameId, loc.dir), tid: loc.tid } : { action: 'none', tid: loc.tid };
              if (loc.dir) { const pushed = getVault().cemuPush({ gameId: sync.gameId, exe, dir: loc.dir, tid: loc.tid }); if (pushed.length) saved.others = pushed; }
            } catch (err) { saved = { action: 'error', error: err.message }; }
            embedLog('sauvegarde Wii U : ' + JSON.stringify(saved));
          } else if (sync && sync.rom && sync.emu) {
            try { saved = getVault().collect(sync); } catch (err) { saved = { action: 'error', error: err.message }; }
            embedLog('sauvegarde récupérée : ' + JSON.stringify(saved));
          }
          backToApp();
          if (win && !win.isDestroyed()) win.webContents.send('game:exit', { id: gameId, seconds, short: seconds < 4, code, saved });
        });
        if (embed && rect) {
          showCover(rect, coverInfo || {});
          (async () => {
            try {
              const helper = await getHelper();
              const r = await embedWindow(helper, child.pid, rect, mode, stream);
              if (!r.ok) throw new Error(r.reason);
              if (current && current.child === child) current.embedded = true;
              streamSource = null;
              if (stream && mode !== 'child' && /^\d+$/.test(r.hwnd || '')) {
                streamSource = await findStreamSource(r.hwnd);
                embedLog('mode stream : ' + (streamSource ? 'fenêtre trouvée (' + streamSource.name + ')' : 'fenêtre introuvable pour la capture'));
              }
              if (win && !win.isDestroyed()) win.webContents.send('game:embedded', { ok: true, stream: !!streamSource });
              const emuId = sync && sync.emu && sync.emu.id || (coverInfo && coverInfo.id) || '';
              setTimeout(() => hideCover(), Math.max(COVER_DELAY[emuId] || 1200, 2000 - (Date.now() - coverAt)));   // l'animation de la cartouche a le temps de finir
            } catch (err) {
              hideCover(true);
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
// contrôles et raccourcis des émulateurs, édités dans leurs fichiers de configuration
const emuBase = () => (app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..'));
ipcMain.handle('emus:detect', () => ({ found: emucfg.detect(emuBase()), dir: path.join(emuBase(), 'emulators') }));
// ---------- installation / mise à jour d'émulateurs depuis leurs sources officielles (RALibretro, PCSX2) ----------
const RAL_REPO = 'RetroAchievements/RALibretro';
function exeVersion(exe) {   // version inscrite dans l'exécutable Windows
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`],
      { windowsHide: true, timeout: 15000 }, (err, out) => resolve(err ? '' : String(out).trim()));
  });
}
const verNum = (v) => String(v || '').replace(/^v/i, '').split(/[.,\s-]/).map((n) => parseInt(n, 10) || 0);
const sameOrNewer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return true; };
const fromGithubRelease = (rel, asset) => ({ tag: rel.tag_name, latest: String(rel.tag_name || '').replace(/^v/i, ''), date: rel.published_at, size: asset.size, asset });

// RALibretro est distribué par RetroAchievements (pas dans les Releases GitHub, qui ne contiennent que RAHasher).
// L'API « latestclient » donne la dernière version et son lien (RALibretro = émulateur n° 7 pour RetroAchievements).
async function latestRalib() {
  const errors = [];
  try {
    const r = await fetch(process.env.EMUGLOB_RAL_API || 'https://retroachievements.org/dorequest.php?r=latestclient&e=7', { headers: { 'User-Agent': 'Emuglob' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('RetroAchievements a répondu ' + r.status);
    const j = await r.json();
    const url = j.LatestVersionUrlX64 || j.LatestVersionUrl;
    if (!j.Success && !url) throw new Error(j.Error || 'réponse inattendue : ' + JSON.stringify(j).slice(0, 200));
    if (!url || (!/^https:\/\//i.test(url) && !process.env.EMUGLOB_RAL_API)) throw new Error('pas de lien de téléchargement dans la réponse : ' + JSON.stringify(j).slice(0, 200));
    let size = 0, date = '';
    try { const h = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Emuglob' }, signal: AbortSignal.timeout(15000) }); size = +h.headers.get('content-length') || 0; date = h.headers.get('last-modified') || ''; } catch { /* taille inconnue */ }
    return { tag: j.LatestVersion, latest: String(j.LatestVersion || '').replace(/^v/i, ''), date, size, asset: { name: decodeURIComponent(url.split('/').pop()), browser_download_url: url, size } };
  } catch (e) { errors.push('RetroAchievements : ' + e.message); }
  try {   // secours : une Release GitHub qui contiendrait un vrai zip RALibretro
    const rel = await (await ghFetch(`https://api.github.com/repos/${RAL_REPO}/releases/latest`)).json();
    const zips = (rel.assets || []).filter((a) => /\.zip$/i.test(a.name) && /^ralibretro/i.test(a.name) && !/linux|mac|osx|src|source/i.test(a.name));
    const asset = zips.find((a) => /x64|win64/i.test(a.name)) || zips.find((a) => !/x86|win32/i.test(a.name)) || zips[0];
    if (!asset) throw new Error(`pas de zip RALibretro dans la version ${rel.tag_name}`);
    return fromGithubRelease(rel, asset);
  } catch (e) { errors.push('GitHub : ' + e.message); }
  throw new Error(errors.join(' ; '));
}
// PCSX2 : dernière version stable sur GitHub ; on prend l'archive Windows x64 portable (pas l'installeur, pas les symboles de débogage)
async function latestPcsx2() {
  const rel = await (await ghFetch(process.env.EMUGLOB_PCSX2_API || 'https://api.github.com/repos/PCSX2/pcsx2/releases/latest')).json();
  const ok = (rel.assets || []).filter((a) => /windows/i.test(a.name) && /x64/i.test(a.name) && /\.(7z|zip)$/i.test(a.name) && !/symbol|debug|pdb|installer|setup/i.test(a.name));
  const asset = ok.find((a) => /qt/i.test(a.name) && /\.zip$/i.test(a.name)) || ok.find((a) => /qt/i.test(a.name)) || ok.find((a) => /\.zip$/i.test(a.name)) || ok[0];
  if (!asset) throw new Error(`pas d'archive Windows x64 dans la version ${rel.tag_name} (fichiers : ${(rel.assets || []).map((x) => x.name).join(', ') || 'aucun'})`);
  return fromGithubRelease(rel, asset);
}
async function latestCemu() {
  const rel = await (await ghFetch(process.env.EMUGLOB_CEMU_API || 'https://api.github.com/repos/cemu-project/Cemu/releases/latest')).json();
  const ok = (rel.assets || []).filter((a) => /windows/i.test(a.name) && /x64/i.test(a.name) && /\.(zip|7z)$/i.test(a.name) && !/symbol|debug|pdb|installer|setup/i.test(a.name));
  const asset = ok.find((a) => /\.zip$/i.test(a.name)) || ok[0];
  if (!asset) throw new Error(`pas d'archive Windows x64 dans la version ${rel.tag_name} (fichiers : ${(rel.assets || []).map((x) => x.name).join(', ') || 'aucun'})`);
  return fromGithubRelease(rel, asset);
}
// Dolphin : pas de Releases GitHub ; la page officielle de téléchargement liste les versions (la première = la plus récente)
async function latestDolphin() {
  const page = process.env.EMUGLOB_DOLPHIN_PAGE || 'https://dolphin-emu.org/download/';
  const r = await fetch(page, { headers: { 'User-Agent': 'Emuglob' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('dolphin-emu.org a répondu ' + r.status);
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[0] : null; };
  const url = pick(/https:\/\/dl\.dolphin-emu\.org\/releases\/[^"'\s<>]+?-x64\.(?:7z|zip)/i) || pick(/https:\/\/dl\.dolphin-emu\.org\/builds\/[^"'\s<>]+?-x64\.(?:7z|zip)/i);
  if (!url) throw new Error('aucun lien Windows x64 trouvé sur dolphin-emu.org');
  const name = url.split('/').pop();
  const v = (/dolphin-(?:master-)?([\d.]+(?:-\d+)?)-x64/i.exec(name) || [])[1] || name;
  let size = 0;
  try { const h = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Emuglob' }, signal: AbortSignal.timeout(15000) }); size = Number(h.headers.get('content-length')) || 0; } catch { /* taille inconnue */ }
  return { tag: v, latest: v, date: '', size, asset: { name, browser_download_url: url, size } };
}
const INSTALLERS = {
  ralibretro: { name: 'RALibretro', dir: 'RALibretro', exes: ['ralibretro.exe'], latest: latestRalib },
  pcsx2: { name: 'PCSX2', dir: 'PCSX2', exes: ['pcsx2-qt.exe', 'pcsx2.exe'], latest: latestPcsx2 },
  cemu: { name: 'Cemu', dir: 'Cemu', exes: ['cemu.exe'], latest: latestCemu },
  dolphin: { name: 'Dolphin', dir: 'Dolphin', exes: ['dolphin.exe'], latest: latestDolphin },
};
const releases = {};
const instDefaultDir = (id) => path.join(emuBase(), 'emulators', INSTALLERS[id].dir);
const isInstExe = (id, exe) => !!exe && INSTALLERS[id].exes.includes(path.basename(exe).toLowerCase()) && fs.existsSync(exe);
ipcMain.handle('inst:status', async (_e, { id, exe }) => {
  const ins = INSTALLERS[id];
  if (!ins) return { ok: false, error: 'émulateur inconnu' };
  const out = { id, name: ins.name, installed: isInstExe(id, exe), exe: exe || '', version: '', defaultDir: instDefaultDir(id) };
  if (out.installed) out.version = await exeVersion(exe);
  try {
    const rel = releases[id] = await ins.latest();
    Object.assign(out, { ok: true, asset: rel.asset.name, latest: rel.latest, date: rel.date, size: rel.size });
    out.upToDate = out.installed && !!out.version && sameOrNewer(out.version, out.latest);
  } catch (e) { out.ok = false; out.error = e.message; }
  return out;
});
// extraction : 7za.exe intégré à Emuglob (7-Zip, LGPL, lit zip et 7z) copié hors de l'asar pour pouvoir le lancer,
// puis tar.exe de Windows 10+, 7-Zip installé, PowerShell (zip) ; hors Windows : EMUGLOB_7ZA, unzip ou 7z (tests)
function bundled7za() {
  if (process.env.EMUGLOB_7ZA) return process.env.EMUGLOB_7ZA;
  if (process.platform !== 'win32') return null;
  try {
    const src = path.join(__dirname, 'tools', '7za.exe'), out = path.join(app.getPath('userData'), 'tools', '7za.exe');
    const buf = fs.readFileSync(src);
    if (!fs.existsSync(out) || fs.statSync(out).size !== buf.length) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf); }
    return out;
  } catch { return null; }
}
function extract(file, dest) {
  const q = (x) => x.replace(/'/g, "''");
  const z = bundled7za(), sevenArgs = ['x', '-y', '-o' + dest, file];
  const seven = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].filter((x) => fs.existsSync(x));
  const tries = [...(z ? [[z, sevenArgs]] : []), ...(process.platform === 'win32'
    ? [['tar.exe', ['-xf', file, '-C', dest]], ...seven.map((x) => [x, sevenArgs]),
      ...(/\.zip$/i.test(file) ? [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${q(file)}' -DestinationPath '${q(dest)}' -Force`]]] : [])]
    : (/\.zip$/i.test(file) ? [['unzip', ['-oq', file, '-d', dest]]] : [['7z', sevenArgs]]))];
  let last = null;
  return tries.reduce((p, [cmd, args]) => p.catch(() => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true, timeout: 300000 }, (err) => (err ? rej((last = err)) : res())))),
    Promise.reject(new Error('start'))).catch(() => { throw new Error(`impossible d'extraire ${path.basename(file)}${last && last.message ? ' (' + String(last.message).split('\n')[0].slice(0, 160) + ')' : ''}`); });
}
function findFile(dir, names, depth = 3) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile() && names.includes(e.name.toLowerCase())) return path.join(dir, e.name);
  if (depth) for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) { const f = findFile(path.join(dir, e.name), names, depth - 1); if (f) return f; }
  return null;
}
ipcMain.handle('inst:install', async (_e, { id, exe }) => {
  const ins = INSTALLERS[id], rel = releases[id];
  if (!ins) return { ok: false, error: 'émulateur inconnu' };
  if (!rel) return { ok: false, error: "vérifie d'abord la dernière version" };
  if (!rel.asset.browser_download_url) return { ok: false, error: 'lien de téléchargement manquant' };
  if (isInstExe(id, exe) && emucfg.running(exe)) return { ok: false, error: `${ins.name} est ouvert : ferme-le avant de le mettre à jour.` };
  // mise à jour sur place (réglages et sauvegardes restent) ; si le dossier est protégé (Program Files), dossier emulators\ d'Emuglob
  const candidates = [...(isInstExe(id, exe) ? [path.dirname(exe)] : []), instDefaultDir(id), path.join(app.getPath('userData'), 'emulators', ins.dir)];
  let dest = null;
  for (const d of candidates) { try { fs.mkdirSync(d, { recursive: true }); const t = path.join(d, '.emuglob-test'); fs.writeFileSync(t, ''); fs.unlinkSync(t); dest = d; break; } catch { /* suivant */ } }
  if (!dest) return { ok: false, error: `impossible d'écrire dans ${candidates[0]}` };
  const work = path.join(app.getPath('userData'), 'update', id);
  const send = (p) => { if (win && !win.isDestroyed()) win.webContents.send('inst:progress', { id, ...p }); };
  try {
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, 'x'), { recursive: true });
    const { asset } = rel;
    const r = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Emuglob' }, signal: AbortSignal.timeout(600000) });
    if (!r.ok) throw new Error('téléchargement refusé (' + r.status + ')');
    const chunks = []; let got = 0;
    for await (const c of r.body) { chunks.push(c); got += c.length; send({ step: 'download', got, total: asset.size }); }
    const buf = Buffer.concat(chunks);
    if (asset.size && buf.length !== asset.size) throw new Error('téléchargement incomplet');
    const isZip = buf.slice(0, 2).toString() === 'PK', is7z = buf.slice(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
    if (!isZip && !is7z) throw new Error("le fichier téléchargé n'est pas une archive zip ou 7z");
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
    if (digest && crypto.createHash('sha256').update(buf).digest('hex') !== digest[1].toLowerCase()) throw new Error('fichier altéré (empreinte SHA-256 différente de celle de GitHub)');
    const file = path.join(work, asset.name.replace(/[^\w.-]/g, '_'));
    fs.writeFileSync(file, buf);
    send({ step: 'extract' });
    await extract(file, path.join(work, 'x'));
    const found = findFile(path.join(work, 'x'), ins.exes);
    if (!found) throw new Error(`${ins.exes[0]} introuvable dans ${asset.name}`);
    fs.cpSync(path.dirname(found), dest, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    embedLog(`${ins.name} ${rel.tag} installé dans ${dest}`);
    return { ok: true, exe: path.join(dest, path.basename(found)), version: rel.latest, moved: !!exe && isInstExe(id, exe) && path.dirname(exe) !== dest };
  } catch (e) {
    embedLog(`installation ${ins.name} : ${e.message}`);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignoré */ }
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('emucfg:load', (_e, exe) => emucfg.load(exe));
ipcMain.handle('emucfg:encode', (_e, { exe, group, bind }) => emucfg.encode(exe, group, bind));
ipcMain.handle('emucfg:save', (_e, { exe, changes }) => {
  const r = emucfg.save(exe, changes);
  embedLog(`contrôles ${exe} : ${r.ok ? 'enregistrés (' + r.files.join(', ') + ')' : r.error}`);
  return r;
});
ipcMain.handle('game:move', (_e, r) => { moveCover(r); if (helperObj && current && current.embedded) helperObj.send(`move ${r.x} ${r.y} ${r.w} ${r.h}`); });
// volume de l'émulateur en cours (mélangeur de Windows), à chaud
ipcMain.handle('game:vol', (_e, { level, mute }) => new Promise((resolve) => {
  if (!helperObj || !current || !current.child) return resolve({ ok: false, error: 'aucun jeu intégré' });
  let t;
  const off = helperObj.on((line) => {
    if (!line.startsWith('vol ')) return;
    off(); clearTimeout(t);
    const [, l, m, n] = line.split(' ').map(Number);
    resolve({ ok: true, level: l, mute: m === 1, sessions: n });
  });
  t = setTimeout(() => { off(); resolve({ ok: false, error: 'pas de réponse' }); }, 3000);
  helperObj.send(`vol ${current.child.pid} ${Number.isFinite(level) ? Math.round(level) : -1} ${mute === undefined || mute === null ? -1 : mute ? 1 : 0}`);
}));
ipcMain.handle('quick:get', (_e, exe) => { try { return emucfg.quick(exe); } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('quick:save', (_e, { exe, values }) => { try { return { ok: true, n: emucfg.quickSave(exe, values) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('game:focus', () => { if (helperObj && current && current.embedded) helperObj.send('focus'); });
// cache / remontre la fenêtre de l'émulateur, le temps d'un panneau d'Emuglob par-dessus le jeu (contrôles)
ipcMain.handle('game:park', (_e, on) => {
  if (!helperObj || !current || !current.embedded) return false;
  helperObj.send(on ? 'hide' : 'show');
  if (on && win && !win.isDestroyed()) win.focus();   // Emuglob reprend le clavier
  return true;
});
ipcMain.handle('game:stop', () => {
  if (!current) return;
  const c = current.child;
  if (helperObj && current.embedded) { helperObj.send('close'); setTimeout(() => { if (c.exitCode === null) killTree(c.pid); }, 4000); }   // fermeture douce, puis forcée
  else killTree(c.pid);
});
// recherche des sauvegardes existantes (dossiers des ROMs, des émulateurs, dossiers habituels, + dossiers choisis)
ipcMain.handle('saves:find', (_e, { games, emus, dirs, files }) => {
  try { return { ok: true, items: findExisting({ games, emus, extraDirs: (dirs || []).filter((d) => typeof d === 'string'), files: (files || []).filter((f) => typeof f === 'string'), vaultBase: path.join(app.getPath('userData'), 'saves') }) }; } catch (err) { return { ok: false, error: err.message, items: [] }; }
});
ipcMain.handle('saves:import', (_e, items) => importExisting(path.join(app.getPath('userData'), 'saves'), items));
// Cemu : keys.txt (clés tirées de la console de l'utilisateur, jamais fournies) — où Cemu le lit
function cemuKeysTargets(exe) {
  const d = exe ? path.dirname(exe) : '', A = process.env.APPDATA ? path.join(process.env.APPDATA, 'Cemu') : '';
  const out = [];
  if (d && fs.existsSync(path.join(d, 'portable'))) out.push(path.join(d, 'portable', 'keys.txt'));   // Cemu 2.x portable
  if (A && fs.existsSync(A)) out.push(path.join(A, 'keys.txt'));                                    // Cemu 2.x installé
  if (d) out.push(path.join(d, 'keys.txt'));                                                         // ancien Cemu, à côté de l'exe
  return [...new Set(out)];
}
ipcMain.handle('cemu:keysStatus', (_e, exe) => { const t = cemuKeysTargets(exe); const f = t.find((x) => fs.existsSync(x)); return { has: !!f, file: f || '', target: t[0] || '' }; });
ipcMain.handle('cemu:keysImport', async (_e, exe) => {
  const t = cemuKeysTargets(exe);
  if (!t.length) return { ok: false, error: 'règle ou installe Cemu d\'abord' };
  const r = await dialog.showOpenDialog(win, { title: L('Ton keys.txt (clés tirées de ta propre console)', 'Your keys.txt (keys dumped from your own console)'), properties: ['openFile'], filters: [{ name: 'keys.txt', extensions: ['txt'] }, { name: L('Tous', 'All'), extensions: ['*'] }] });
  if (r.canceled) return { ok: false, canceled: true };
  let txt; try { txt = fs.readFileSync(r.filePaths[0], 'utf-8'); } catch (e) { return { ok: false, error: e.message }; }
  const n = (txt.match(/^\s*[0-9a-fA-F]{32}\b/gm) || []).length;
  if (!n || txt.length > 1048576) return { ok: false, error: "ce fichier ne ressemble pas à un keys.txt (une clé de 32 caractères hexadécimaux par ligne)" };
  const dst = t.find((x) => fs.existsSync(x)) || t[0];
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst)) fs.copyFileSync(dst, dst + '.bak');
    fs.copyFileSync(r.filePaths[0], dst);
    return { ok: true, file: dst, keys: n };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('saves:pickfiles', async () => {
  const exts = [...require('./saves').SAVE_EXT].map((e) => e.slice(1)).concat('dat');   // .dat : seulement à la main (trop de faux positifs pour la recherche auto)
  const r = await dialog.showOpenDialog(win, { title: L('Fichiers de sauvegarde', 'Save files'), properties: ['openFile', 'multiSelections'], filters: [{ name: L('Sauvegardes', 'Saves'), extensions: exts }, { name: L('Tous', 'All'), extensions: ['*'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('saves:pickdir', async () => { const r = await dialog.showOpenDialog(win, { title: L('Dossier contenant des sauvegardes', 'Folder with saves'), properties: ['openDirectory'] }); return r.canceled ? '' : r.filePaths[0]; });
ipcMain.handle('wiiusave:list', (_e, { gameId, exe, rom, tid, title }) => {
  let loc = { dir: null, tid: tid || '' };
  try { loc = cemuSaveDir(exe || '', rom, { tid, title }); } catch { /* Cemu absent */ }
  return { copies: getVault().listDir(String(gameId)), dir: loc.dir, tid: loc.tid };
});
ipcMain.handle('wiiusave:snap', (_e, { gameId, exe, rom, tid }) => {
  try { const loc = cemuSaveDir(exe || '', rom, { tid }); if (!loc.dir) return { ok: false, error: 'aucune sauvegarde de ce jeu dans Cemu' }; return { ok: true, ...getVault().snapDir(String(gameId), loc.dir) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('wiiusave:restore', (_e, { gameId, exe, rom, tid, name }) => {
  if (emucfg.running(exe)) return { ok: false, error: 'Cemu est ouvert : ferme-le avant de restaurer.' };
  try {
    let { dir, tid: id } = cemuSaveDir(exe, rom, { tid });
    if (!dir) { if (!/^[0-9a-f]{16}$/.test(id || '')) return { ok: false, error: "dossier de sauvegarde de Cemu inconnu pour ce jeu : lance-le une fois dans Cemu" };
      const roots = require('./saves').cemuMlcRoots(exe); if (!roots.length) return { ok: false, error: 'dossier mlc01 de Cemu introuvable' };
      dir = path.join(roots[0], 'usr', 'save', id.slice(0, 8), id.slice(8)); }
    getVault().restoreDir(String(gameId), name, dir);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('saves:open', (_e, gameId) => { const d = getVault().dir(String(gameId)); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
// on = interrupteur des Paramètres ; legacyId = ancien ID saisi à la main (repli si DISCORD_APP_ID est vide)
ipcMain.handle('discord:set', (_e, { on, activity, legacyId }) => { discord.set(on ? (DISCORD_APP_ID || String(legacyId || '').replace(/\D/g, '')) : '', activity); return discord.status; });
ipcMain.handle('discord:status', () => discord.status);
ipcMain.handle('embed:openlog', () => shell.openPath(embedLogPath()));
app.on('before-quit', () => { discord.close(); if (helperObj && current && current.embedded) helperObj.send('close'); });

ipcMain.handle('win:fullscreen', (_e, force) => {
  const next = typeof force === 'boolean' ? force : !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});
ipcMain.handle('app:quit', () => app.quit());
// relance : app.quit() (et non app.exit) pour garder le nettoyage de before-quit (Discord, émulateur intégré)
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.quit(); });

/* ---------- RetroAchievements (appels faits ici : la clé ne quitte jamais ce processus) ---------- */
const RA_ALLOWED = new Set(['GetUserSummary', 'GetGameProgression', 'GetUserProfile', 'GetUserRecentAchievements', 'GetGameInfoAndUserProgress', 'GetGameList', 'GetUsersIFollow', 'GetGame', 'GetUserAwards', 'GetUserCompletionProgress', 'GetConsoleIDs', 'GetGameHashes', 'GetGameExtended']);
const mem = new Map();

// ---------- résumé Wikipédia pour la fiche de jeu (français, sinon anglais), gardé sur disque pour le mode hors ligne ----------
const WIKI_UA = { 'User-Agent': 'Emuglob/1.1 (https://github.com/Jowran/emuglob)', 'Api-User-Agent': 'Emuglob/1.1 (https://github.com/Jowran/emuglob)' };
async function wikiJson(url) {
  const res = await net.fetch(url, { headers: WIKI_UA, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function wikiFind(lang, title, consoleName) {
  const hint = lang === 'fr' ? 'jeu vidéo' : 'video game';
  const q = new URLSearchParams({ action: 'query', list: 'search', format: 'json', srlimit: '5', srsearch: `${title} ${hint} ${consoleName || ''}`.trim() });
  const r = await wikiJson(`https://${lang}.wikipedia.org/w/api.php?${q}`);
  const norm = (x) => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const want = norm(title).split(' ').filter((w) => w.length > 2);
  // premier résultat qui parle de jeu vidéo et reprend les mots du titre
  const hit = (r.query && r.query.search || []).find((x) => {
    const t = norm(x.title), sn = norm(x.snippet);
    return want.filter((w) => t.includes(w)).length >= Math.max(1, Math.ceil(want.length * 0.6)) && /jeu|video game|game/.test(sn + ' ' + t);
  });
  if (!hit) return null;
  const sum = await wikiJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`);
  if (!sum || !sum.extract || sum.type === 'disambiguation') return null;
  return { lang, title: sum.title, text: sum.extract, url: sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page };
}
ipcMain.handle('wiki:summary', async (_e, { title, console: consoleName, lang }) => {
  const first = lang === 'en' ? 'en' : 'fr', second = first === 'en' ? 'fr' : 'en';
  if (typeof title !== 'string' || !title.trim()) return { ok: false };
  const file = path.join(raCacheDir(), 'wiki', crypto.createHash('sha1').update(title + '|' + (consoleName || '') + (first === 'en' ? '|en' : '')).digest('hex') + '.json');
  try { const c = JSON.parse(fs.readFileSync(file, 'utf-8')); if (!net.isOnline() || Date.now() - c.t < 30 * 864e5) return { ok: true, ...c.data }; } catch { /* pas en cache */ }
  if (!net.isOnline()) return { ok: false, offline: true };
  try {
    const clean = title.replace(/\s*[([].*?[)\]]/g, '').trim();
    const data = (await wikiFind(first, clean, consoleName)) || (await wikiFind(second, clean, consoleName)) || { none: true };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ t: Date.now(), data }));
    return { ok: true, ...data };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ra:gamepage', (_e, id) => { const n = Number(id); if (Number.isInteger(n) && n > 0) shell.openExternal('https://retroachievements.org/game/' + n); });
// noms des subsets RetroAchievements d'après les patchs rangés à côté de la ROM (« Jeu [Subset - Nom].xdelta », dossiers compris)
ipcMain.handle('subset:patches', async (_e, dir) => {
  const out = [];
  const walk = async (d, depth) => {
    let ents = [];
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory() && depth < 2) await walk(path.join(d, e.name), depth + 1);
      else if (e.isFile() && /\.(xdelta|vcdiff|bps|ips|ups|ppf)$/i.test(e.name)) {
        const m = /\[\s*subset\s*-\s*([^\]]+?)\s*\]/i.exec(e.name);
        if (m) out.push(m[1]);
      }
    }
  };
  if (typeof dir === 'string' && dir) await walk(dir, 0);
  return [...new Set(out)];
});
// patchs .xdelta des subsets : liste (nom + fichier) puis création d'une ISO patchée à côté de l'originale, jamais modifiée
const PATCH_RX = /\.(xdelta|vcdiff|bps|ips)$/i;
// CRC32 (BPS)
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
// patchs de cartouche (ROM chargée en mémoire, 512 Mo max) : IPS et BPS ; la BPS vérifie la CRC de la ROM de base et du résultat
function applyIps(src, p) {
  if (p.toString('latin1', 0, 5) !== 'PATCH') throw new Error('Fichier IPS invalide.');
  let out = Buffer.from(src), i = 5;
  const grow = (n) => { if (n > out.length) { const b = Buffer.alloc(n); out.copy(b); out = b; } };
  while (i + 3 <= p.length) {
    if (p.toString('latin1', i, i + 3) === 'EOF') { i += 3; if (i + 3 <= p.length) { const t = p.readUIntBE(i, 3); out = out.subarray(0, t); } return out; }
    const off = p.readUIntBE(i, 3), len = p.readUInt16BE(i + 3); i += 5;
    if (len) { grow(off + len); p.copy(out, off, i, i + len); i += len; }
    else { const n = p.readUInt16BE(i), v = p[i + 2]; i += 3; grow(off + n); out.fill(v, off, off + n); }
  }
  throw new Error('Fichier IPS tronqué.');
}
function applyBps(src, p) {
  if (p.toString('latin1', 0, 4) !== 'BPS1') throw new Error('Fichier BPS invalide.');
  let i = 4;
  const num = () => { let d = 0, s = 1; for (;;) { const x = p[i++]; d += (x & 0x7f) * s; if (x & 0x80) break; s *= 128; d += s; } return d; };
  const srcSize = num(), tgtSize = num(), meta = num(); i += meta;
  const end = p.length - 12, srcCrc = p.readUInt32LE(end), tgtCrc = p.readUInt32LE(end + 4);
  if (src.length !== srcSize || crc32(src) !== srcCrc) throw new Error('BADBASE');
  const out = Buffer.alloc(tgtSize);
  let o = 0, sRel = 0, tRel = 0;
  while (i < end) {
    const d = num(), cmd = d & 3, len = Math.floor(d / 4) + 1;
    if (cmd === 0) { src.copy(out, o, o, o + len); o += len; }
    else if (cmd === 1) { p.copy(out, o, i, i + len); i += len; o += len; }
    else { const x = num(), off = (x & 1 ? -1 : 1) * Math.floor(x / 2);
      if (cmd === 2) { sRel += off; src.copy(out, o, sRel, sRel + len); sRel += len; o += len; }
      else { tRel += off; for (let k = 0; k < len; k++) out[o++] = out[tRel++]; } }
  }
  if (crc32(out) !== tgtCrc) throw new Error('Résultat incorrect (CRC).');
  return out;
}
ipcMain.handle('subset:patchFiles', async (_e, dir) => {
  const out = [];
  const walk = async (d, depth) => {
    let ents = [];
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory() && depth < 2) await walk(path.join(d, e.name), depth + 1);
      else if (e.isFile() && PATCH_RX.test(e.name)) {
        const m = /\[\s*subset\s*-\s*([^\]]+?)\s*\]/i.exec(e.name), f = path.join(d, e.name);
        if (m && !out.some((o) => o.file === f)) out.push({ name: m[1], file: f });
      }
    }
  };
  if (typeof dir === 'string' && dir) {
    await walk(dir, 0);
    const up = path.dirname(dir);   // ROM rangée dans son propre dossier : le patch peut être dans le dossier de la console (ex. NDS\Jeu [Subset - X].xdelta)
    if (up && up !== dir) await walk(up, 99);
  }
  return out;
});
function bundledXdelta() {
  if (process.env.EMUGLOB_XDELTA) return process.env.EMUGLOB_XDELTA;
  if (process.platform !== 'win32') return null;
  try {
    const src = path.join(__dirname, 'tools', 'xdelta3.exe'), out = path.join(app.getPath('userData'), 'tools', 'xdelta3.exe');
    const buf = fs.readFileSync(src);
    if (!fs.existsSync(out) || fs.statSync(out).size !== buf.length) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf); }
    return out;
  } catch { return null; }
}
let patching = null;
ipcMain.handle('subset:apply', async (_e, { src, patch, name }) => {
  if (patching) return { ok: false, error: 'Un patch est déjà en cours.' };
  if (typeof src !== 'string' || typeof patch !== 'string' || !PATCH_RX.test(patch)) return { ok: false, error: 'Patch invalide.' };
  if (/\.(zip|7z|rar)$/i.test(src)) return { ok: false, error: 'ROM compressée (.zip/.7z) : décompresse-la pour appliquer le patch.' };
  const ext = path.extname(src), safe = String(name || 'Subset').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Subset';
  const out = path.join(path.dirname(src), path.basename(src, ext) + ` [Subset - ${safe}]` + ext), part = out + '.part';
  if (path.resolve(out) === path.resolve(src)) return { ok: false, error: 'Nom de sortie identique à la ROM.' };
  if (fs.existsSync(out)) return { ok: true, out, existed: true };
  let size = 0;
  try { size = (await fs.promises.stat(src)).size; } catch { return { ok: false, error: 'ROM de base introuvable : ' + src }; }
  const send = (p) => { if (win && !win.isDestroyed()) win.webContents.send('subset:progress', p); };
  if (/\.(ips|bps)$/i.test(patch)) {
    if (size > 512 * 1048576) return { ok: false, error: 'ROM trop grosse pour un patch IPS/BPS.' };
    try {
      const [s, p] = await Promise.all([fs.promises.readFile(src), fs.promises.readFile(patch)]);
      const outBuf = /\.bps$/i.test(patch) ? applyBps(s, p) : applyIps(s, p);
      await fs.promises.writeFile(part, outBuf); await fs.promises.rename(part, out);
      return { ok: true, out };
    } catch (e) {
      fs.rm(part, { force: true }, () => {});
      return { ok: false, error: e.message === 'BADBASE' ? 'Ce patch ne correspond pas à ta ROM de base (mauvaise version/région ou ROM déjà modifiée).' : e.message };
    }
  }
  const xd = bundledXdelta();
  if (!xd) return { ok: false, error: 'xdelta3 introuvable.' };
  return new Promise((resolve) => {
    // -d décode, -s source (lue seulement) ; les sommes adler32 du patch font échouer xdelta si la ROM de base n'est pas la bonne
    const c = spawn(xd, ['-d', '-f', '-s', src, patch, part], { windowsHide: true });
    patching = c;
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    const t = setInterval(() => { fs.stat(part, (e2, st) => { if (!e2 && size) send({ pct: Math.min(99, Math.floor((100 * st.size) / size)) }); }); }, 500);
    const done = (r) => { clearInterval(t); patching = null; if (!r.ok) fs.rm(part, { force: true }, () => {}); resolve(r); };
    c.on('error', (e) => done({ ok: false, error: e.message }));
    c.on('close', (code) => {
      if (code !== 0) {
        const bad = /checksum|adler|source file too short|invalid|source/i.test(err);
        return done({ ok: false, error: bad ? "Ce patch ne correspond pas à ta ROM de base (mauvaise version/région ou ROM déjà modifiée)." : 'xdelta3 a échoué : ' + (err.trim().split('\n').pop() || 'code ' + code) });
      }
      fs.rename(part, out, (e3) => (e3 ? done({ ok: false, error: e3.message }) : done({ ok: true, out })));
    });
  });
});
ipcMain.handle('wiki:open', (_e, url) => { if (typeof url === 'string' && /^https:\/\/[a-z]{2}\.wikipedia\.org\/wiki\//.test(url)) shell.openExternal(url); });
ipcMain.handle('ra:call', (_e, a) => raCall(a));
async function raCall({ endpoint, params = {}, ttl = 60 }) {
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
  // mode hors ligne : chaque réponse est gardée sur disque ; sans réseau, on renvoie la dernière connue (sans erreur)
  const staleFile = diskFile || path.join(raCacheDir(), 'api', crypto.createHash('sha1').update(id).digest('hex') + '.json');
  const stale = () => {
    try { const data = JSON.parse(fs.readFileSync(staleFile, 'utf-8')); mem.set(id, { t: Date.now(), data }); return { ok: true, data, stale: true }; } catch { return null; }
  };
  if (!net.isOnline()) { const st = stale(); if (st) return st; }
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
    if (!res.ok) return stale() || { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    mem.set(id, { t: Date.now(), data });
    try {
      fs.mkdirSync(path.dirname(staleFile), { recursive: true });
      fs.writeFileSync(staleFile, JSON.stringify(data));
    } catch { /* cache facultatif */ }
    return { ok: true, data };
  } catch (err) {
    return stale() || { ok: false, error: err.name === 'TimeoutError' ? 'Délai dépassé' : err.message };
  }
}

// catalogue complet RetroAchievements ([id, titre, console, icône, succès, points]) (tous les jeux avec succès, toutes consoles) pour la barre de recherche.
// Construit une fois depuis GetGameList (sans les hash, plus léger) puis gardé 7 jours dans ra-cache/catalog.json.
let catalogJob = null;
ipcMain.handle('ra:catalog', (_e, force) => {
  const file = path.join(raCacheDir(), 'catalog-v2.json');
  let old = null;
  try { old = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* pas encore construit */ }
  if (old && !force && (!net.isOnline() || Date.now() - old.t < 7 * 864e5)) return { ok: true, games: old.games };
  if (!net.isOnline()) return old ? { ok: true, games: old.games } : { ok: false, error: 'hors ligne' };
  if (catalogJob) return catalogJob;
  catalogJob = (async () => {
    const cons = await raCall({ endpoint: 'GetConsoleIDs', params: { a: 1, g: 1 }, ttl: 604800 });
    if (!cons.ok || !Array.isArray(cons.data)) return old ? { ok: true, games: old.games } : { ok: false, error: cons.error || 'consoles' };
    const list = cons.data.filter((c) => c.ID && c.Active !== false && c.IsGameSystem !== false);
    const games = [];
    let i = 0, fails = 0;
    const worker = async () => {
      while (i < list.length) {
        const c = list[i++];
        // liste avec hash déjà en cache (reconnaissance de la bibliothèque) ? on la réutilise
        let rows = null;
        try { rows = JSON.parse(fs.readFileSync(path.join(raCacheDir(), `list-${c.ID}-h.json`), 'utf-8')); } catch { /* absente */ }
        if (!Array.isArray(rows)) {
          const r = await raCall({ endpoint: 'GetGameList', params: { i: c.ID, f: 1 }, ttl: 604800 });
          rows = r.ok && Array.isArray(r.data) ? r.data : null;
        }
        if (!rows) { fails++; continue; }
        for (const x of rows) {
          const title = x.Title || x.title;
          if (title) games.push([x.ID || x.id, title, c.Name, x.ImageIcon || x.imageIcon || '', x.NumAchievements || 0, x.Points || 0]);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!games.length) return old ? { ok: true, games: old.games } : { ok: false, error: 'catalogue vide' };
    if (!fails) try {
      fs.mkdirSync(raCacheDir(), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ t: Date.now(), games }));
    } catch { /* cache facultatif */ }
    return { ok: true, games };
  })().finally(() => { catalogJob = null; });
  return catalogJob;
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
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const names = (d.tree || []).filter((x) => x.path.startsWith('Named_Boxarts/') && x.path.endsWith('.png')).map((x) => x.path.slice(14, -4));
    if (!names.length) return null;
    fs.mkdirSync(raCacheDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(names));
    return names;
  } catch {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }   // hors ligne : ancienne liste
  }
});

// rogne les bords transparents d'une jaquette (rendus de boîte avec marges) pour qu'elle remplisse sa place dans la roue
function trimCover(buf) {
  try {
    const img = nativeImage.createFromBuffer(buf);
    const { width: w, height: h } = img.getSize();
    if (!w || !h) return buf;
    const px = img.toBitmap();   // BGRA
    if (px.length < w * h * 4) return buf;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return buf;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    if (cw >= w - 2 && ch >= h - 2) return buf;            // rien à rogner
    if (cw < w * 0.3 || ch < h * 0.3) return buf;          // image presque vide : on n'y touche pas
    return img.crop({ x: x0, y: y0, width: cw, height: ch }).toPNG();
  } catch { return buf; }
}
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
    fs.writeFileSync(dest, trimCover(buf));
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
    // un .dll vide ou tronqué (téléchargement raté) ne compte pas : RALibretro ne pourrait pas le charger
    return fs.readdirSync(dir).filter((f) => /_libretro\.(dll|so|dylib)$/i.test(f) && fs.statSync(path.join(dir, f)).size >= 1024).map((f) => f.replace(/\.(dll|so|dylib)$/i, ''));
  } catch {
    return [];
  }
});

// cores RALibretro : téléchargés depuis le buildbot officiel libretro (Windows 64 bits), comme le fait RALibretro lui-même
const CORE_URL = process.env.EMUGLOB_CORE_URL || 'https://buildbot.libretro.com/nightly/windows/x86_64/latest/';
ipcMain.handle('cores:list', (_e, exe) => {   // { nom: { size, mtime } } des cores présents
  const out = {};
  try {
    const dir = path.join(path.dirname(exe), 'Cores');
    for (const f of fs.readdirSync(dir)) { const m = /^(.+_libretro)\.(dll|so|dylib)$/i.exec(f); if (!m) continue; const s = fs.statSync(path.join(dir, f)); out[m[1]] = { size: s.size, mtime: s.mtimeMs }; }
  } catch { /* pas de dossier Cores */ }
  return out;
});
ipcMain.handle('cores:delete', (_e, { exe, core }) => {
  if (!/^[a-z0-9_+-]+_libretro$/i.test(String(core || ''))) return { ok: false, error: 'nom de core invalide' };
  if (emucfg.running(exe)) return { ok: false, error: 'RALibretro est ouvert : ferme-le avant.' };
  try { fs.unlinkSync(path.join(path.dirname(exe), 'Cores', core + '.dll')); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('cores:download', async (_e, { exe, core }) => {
  if (!/^[a-z0-9_+-]+_libretro$/i.test(String(core || ''))) return { ok: false, error: 'nom de core invalide' };
  if (!exe || !fs.existsSync(exe)) return { ok: false, error: 'RALibretro introuvable' };
  if (emucfg.running(exe) && fs.existsSync(path.join(path.dirname(exe), 'Cores', core + '.dll'))) return { ok: false, error: 'RALibretro est ouvert : ferme-le pour mettre à jour ce core.' };
  const work = path.join(app.getPath('userData'), 'update', 'core-' + core);
  const send = (p) => { if (win && !win.isDestroyed()) win.webContents.send('inst:progress', { id: 'core', core, ...p }); };
  try {
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, 'x'), { recursive: true });
    const r = await fetch(CORE_URL + core + '.dll.zip', { headers: { 'User-Agent': 'Emuglob' }, signal: AbortSignal.timeout(300000) });
    if (r.status === 404) throw new Error("absent du buildbot libretro");
    if (!r.ok) throw new Error('téléchargement refusé (' + r.status + ')');
    const total = +r.headers.get('content-length') || 0, chunks = []; let got = 0;
    for await (const c of r.body) { chunks.push(c); got += c.length; send({ step: 'download', got, total }); }
    const buf = Buffer.concat(chunks);
    if (buf.slice(0, 2).toString() !== 'PK') throw new Error("le fichier téléchargé n'est pas un zip");
    const file = path.join(work, core + '.dll.zip');
    fs.writeFileSync(file, buf);
    send({ step: 'extract' });
    await extract(file, path.join(work, 'x'));
    const dll = findFile(path.join(work, 'x'), [core.toLowerCase() + '.dll'], 2);
    if (!dll || fs.statSync(dll).size < 1024) throw new Error(`${core}.dll introuvable dans l'archive`);
    const dir = path.join(path.dirname(exe), 'Cores');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(dll, path.join(dir, core + '.dll'));
    fs.rmSync(work, { recursive: true, force: true });
    embedLog(`core ${core} installé dans ${dir}`);
    return { ok: true };
  } catch (e) {
    embedLog(`core ${core} : ${e.message}`);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignoré */ }
    return { ok: false, error: e.message };
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
  const r = await dialog.showOpenDialog(win, { title: L('Choisir le nouvel app.asar', 'Choose the new app.asar'), properties: ['openFile'], filters: [{ name: 'app.asar', extensions: ['asar'] }] });
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
async function installRelease(rel) {
  if (!canUpdate()) return { ok: false, error: "disponible seulement dans l'application installée" };
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
}
ipcMain.handle('update:download', () => installRelease(lastRelease));
// toutes les versions publiées (pour en choisir une, même plus ancienne)
let allReleases = [];
ipcMain.handle('update:list', async () => {
  try {
    const list = await (await ghFetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=50`)).json();
    allReleases = (Array.isArray(list) ? list : []).filter((r) => !r.draft);
    const cur = app.getVersion();
    return {
      ok: true, current: cur, packaged: canUpdate(),
      list: allReleases.map((r) => {
        const asar = (r.assets || []).find((a) => a.name === 'app.asar');
        const v = String(r.tag_name || '').replace(/^v/i, '');
        return { tag: r.tag_name, version: v, date: r.published_at || '', pre: !!r.prerelease, notes: r.body || '', hasAsar: !!asar, size: asar ? asar.size : 0,
          current: !newerThan(v, cur) && !newerThan(cur, v) };
      }),
    };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update:installTag', (_e, tag) => {
  const rel = allReleases.find((r) => r.tag_name === tag);
  return rel ? installRelease(rel) : { ok: false, error: 'version introuvable, actualise la liste' };
});
ipcMain.handle('update:page', () => { if (lastRelease && /^https:\/\/github\.com\//.test(lastRelease.html_url)) shell.openExternal(lastRelease.html_url); });
ipcMain.handle('update:rollback', () => {
  const bak = updTarget() + '.bak';
  if (!canUpdate() || !fs.existsSync(bak)) return { ok: false, error: 'aucune version précédente' };
  try { launchUpdater(bak); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
