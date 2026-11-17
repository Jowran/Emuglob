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

const newest = (paths) => paths.map((p) => ({ p, s: statOf(p) })).filter((x) => x.s).sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)[0] || null;
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
    if (statOf(this.file(gameId))) pool.push({ p: this.file(gameId), from: 'Emuglob' });
    const best = pool.map((x) => ({ ...x, s: statOf(x.p) })).filter((x) => x.s).sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)[0];
    if (!best) return { action: 'none' };
    if (mine && (mine.s.mtimeMs >= best.s.mtimeMs - 2000 || same(mine.p, best.p))) return { action: 'kept' };
    const dst = mine ? mine.p : own.target;
    if (mine) this.keep(gameId, mine.p, `${emu.name}-remplacee`);
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
    if (statOf(v) && same(v, mine.p)) return { action: 'kept' };
    this.keep(gameId, v, 'coffre');
    this.copy(mine.p, v);
    fs.writeFileSync(path.join(this.dir(gameId), 'source.txt'), `${emu.name}\n${mine.p}\n${new Date().toISOString()}\n`);
    return { action: 'saved', from: mine.p };
  }
}

module.exports = { SaveVault, locate, zipInnerName };
