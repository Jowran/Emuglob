// Point d'entrée d'Emuglob : vérifie l'installation avant de charger main.js,
// pour afficher un message clair (quel fichier, quoi faire) au lieu d'un plantage muet.
// N'utilise que des modules intégrés : il doit fonctionner même si le reste de l'app est abîmé.
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const HERE = __dirname;   // …\resources\app.asar
const EXE_DIR = path.dirname(process.execPath);
const ASAR_HINT = app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : HERE;
const REINSTALL = `Que faire : remets un app.asar sain dans « ${path.dirname(ASAR_HINT)} » (celui de la dernière version sur GitHub, ou renomme app.asar.bak en app.asar s'il existe).`;
const REDOWNLOAD = `Que faire : retélécharge Emuglob (fichier .zip de la dernière version sur GitHub), décompresse-le en entier, puis remets ce fichier dans « ${EXE_DIR} ».`;

let started = false;
function fatal(title, detail) {
  try { dialog.showErrorBox(`Emuglob ne peut pas démarrer : ${title}`, detail); } catch { /* rien d'autre à faire */ }
  app.exit(1);
}
// pendant le démarrage, toute erreur non prévue est expliquée ; ensuite Electron reprend son comportement habituel
const onCrash = (err) => {
  if (started) return;
  fatal('erreur interne', `${describe(err)}\n\n${REINSTALL}`);
};
process.on('uncaughtException', onCrash);
process.on('unhandledRejection', onCrash);

// « fichier.js, ligne 12 : message » à partir d'une erreur Node
function describe(err) {
  const msg = (err && err.message) || String(err);
  const m = /([\w.-]+\.(?:js|json|html)):(\d+)/.exec((err && err.stack) || '');
  return m ? `${m[1]}, ligne ${m[2]} : ${msg}` : msg;
}

// ---------- 1. fichiers internes de app.asar ----------
const REQUIRED = ['package.json', 'main.js', 'preload.js', 'index.html', 'romhash.js', 'discid.js', 'saves.js', 'discord.js', 'emucfg.js', 'tools/EmbedHelper.cs', 'tools/apply-update.js'];
function checkInternal() {
  const missing = REQUIRED.filter((f) => { try { return fs.statSync(path.join(HERE, f)).size === 0; } catch { return true; } });
  if (missing.length) {
    return fatal('app.asar incomplet', `Fichier(s) manquant(s) ou vide(s) dans app.asar :\n  • ${missing.join('\n  • ')}\n\napp.asar est abîmé ou ne vient pas d'Emuglob.\n\n${REINSTALL}`);
  }
  // empreintes enregistrées au moment du build (build-info.json) : détecte un fichier modifié ou corrompu
  let info = null;
  try { info = JSON.parse(fs.readFileSync(path.join(HERE, 'build-info.json'), 'utf-8')); } catch { /* build sans empreintes */ }
  if (info && info.sha256 && typeof info.sha256 === 'object') {
    const bad = Object.keys(info.sha256).filter((f) => {
      try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(HERE, f))).digest('hex') !== info.sha256[f]; } catch { return true; }
    });
    if (bad.length) return fatal('app.asar corrompu', `Fichier(s) abîmé(s) ou modifié(s) dans app.asar :\n  • ${bad.join('\n  • ')}\n\n${REINSTALL}`);
  }
  return true;
}

// ---------- 2. fichiers d'Electron à côté de Emuglob.exe ----------
// (ffmpeg.dll, icudtl.dat et les .bin sont lus avant ce code : s'ils manquent, c'est Windows qui affiche l'erreur)
function checkRuntime() {
  if (!app.isPackaged) return [];
  const want = ['resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'libEGL.dll', 'libGLESv2.dll', 'd3dcompiler_47.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'];
  const out = want.filter((f) => !fs.existsSync(path.join(EXE_DIR, f)));
  const loc = path.join(EXE_DIR, 'locales');
  if (!fs.existsSync(path.join(loc, 'fr.pak')) && !fs.existsSync(path.join(loc, 'en-US.pak'))) out.push('locales\\fr.pak');
  return out.length ? [`Fichier(s) d'Electron manquant(s) à côté de Emuglob.exe :\n  • ${out.join('\n  • ')}\n  L'affichage peut être lent ou incomplet. ${REDOWNLOAD}`] : [];
}

// ---------- 3. dossier de données et config.json ----------
const userDir = () => app.getPath('userData');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
function checkUserData() {
  const warn = [];
  const dir = userDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.ecriture-test');
    fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
  } catch (e) {
    warn.push(`Impossible d'écrire dans « ${dir} » (${e.code || e.message}).\n  Tes jeux et réglages ne seront pas enregistrés. Que faire : vérifie que ce dossier n'est pas en lecture seule ni bloqué par l'antivirus.`);
    return warn;
  }
  const cfg = path.join(dir, 'config.json');
  if (!fs.existsSync(cfg)) return warn;   // première ouverture : rien à vérifier
  let data = null, why = '';
  try {
    data = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) why = "le contenu n'est pas une configuration Emuglob";
    else if (data.games !== undefined && !Array.isArray(data.games)) why = 'la liste de jeux (« games ») est invalide';
  } catch (e) { why = e.message; }
  if (!why) return warn.concat(checkEmulators(data));
  // config illisible : on la met de côté (main.js reprendra la dernière sauvegarde valable, ou une bibliothèque vide)
  const aside = path.join(dir, `config-illisible-${stamp()}.json`);
  try { fs.renameSync(cfg, aside); } catch { /* on garde au moins le message */ }
  const bdir = path.join(dir, 'backups');
  let backup = '';
  try {
    for (const f of fs.readdirSync(bdir).filter((x) => /^config-.*\.json$/.test(x)).sort().reverse()) {
      try { const d = JSON.parse(fs.readFileSync(path.join(bdir, f), 'utf-8')); if (Array.isArray(d.games)) { fs.copyFileSync(path.join(bdir, f), cfg); backup = `${f} (${d.games.length} jeux)`; break; } } catch { /* suivante */ }
    }
  } catch { /* pas de sauvegardes */ }
  warn.push(`config.json est illisible (${why}).\n  Le fichier abîmé a été mis de côté : ${aside}\n  ${backup ? `Emuglob repart de la dernière sauvegarde valable : ${backup}.` : "Aucune sauvegarde valable : Emuglob démarre avec une bibliothèque vide. Tu peux réparer le fichier mis de côté puis l'importer (Paramètres, Sauvegardes, Importer)."}`);
  return warn;
}

// émulateurs configurés mais introuvables (disque débranché, dossier déplacé ou renommé)
function checkEmulators(cfg) {
  let found = {};
  try { found = require('./emucfg.js').detect(app.isPackaged ? EXE_DIR : path.join(HERE, '..')); } catch { /* détection facultative */ }
  const list = (Array.isArray(cfg.emulators) ? cfg.emulators : []).filter((e) => !(e && found[e.id]));   // sera remplacé par celui du dossier « emulators »
  const seen = new Set(), out = [];
  for (const e of list.concat(cfg.ralibretro && !found.ralibretro ? [{ name: 'RALibretro', exe: cfg.ralibretro }] : [])) {
    if (!e || !e.exe || typeof e.exe !== 'string' || seen.has(e.exe.toLowerCase())) continue;
    seen.add(e.exe.toLowerCase());
    if (!fs.existsSync(e.exe)) out.push(`${e.name || 'Émulateur'} : ${e.exe}`);
  }
  return out.length ? [`Émulateur(s) introuvable(s) :\n  • ${out.join('\n  • ')}\n  Que faire : rebranche le disque, ou corrige le chemin dans Paramètres, Émulateurs.`] : [];
}

// les avertissements ne bloquent pas : ils s'affichent une fois par problème différent
function showWarnings(win, warns) {
  const memo = path.join(userDir(), 'startup-check.json');
  const key = crypto.createHash('sha1').update(warns.join('\n')).digest('hex');
  let last = '';
  try { last = JSON.parse(fs.readFileSync(memo, 'utf-8')).shown; } catch { /* jamais affiché */ }
  if (last === key) return;
  dialog.showMessageBox(win, {
    type: 'warning', title: 'Emuglob', buttons: ['Continuer', 'Quitter'], defaultId: 0, cancelId: 0, noLink: true,
    message: warns.length > 1 ? `${warns.length} problèmes détectés au démarrage` : 'Problème détecté au démarrage',
    detail: warns.join('\n\n'),
  }).then((r) => {
    if (r.response === 1) return app.quit();
    try { fs.writeFileSync(memo, JSON.stringify({ shown: key })); } catch { /* tant pis, il reviendra */ }
  }, () => {});
}

// ---------- démarrage ----------
if (checkInternal() === true) {
  let warns = [];
  try { warns = checkRuntime().concat(checkUserData()); } catch (e) { warns.push('Vérification incomplète : ' + e.message); }

  app.on('browser-window-created', (_e, win) => {
    const wc = win.webContents;
    wc.on('did-fail-load', (_ev, code, desc, url, main) => {
      if (!started && main) fatal("index.html n'a pas pu s'ouvrir", `${desc} (${code})\n${url}\n\n${REINSTALL}`);
    });
    wc.once('render-process-gone', (_ev, d) => {
      if (!started) fatal("la fenêtre s'est fermée au démarrage", `Raison : ${d.reason} (code ${d.exitCode}).\n\nSi ça se répète : ${REINSTALL.replace(/^Que faire : /, '')}`);
    });
    wc.once('did-finish-load', () => {
      started = true;
      process.removeListener('uncaughtException', onCrash);
      process.removeListener('unhandledRejection', onCrash);
      if (warns.length) showWarnings(win, warns);
    });
  });

  try { require('./main.js'); } catch (err) {
    const missing = err && err.code === 'MODULE_NOT_FOUND' && /Cannot find module '([^']+)'/.exec(err.message);
    fatal(missing ? `module ${missing[1]} introuvable` : 'erreur dans le code',
      `${missing ? `Le fichier ${missing[1]} manque dans app.asar ou est mal nommé.` : describe(err)}\n\n${REINSTALL}`);
  }
}
