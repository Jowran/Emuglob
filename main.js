const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, screen, powerSaveBlocker } = require('electron');
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
  const r = await dialog.showOpenDialog(win, { title: 'Dossier de ROMs', properties: ['openDirectory'] });
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
          if (sync && sync.rom && sync.emu && sync.emu.id === 'cemu') {   // Wii U : copie du dossier de sauvegarde du jeu
            try {
              const loc = cemuSaveDir(exe, sync.rom, { tid: sync.tid, since: t0 });
              saved = loc.dir ? { ...getVault().snapDir(sync.gameId, loc.dir), tid: loc.tid } : { action: 'none', tid: loc.tid };
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
const INSTALLERS = {
  ralibretro: { name: 'RALibretro', dir: 'RALibretro', exes: ['ralibretro.exe'], latest: latestRalib },
  pcsx2: { name: 'PCSX2', dir: 'PCSX2', exes: ['pcsx2-qt.exe', 'pcsx2.exe'], latest: latestPcsx2 },
  cemu: { name: 'Cemu', dir: 'Cemu', exes: ['cemu.exe'], latest: latestCemu },
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
ipcMain.handle('game:move', (_e, r) => { if (helperObj && current && current.embedded) helperObj.send(`move ${r.x} ${r.y} ${r.w} ${r.h}`); });
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
  const r = await dialog.showOpenDialog(win, { title: 'Ton keys.txt (clés tirées de ta propre console)', properties: ['openFile'], filters: [{ name: 'keys.txt', extensions: ['txt'] }, { name: 'Tous', extensions: ['*'] }] });
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
  const r = await dialog.showOpenDialog(win, { title: 'Fichiers de sauvegarde', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Sauvegardes', extensions: exts }, { name: 'Tous', extensions: ['*'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('saves:pickdir', async () => { const r = await dialog.showOpenDialog(win, { title: 'Dossier contenant des sauvegardes', properties: ['openDirectory'] }); return r.canceled ? '' : r.filePaths[0]; });
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

/* ---------- RetroAchievements (appels faits ici : la clé ne quitte jamais ce processus) ---------- */
const RA_ALLOWED = new Set(['GetUserProfile', 'GetUserRecentAchievements', 'GetGameInfoAndUserProgress', 'GetGameList', 'GetUsersIFollow', 'GetGame', 'GetUserAwards', 'GetUserCompletionProgress', 'GetConsoleIDs']);
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
