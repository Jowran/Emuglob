// Partage des sauvegardes « cartouche » (SRAM / pile) entre émulateurs.
// Principe : avant le lancement, si un autre émulateur (ou le coffre d'Emuglob) a une sauvegarde plus récente du même jeu,
// elle est copiée à l'endroit où l'émulateur lancé la cherche. Après la partie, sa sauvegarde est copiée dans le coffre.
// Rien n'est jamais supprimé : toute sauvegarde remplacée part d'abord dans l'historique du jeu (20 dernières).
// Formats compatibles : sauvegardes brutes (.sram RALibretro, .sav mGBA / melonDS / SameBoy…, .srm Snes9x, carte mémoire PS1 .mcd/.srm).
// Hors champ : sauvegardes en dossiers (Dolphin, PCSX2, PPSSPP, Switch, 3DS) et états de sauvegarde (save states, propres à chaque émulateur).
const fs = require('fs');
const path = require('path');

const KEEP = 20;
const stemOf = (p) => path.basename(p, path.extname(p));
const low = (s) => s.toLowerCase();

// nom du fichier à l'intérieur d'un .zip (RALibretro nomme la sauvegarde d'après lui)
function zipInnerName(file) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const n = Math.min(st.size, 65557), b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, st.size - n);
    let e = n - 22;
    while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
    if (e < 0) { fs.closeSync(fd); return null; }
    const cdSize = b.readUInt32LE(e + 12), cdOff = b.readUInt32LE(e + 16), cnt = b.readUInt16LE(e + 10);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    fs.closeSync(fd);
    let off = 0;
    for (let i = 0; i < cnt && off + 46 <= cd.length; i++) {
      const nlen = cd.readUInt16LE(off + 28), elen = cd.readUInt16LE(off + 30), clen = cd.readUInt16LE(off + 32);
      const name = cd.toString('utf8', off + 46, off + 46 + nlen);
      off += 46 + nlen + elen + clen;
      if (!name.endsWith('/')) return name.split('/').pop();
    }
  } catch { /* zip illisible */ }
  return null;
}

function walk(dir, depth, cb) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (depth > 0) walk(p, depth - 1, cb); } else cb(p);
  }
}
const statOf = (p) => { try { const s = fs.statSync(p); return s.isFile() && s.size > 0 ? s : null; } catch { return null; } };
// sauvegarde vide (que des 0xFF ou des 0x00) : l'émulateur l'a créée sans que le jeu ait rien enregistré, elle ne doit jamais l'emporter
function isBlank(p) {
  try {
    const b = fs.readFileSync(p);
    if (!b.length) return true;
    const v = b[0];
    if (v !== 0xff && v !== 0x00) return false;
    for (let i = 1; i < b.length; i++) if (b[i] !== v) return false;
    return true;
  } catch { return true; }
}

// ---------- RetroArch : <dossier>\saves\[Core\]<jeu>.srm (format libretro brut, identique à RALibretro) ----------
const raCache = { t: 0, roots: [] };
function retroarchSaveRoots(env = process.env) {
  if (Date.now() - raCache.t < 60000) return raCache.roots;
  const H = env.USERPROFILE || env.HOME || '', A = env.APPDATA || '';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', pf = env.ProgramFiles || 'C:\\Program Files';
  const bases = ['C:\\RetroArch-Win64', 'C:\\RetroArch', 'D:\\RetroArch-Win64', 'D:\\RetroArch', path.join(A, 'RetroArch'), path.join(H, 'RetroArch'),
    path.join(pf, 'RetroArch'), path.join(pf86, 'Steam', 'steamapps', 'common', 'RetroArch'), path.join(pf, 'Steam', 'steamapps', 'common', 'RetroArch')];
  const roots = [];
  for (const b of bases) {
    let cfg = '';
    try { cfg = fs.readFileSync(path.join(b, 'retroarch.cfg'), 'utf-8'); } catch { if (!fs.existsSync(path.join(b, 'saves'))) continue; }
    let dir = (/^\s*savefile_directory\s*=\s*"([^"]*)"/m.exec(cfg) || [])[1] || '';
    if (!dir || dir === 'default') dir = path.join(b, 'saves');
    else if (/^:[\\/]/.test(dir)) dir = path.join(b, dir.slice(2));   // « :\saves » = relatif au dossier de RetroArch
    roots.push({ dir, inContent: /^\s*savefiles_in_content_dir\s*=\s*"true"/m.test(cfg) });
  }
  raCache.t = Date.now(); raCache.roots = roots;
  return roots;
}
// sauvegardes RetroArch de ce jeu (dans saves\, ses sous-dossiers par core / par dossier de contenu, ou à côté de la ROM)
function retroarchSaves(rom, env = process.env) {
  const want = low(stemOf(rom) + '.srm'), out = [];
  for (const r of retroarchSaveRoots(env)) {
    walk(r.dir, 2, (p) => { if (low(path.basename(p)) === want) out.push(p); });
    if (r.inContent) { const p = path.join(path.dirname(rom), stemOf(rom) + '.srm'); if (statOf(p)) out.push(p); }
  }
  return [...new Set(out)];
}

// où cet émulateur range la sauvegarde de ce jeu : { found: [chemins existants], target: chemin par défaut } ou null (pas de partage)
function locate(emu, rom) {
  if (!emu || !rom) return null;
  if (emu.kind === 'libretro') {
    if (!emu.exe) return null;
    // RALibretro : <dossier de l'exe>\Saves\[Console\][Core\][Jeu\]<fichier du jeu>.sram (selon ses réglages)
    const root = path.join(path.dirname(emu.exe), 'Saves');
    const inner = (low(path.extname(rom)) === '.zip' && zipInnerName(rom)) || path.basename(rom);
    const full = low(inner + '.sram'), short = low(stemOf(inner) + '.sram');
    const exact = [], loose = [];
    walk(root, 4, (p) => {
      const b = low(path.basename(p));
      if (b === full) exact.push(p);
      else if (b === short && path.dirname(p) !== root) loose.push(p);
    });
    return { found: exact.length ? exact : loose, target: path.join(root, inner + '.sram') };
  }
  if (!emu.shareSaves) return null;
  const dir = emu.saveDir || path.dirname(rom);
  let ext = (emu.saveExt || '.sav').trim();
  if (!ext.startsWith('.')) ext = '.' + ext;
  const found = [...new Set([ext, '.sav', '.srm'].map(low))].map((e) => path.join(dir, stemOf(rom) + e)).filter((p) => statOf(p));
  return { found, target: path.join(dir, stemOf(rom) + ext) };
}

const newest = (paths) => paths.filter((p) => !isBlank(p)).map((p) => ({ p, s: statOf(p) })).filter((x) => x.s).sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)[0] || null;
const same = (a, b) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 60);

class SaveVault {
  constructor(base) { this.base = base; }
  dir(gameId) { return path.join(this.base, safe(gameId)); }
  file(gameId) { return path.join(this.dir(gameId), 'save.bin'); }
  // met une copie de côté avant tout remplacement
  keep(gameId, src, label) {
    if (!statOf(src)) return;
    const h = path.join(this.dir(gameId), 'historique');
    fs.mkdirSync(h, { recursive: true });
    const t = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23);
    fs.copyFileSync(src, path.join(h, `${t}_${safe(label)}${path.extname(src) || '.bin'}`));
    const all = fs.readdirSync(h).sort();
    for (const f of all.slice(0, Math.max(0, all.length - KEEP))) { try { fs.unlinkSync(path.join(h, f)); } catch { /* tant pis */ } }
  }
  copy(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const s = fs.statSync(src);
    fs.copyFileSync(src, dst);
    fs.utimesSync(dst, s.atime, s.mtime);   // garde la date d'origine : les comparaisons restent justes
  }

  // avant le lancement : renvoie { action: 'copied' | 'kept' | 'none' | 'off', from }
  prepare({ gameId, rom, emu, emus }) {
    const own = locate(emu, rom);
    if (!own) return { action: 'off' };
    const mine = newest(own.found);
    const pool = [];
    for (const e of emus || []) {
      if (e.id === emu.id) continue;
      const l = locate(e, rom);
      if (l) l.found.forEach((p) => pool.push({ p, from: e.name }));
    }
    if (emu.kind === 'libretro') for (const p of retroarchSaves(rom)) if (!own.found.includes(p)) pool.push({ p, from: 'RetroArch' });
    if (statOf(this.file(gameId))) pool.push({ p: this.file(gameId), from: 'Emuglob' });
    const best = pool.filter((x) => !isBlank(x.p)).map((x) => ({ ...x, s: statOf(x.p) })).filter((x) => x.s).sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)[0];
    if (!best) return { action: 'none' };
    if (mine && (mine.s.mtimeMs >= best.s.mtimeMs - 2000 || same(mine.p, best.p))) return { action: 'kept' };
    // sauvegarde vide de l'émulateur lancé : remplacée elle aussi (gardée dans l'historique)
    const blank = !mine && own.found.find((p) => statOf(p));
    const dst = mine ? mine.p : blank || own.target;
    if (mine || blank) this.keep(gameId, dst, `${emu.name}-remplacee`);
    this.copy(best.p, dst);
    return { action: 'copied', from: best.from, to: dst };
  }

  // après la partie : copie la sauvegarde de l'émulateur dans le coffre
  collect({ gameId, rom, emu }) {
    const own = locate(emu, rom);
    if (!own) return { action: 'off' };
    const mine = newest(own.found);
    if (!mine) return { action: 'none' };
    const v = this.file(gameId);
    const res = { action: 'kept' };
    if (!(statOf(v) && same(v, mine.p))) {
      this.keep(gameId, v, 'coffre');
      this.copy(mine.p, v);
      fs.writeFileSync(path.join(this.dir(gameId), 'source.txt'), `${emu.name}\n${mine.p}\n${new Date().toISOString()}\n`);
      Object.assign(res, { action: 'saved', from: mine.p });
    }
    // RetroArch : sa sauvegarde du jeu (si elle existe déjà) est mise à jour, l'ancienne part d'abord dans l'historique
    if (emu.kind === 'libretro') {
      for (const p of retroarchSaves(rom)) {
        const s = statOf(p);
        if (!s || s.size !== mine.s.size || s.mtimeMs >= mine.s.mtimeMs - 2000 || same(p, mine.p)) continue;
        try { this.keep(gameId, p, 'RetroArch-remplacee'); this.copy(mine.p, p); (res.retroarch = res.retroarch || []).push(p); } catch { /* fichier verrouillé : tant pis */ }
      }
    }
    return res;
  }
}

// ---------- recherche des sauvegardes déjà présentes ailleurs sur le PC (import dans le coffre, l'original n'est jamais touché) ----------
const SAVE_EXT = new Set(['.srm', '.sav', '.sram', '.mcd', '.mcr', '.dsv', '.eep', '.fla', '.sa1']);
const MAX_SAVE = 4 * 1048576;
// clé d'un nom : sans les extensions empilées (Jeu.gba.sram → jeu) ; version souple sans (Europe) [!] ni ponctuation
const keyOf = (name) => low(stemOf(name)).trim();
// Jeu.sram → [jeu] ; Jeu.gba.sram → [jeu.gba, jeu] (la 2e extension n'est retirée qu'en second choix : « F.Zero.srm » reste « f.zero »)
const saveKeys = (name) => { const a = keyOf(name), e = path.extname(a); return e && /^\.[a-z0-9]{1,4}$/.test(e) ? [a, a.slice(0, -e.length)] : [a]; };
const looseOf = (k) => k.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/_\d$/, '').replace(/[^a-z0-9]+/g, '');

// dossiers habituels des émulateurs (Windows), en plus des dossiers des ROMs et des émulateurs réglés
function defaultSaveDirs(env) {
  const H = env.USERPROFILE || env.HOME || '', A = env.APPDATA || '', D = path.join(H, 'Documents');
  return [
    path.join(A, 'RetroArch', 'saves'), 'C:\\RetroArch-Win64\\saves', 'C:\\RetroArch\\saves', path.join(H, 'RetroArch', 'saves'),
    path.join(D, 'RALibretro', 'Saves'), path.join(D, 'DuckStation', 'memcards'), path.join(H, 'DuckStation', 'memcards'),
    path.join(D, 'mGBA'), path.join(A, 'mGBA'), path.join(A, 'melonDS'), path.join(D, 'melonDS'), path.join(A, 'Snes9x', 'Saves'),
    path.join(D, 'Mesen', 'Saves'), path.join(D, 'Mesen2', 'Saves'), path.join(A, 'bsnes'), path.join(D, 'SameBoy'),
    path.join(A, 'Project64', 'Save'), 'C:\\Program Files (x86)\\Project64 3.0\\Save', path.join(D, 'Emulateurs'), path.join(D, 'Emulators'),
  ];
}

// renvoie [{ gameId, title, file, size, mtime, where, match: 'exact'|'proche', vault: { mtime } | null, same, newer }]
function findExisting({ games, emus, extraDirs = [], files = [], vaultBase, env = process.env }) {
  const exact = new Map(), loose = new Map();
  const add = (m, k, g) => { if (!k) return; if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(g)) m.get(k).push(g); };
  for (const g of games || []) {
    if (!g || !g.path) continue;
    const names = [path.basename(g.path)];
    if (low(path.extname(g.path)) === '.zip') { const z = zipInnerName(g.path); if (z) names.push(z); }
    for (const n of names) { add(exact, keyOf(n), g); add(loose, looseOf(keyOf(n)), g); }
    if (g.title) { add(exact, low(g.title).trim(), g); add(loose, looseOf(low(g.title)), g); }
  }
  // dossiers à fouiller : [dossier, profondeur, libellé]
  const dirs = [];
  const romDirs = new Set((games || []).filter((g) => g && g.path).map((g) => path.dirname(g.path)));
  for (const d of romDirs) { dirs.push([d, 0, 'à côté des ROMs']); for (const s of ['saves', 'Saves', 'save', 'Save', 'sav']) dirs.push([path.join(d, s), 2, 'à côté des ROMs']); }
  for (const e of emus || []) if (e && e.exe) dirs.push([path.dirname(e.exe), 4, e.name]);
  for (const d of defaultSaveDirs(env)) dirs.push([d, 3, 'dossier de ' + (d.split(/[\\/]/).find((x) => /retroarch|ralibretro|duckstation|mgba|melonds|snes9x|mesen|bsnes|sameboy|project64|emul/i.test(x)) || 'l\'émulateur')]);
  for (const d of extraDirs) dirs.push([d, 5, 'dossier choisi']);
  const vaultAbs = vaultBase ? path.resolve(vaultBase) : null;
  const seen = new Set(), out = [];
  // fichiers choisis un par un : gardés même sans jeu reconnu (l'utilisateur choisira le jeu)
  for (const p of files) {
    const st = statOf(p); if (!st || st.size > MAX_SAVE) continue;
    seen.add(low(path.resolve(p)));
    const ks = saveKeys(path.basename(p));
    let gs = ks.map((k) => exact.get(k)).find(Boolean), match = 'exact';
    if (!gs) { gs = ks.map((k) => loose.get(looseOf(k))).find(Boolean); match = 'proche'; }
    const g = gs && gs.length === 1 ? gs[0] : null;
    out.push({ gameId: g ? g.id : null, title: g ? g.title || stemOf(g.path) : '', file: p, size: st.size, mtime: st.mtimeMs, where: 'fichier choisi', match: g ? match : 'aucun', picked: true });
  }
  for (const [dir, depth, where] of dirs) {
    if (!dir) continue;
    walk(dir, depth, (p) => {
      const rp = path.resolve(p);
      if (seen.has(low(rp)) || (vaultAbs && low(rp).startsWith(low(vaultAbs) + path.sep))) return;
      if (!SAVE_EXT.has(low(path.extname(p)))) return;
      seen.add(low(rp));
      const st = statOf(p); if (!st || st.size > MAX_SAVE) return;
      const ks = saveKeys(path.basename(p));
      let gs = ks.map((k) => exact.get(k)).find(Boolean), match = 'exact';
      if (!gs) { gs = ks.map((k) => loose.get(looseOf(k))).find(Boolean); match = 'proche'; }
      if (!gs || gs.length !== 1) return;   // aucun jeu, ou plusieurs jeux possibles : on ne devine pas
      const g = gs[0];
      out.push({ gameId: g.id, title: g.title || stemOf(g.path), file: p, size: st.size, mtime: st.mtimeMs, where, match });
    });
  }
  if (vaultBase) {
    const v = new SaveVault(vaultBase);
    for (const c of out) {
      if (!c.gameId) { c.vault = null; c.same = false; c.newer = true; continue; }
      const vs = statOf(v.file(c.gameId));
      c.vault = vs ? { mtime: vs.mtimeMs } : null;
      c.same = !!vs && same(v.file(c.gameId), c.file);
      c.newer = !vs || (!c.same && c.mtime > vs.mtimeMs + 2000);
    }
  }
  // pour un même jeu, la plus récente d'abord
  return out.sort((a, b) => (a.gameId ? 0 : 1) - (b.gameId ? 0 : 1) || a.title.localeCompare(b.title) || b.mtime - a.mtime);
}

// copie les sauvegardes choisies dans le coffre ; l'ancienne du coffre part dans l'historique ; l'original reste en place
function importExisting(vaultBase, items) {
  const v = new SaveVault(vaultBase), done = [], errors = [];
  for (const { gameId, file } of items || []) {
    try {
      if (!statOf(file) || statOf(file).size > MAX_SAVE) throw new Error('fichier introuvable');
      const dst = v.file(String(gameId));
      if (statOf(dst) && same(dst, file)) { done.push({ gameId, file, action: 'kept' }); continue; }
      v.keep(String(gameId), dst, 'avant-import');
      v.copy(file, dst);
      fs.writeFileSync(path.join(v.dir(String(gameId)), 'source.txt'), `import\n${file}\n${new Date().toISOString()}\n`);
      done.push({ gameId, file, action: 'imported' });
    } catch (e) { errors.push({ gameId, file, error: e.message }); }
  }
  return { done, errors };
}

// ---------- Cemu (Wii U) : sauvegardes en dossier, mlc01\usr\save\<id haut>\<id bas>\ ; copies complètes dans le coffre ----------
const KEEP_DIRS = 10;
// où Cemu range ses données : à côté de l'exe (portable / ancien Cemu) ou %APPDATA%\Cemu (Cemu 2.x installé)
const cemuDataDirs = (exe, env) => [...(exe ? [path.join(path.dirname(exe), 'portable'), path.dirname(exe)] : []), ...(env.APPDATA ? [path.join(env.APPDATA, 'Cemu')] : []),
  ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Cemu')] : [])];
function cemuMlcRoots(exe, env = process.env) {
  const out = [];
  for (const s of cemuDataDirs(exe, env).map((d) => path.join(d, 'settings.xml'))) {
    try { const m = /<mlc_path>([^<]*)<\/mlc_path>/i.exec(fs.readFileSync(s, 'utf-8')); if (m && m[1].trim()) out.push(path.resolve(path.dirname(s), m[1].trim())); } catch { /* absent */ }
  }
  out.push(...cemuDataDirs(exe, env).map((d) => path.join(d, 'mlc01')));
  return [...new Set(out)].filter((x) => { try { return fs.statSync(path.join(x, 'usr', 'save')).isDirectory(); } catch { return false; } });
}
// noms des jeux connus de Cemu (title_list_cache.xml) : { identifiant: nom } — pour les .wua / .wux / .wud sans meta.xml
function cemuTitleNames(exe, env = process.env) {
  const out = {};
  for (const d of cemuDataDirs(exe, env)) {
    let xml; try { xml = fs.readFileSync(path.join(d, 'title_list_cache.xml'), 'utf-8'); } catch { continue; }
    for (const m of xml.matchAll(/<title\b([^>]*)>([\s\S]*?)<\/title>/g)) {
      const id = (/titleId="([0-9a-fA-F]{16})"/.exec(m[1]) || /<title_?id>\s*([0-9a-fA-F]{16})/i.exec(m[2]) || [])[1];
      const name = (/<name>([^<]+)<\/name>/.exec(m[2]) || [])[1];
      if (id && name) out[low(id)] = name.trim();
    }
  }
  return out;
}
const nameKey = (s) => low(String(s || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, '');
// identifiant du jeu (16 hexa) : meta.xml d'un jeu extrait (.rpx dans code\)
function wiiuTitleId(rom) {
  try {
    const xml = fs.readFileSync(path.join(path.dirname(path.dirname(rom)), 'meta', 'meta.xml'), 'utf-8');
    const m = /<title_id[^>]*>\s*([0-9a-fA-F]{16})\s*<\/title_id>/.exec(xml);
    return m ? low(m[1]) : '';
  } catch { return ''; }
}
function newestMtime(dir, depth = 6) {
  let best = 0;
  const go = (d, n) => { let l; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of l) { const p = path.join(d, e.name); if (e.isDirectory()) { if (n) go(p, n - 1); } else { try { best = Math.max(best, fs.statSync(p).mtimeMs); } catch { /* ignoré */ } } } };
  go(dir, depth);
  return best;
}
// dossier de sauvegarde du jeu : par identifiant connu (meta.xml ou déjà trouvé), sinon celui modifié pendant la partie
function cemuSaveDir(exe, rom, { tid, since, title } = {}) {
  const roots = cemuMlcRoots(exe);
  let id = low(tid || wiiuTitleId(rom) || '');
  if (!id && title) {   // .wua / .wux / .wud : identifiant retrouvé par le nom dans la liste de jeux de Cemu
    const want = nameKey(title), names = cemuTitleNames(exe);
    const hit = Object.keys(names).filter((k) => /^00050000/.test(k) && nameKey(names[k]) === want);
    if (hit.length === 1) id = hit[0];
  }
  if (/^[0-9a-f]{16}$/.test(id)) {
    for (const r of roots) { const p = path.join(r, 'usr', 'save', id.slice(0, 8), id.slice(8)); if (fs.existsSync(p)) return { dir: p, tid: id }; }
    if (!since) return { dir: null, tid: id };
  }
  if (!since) return { dir: null, tid: '' };
  let best = null;
  for (const r of roots) {
    const base = path.join(r, 'usr', 'save', '00050000');
    let l = []; try { l = fs.readdirSync(base, { withFileTypes: true }); } catch { /* aucun */ }
    for (const e of l) if (e.isDirectory() && /^[0-9a-f]{8}$/i.test(e.name)) {
      const p = path.join(base, e.name), t = newestMtime(p);
      if (t >= since - 3000 && (!best || t > best.t)) best = { dir: p, tid: '00050000' + low(e.name), t };
    }
  }
  return best ? { dir: best.dir, tid: best.tid } : { dir: null, tid: '' };
}
const dirSig = (dir) => { const a = []; const go = (d, rel) => { let l; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of l.sort((x, y) => (x.name < y.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) go(p, rel + e.name + '/'); else { const s = fs.statSync(p); a.push(`${rel}${e.name}:${s.size}:${Math.round(s.mtimeMs / 1000)}`); } } };
  go(dir, ''); return a.join('|'); };
SaveVault.prototype.snapDir = function snapDir(gameId, src, label) {
  const base = path.join(this.dir(gameId), 'wiiu');
  fs.mkdirSync(base, { recursive: true });
  const all = fs.readdirSync(base).filter((f) => fs.statSync(path.join(base, f)).isDirectory()).sort();
  if (all.length && dirSig(path.join(base, all[all.length - 1])) === dirSig(src)) return { action: 'kept' };
  const name = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19) + (label ? '_' + safe(label) : '');
  fs.cpSync(src, path.join(base, name), { recursive: true, preserveTimestamps: true });
  for (const f of [...all, name].sort().slice(0, Math.max(0, all.length + 1 - KEEP_DIRS))) { try { fs.rmSync(path.join(base, f), { recursive: true, force: true }); } catch { /* tant pis */ } }
  return { action: 'saved', name };
};
SaveVault.prototype.listDir = function listDir(gameId) {
  const base = path.join(this.dir(gameId), 'wiiu');
  try { return fs.readdirSync(base).filter((f) => fs.statSync(path.join(base, f)).isDirectory()).sort().reverse().map((f) => ({ name: f, mtime: newestMtime(path.join(base, f)) })); } catch { return []; }
};
// remet une copie du coffre dans Cemu ; l'état actuel est d'abord gardé dans le coffre
SaveVault.prototype.restoreDir = function restoreDir(gameId, name, dst) {
  const src = path.join(this.dir(gameId), 'wiiu', path.basename(name));
  if (!fs.existsSync(src)) throw new Error('copie introuvable');
  if (fs.existsSync(dst)) this.snapDir(gameId, dst, 'avant-restauration');
  const tmp = dst + '.emuglob-tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(src, tmp, { recursive: true, preserveTimestamps: true });
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.renameSync(tmp, dst);
};

// ---------- Cemu : les autres installations du PC (portable, autre dossier, ancien Cemu) partagent leurs sauvegardes ----------
// recherche de Cemu.exe : emplacements habituels + racine des disques (2 niveaux, 3 dans les dossiers « émulateurs / jeux »)
const cemuScan = { t: 0, exes: [] };
const SKIP_DIR = /^(\$|windows$|system volume information$|programdata$|recovery$|perflogs$|intel$|amd$|nvidia$|msocache$|config\.msi$|node_modules$|\.)/i;
const DEEP_DIR = /emu|cemu|wii|jeu|game|program|t[ée]l[ée]ch|download|bureau|desktop|document|portable|tools|outils/i;
function findCemuExes(env = process.env, extra = []) {
  if (Date.now() - cemuScan.t < 10 * 60000) return cemuScan.exes;
  const H = env.USERPROFILE || env.HOME || '';
  const found = new Set();
  const check = (dir) => { for (const n of ['Cemu.exe', 'cemu.exe']) { const p = path.join(dir, n); if (statOf(p)) { found.add(path.resolve(p)); return; } } };
  const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIR.test(e.name)).map((e) => path.join(d, e.name)); } catch { return []; } };
  const t0 = Date.now();
  for (const d of [...extra, path.join(H, 'Documents'), path.join(H, 'Desktop'), path.join(H, 'Downloads'), env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
    check(d); for (const a of subdirs(d)) { check(a); for (const b of subdirs(a)) check(b); }
  }
  if (process.platform === 'win32') {
    for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = L + ':\\';
      if (!fs.existsSync(root)) continue;
      for (const a of subdirs(root)) {
        if (Date.now() - t0 > 4000) break;   // disque lent : on s'arrête là
        check(a);
        for (const b of subdirs(a)) { check(b); if (DEEP_DIR.test(path.basename(a)) || DEEP_DIR.test(path.basename(b))) for (const c of subdirs(b)) check(c); }
      }
    }
  }
  cemuScan.t = Date.now(); cemuScan.exes = [...found];
  return cemuScan.exes;
}
// dossiers mlc01 des AUTRES Cemu (ceux du Cemu lancé par Emuglob exclus)
function cemuOtherRoots(exe, env = process.env) {
  const own = new Set(cemuMlcRoots(exe, env).map((r) => low(path.resolve(r))));
  const me = exe ? low(path.resolve(exe)) : '';
  const out = [];
  for (const x of findCemuExes(env, exe ? [path.dirname(path.dirname(exe))] : [])) {
    if (low(x) === me) continue;
    for (const r of cemuMlcRoots(x, env)) { const k = low(path.resolve(r)); if (!own.has(k)) { own.add(k); out.push({ root: r, exe: x }); } }
  }
  return out;
}
const cemuTid = (exe, rom, { tid, title } = {}) => {
  let id = low(tid || wiiuTitleId(rom) || '');
  if (!id && title) {
    const want = nameKey(title), names = Object.assign({}, ...[exe, ...findCemuExes()].map((x) => cemuTitleNames(x)));
    const hit = Object.keys(names).filter((k) => /^00050000/.test(k) && nameKey(names[k]) === want);
    if (hit.length === 1) id = hit[0];
  }
  return /^[0-9a-f]{16}$/.test(id) ? id : '';
};
const saveIn = (root, id) => path.join(root, 'usr', 'save', id.slice(0, 8), id.slice(8));
const hasFiles = (d) => newestMtime(d) > 0;
function replaceDir(src, dst) {
  const tmp = dst + '.emuglob-tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(src, tmp, { recursive: true, preserveTimestamps: true });
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(tmp, dst);
}
// avant le lancement : reprend la sauvegarde d'un autre Cemu si elle est plus récente (l'actuelle part d'abord dans le coffre)
SaveVault.prototype.cemuPrepare = function cemuPrepare({ gameId, exe, rom, tid, title }) {
  const id = cemuTid(exe, rom, { tid, title });
  if (!id) return { action: 'none' };
  // Cemu jamais lancé : pas encore de mlc01, on prend celui qu'il utilisera (portable\ si présent, sinon %APPDATA%\Cemu)
  const ownRoots = cemuMlcRoots(exe);
  if (!ownRoots.length) {
    const env = process.env, ex = path.dirname(exe || '');
    ownRoots.push(fs.existsSync(path.join(ex, 'portable')) ? path.join(ex, 'portable', 'mlc01')
      : fs.existsSync(path.join(ex, 'settings.xml')) || !env.APPDATA ? path.join(ex, 'mlc01') : path.join(env.APPDATA, 'Cemu', 'mlc01'));
  }
  const mine = ownRoots.map((r) => saveIn(r, id)).find((d) => hasFiles(d)) || saveIn(ownRoots[0], id);
  const mineT = hasFiles(mine) ? newestMtime(mine) : 0;
  const best = cemuOtherRoots(exe).map((o) => ({ ...o, dir: saveIn(o.root, id) })).filter((o) => hasFiles(o.dir))
    .map((o) => ({ ...o, t: newestMtime(o.dir) })).sort((a, b) => b.t - a.t)[0];
  if (!best || best.t <= mineT + 2000 || dirSig(best.dir) === dirSig(mine)) return { action: mineT ? 'kept' : 'none', tid: id };
  if (mineT) this.snapDir(String(gameId), mine, 'avant-reprise');
  replaceDir(best.dir, mine);
  return { action: 'copied', from: 'Cemu (' + path.dirname(best.exe) + ')', to: mine, tid: id };
};
// après la partie : met à jour la sauvegarde des autres Cemu qui ont déjà ce jeu (l'ancienne part d'abord dans le coffre)
SaveVault.prototype.cemuPush = function cemuPush({ gameId, exe, dir, tid }) {
  if (!dir || !/^[0-9a-f]{16}$/.test(tid || '') || !hasFiles(dir)) return [];
  const t = newestMtime(dir), done = [];
  for (const o of cemuOtherRoots(exe)) {
    const d = saveIn(o.root, tid);
    if (!hasFiles(d) || newestMtime(d) >= t - 2000 || dirSig(d) === dirSig(dir)) continue;
    try { this.snapDir(String(gameId), d, 'autre-Cemu-remplacee'); replaceDir(dir, d); done.push(d); } catch { /* fichier verrouillé : tant pis */ }
  }
  return done;
};

module.exports = { findCemuExes, cemuOtherRoots, isBlank, retroarchSaves, SAVE_EXT, SaveVault, locate, zipInnerName, findExisting, importExisting, saveKeys, looseOf, cemuSaveDir, cemuMlcRoots, wiiuTitleId, cemuTitleNames };
