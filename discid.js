// Identification des images disque : GameCube / Wii (en-tête), PS1 / PS2 / PSP (ISO 9660 + SYSTEM.CNF), DS (en-tête).
// Retourne { platform: 'wii'|'gc'|'ps2'|'ps1'|'psp'|'nds'|'unknown', id: 'identifiant ou numéro de série' }
const fs = require('fs');
const path = require('path');

const readAt = (fd, pos, len) => {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return b.subarray(0, n);
};
const isWii = (b, o) => b.length >= o + 0x20 && b.readUInt32BE(o + 0x18) === 0x5d1c9ea3;
const isGc = (b, o) => b.length >= o + 0x20 && b.readUInt32BE(o + 0x1c) === 0xc2339f3d;
const gameId = (b, o) => b.toString('latin1', o, o + 6).replace(/[^A-Za-z0-9]/g, '');

// disposition des secteurs : [taille du secteur, début des données]
const LAYOUTS = [[2048, 0], [2352, 16], [2352, 24], [2336, 8]];

function readExtent(fd, lay, lba, size) {
  const out = [];
  for (let got = 0, s = lba; got < size && got < 65536; got += 2048, s++) out.push(readAt(fd, s * lay[0] + lay[1], 2048));
  return Buffer.concat(out).subarray(0, size);
}

function findEntry(dir, name) {
  let off = 0;
  while (off + 33 < dir.length) {
    const len = dir[off];
    if (!len) { off = (Math.floor(off / 2048) + 1) * 2048; continue; }
    const nl = dir[off + 32];
    const nm = dir.toString('latin1', off + 33, off + 33 + nl).toUpperCase().split(';')[0];
    if (nm === name) return { lba: dir.readUInt32LE(off + 2), size: dir.readUInt32LE(off + 10), isDir: !!(dir[off + 25] & 2) };
    off += len;
  }
  return null;
}

function identifyIso(fd) {
  const lay = LAYOUTS.find(([ss, dof]) => readAt(fd, 16 * ss + dof + 1, 5).toString('latin1') === 'CD001');
  if (!lay) return null;
  const pvd = readExtent(fd, lay, 16, 2048);
  const root = { lba: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10) };
  const dir = readExtent(fd, lay, root.lba, root.size);
  if (findEntry(dir, 'PSP_GAME')) return { platform: 'psp', id: '' };
  const cnf = findEntry(dir, 'SYSTEM.CNF');
  if (!cnf) return { platform: 'unknown', id: '' };
  const txt = readExtent(fd, lay, cnf.lba, Math.min(cnf.size, 2048)).toString('latin1');
  const m2 = /BOOT2\s*=\s*cdrom0:\\?(?:.*\\)?([A-Z]{4})[_-](\d{3})\.?(\d{2})/i.exec(txt);
  if (m2) return { platform: 'ps2', id: `${m2[1]}-${m2[2]}${m2[3]}`.toUpperCase() };
  const m1 = /BOOT\s*=\s*cdrom:\\?(?:.*\\)?([A-Z]{4})[_-](\d{3})\.?(\d{2})/i.exec(txt);
  if (m1) return { platform: 'ps1', id: `${m1[1]}-${m1[2]}${m1[3]}`.toUpperCase() };
  return { platform: 'unknown', id: '' };
}

function identify(file) {
  let ext = path.extname(file).toLowerCase();
  if (ext === '.cue') {   // le .cue pointe vers le .bin
    try {
      const m = /FILE\s+"([^"]+)"/i.exec(fs.readFileSync(file, 'latin1'));
      if (m) { file = path.resolve(path.dirname(file), m[1]); ext = path.extname(file).toLowerCase(); }
    } catch { return { platform: 'unknown', id: '' }; }
  }
  const fd = fs.openSync(file, 'r');
  try {
    const head = readAt(fd, 0, 0x40);
    if (ext === '.nds') return { platform: 'nds', id: head.toString('latin1', 0x0c, 0x10).replace(/[^A-Za-z0-9]/g, '') };
    if (isWii(head, 0)) return { platform: 'wii', id: gameId(head, 0) };
    if (isGc(head, 0)) return { platform: 'gc', id: gameId(head, 0) };
    if (head.toString('latin1', 0, 4) === 'WBFS') {   // WBFS : copie de l'en-tête du disque au 2e secteur
      const h = readAt(fd, 1 << head[8], 0x40);
      return { platform: 'wii', id: gameId(h, 0) };
    }
    const tag = head.toString('latin1', 0, 3);
    if (tag === 'RVZ' || tag === 'WIA') {   // RVZ / WIA : en-tête du disque copié à 0x58
      const h = readAt(fd, 0x58, 0x40);
      return { platform: isGc(h, 0) && !isWii(h, 0) ? 'gc' : 'wii', id: gameId(h, 0) };
    }
    if (ext === '.gcm' || ext === '.gcz') return { platform: 'gc', id: '' };
    return identifyIso(fd) || { platform: 'unknown', id: '' };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { identify };
