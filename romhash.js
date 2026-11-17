// Calcul des empreintes (MD5) utilisées par RetroAchievements pour reconnaître un jeu.
// Couvre les consoles à cartouche ; PlayStation et DS (formats complexes) retombent sur la recherche par titre.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const MAX = 160 * 1024 * 1024;

function readZip(file) {
  const b = fs.readFileSync(file);
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return null;
  let off = b.readUInt32LE(e + 16);
  const n = b.readUInt16LE(e + 10);
  for (let i = 0; i < n; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) return null;
    const method = b.readUInt16LE(off + 10), csize = b.readUInt32LE(off + 20);
    const nlen = b.readUInt16LE(off + 28), elen = b.readUInt16LE(off + 30), clen = b.readUInt16LE(off + 32);
    const lho = b.readUInt32LE(off + 42);
    const name = b.toString('utf8', off + 46, off + 46 + nlen);
    off += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const start = lho + 30 + b.readUInt16LE(lho + 26) + b.readUInt16LE(lho + 28);
    const data = b.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data);
    return null;
  }
  return null;
}

function n64Normalize(buf) {
  const h = buf.subarray(0, 4).toString('hex');
  const out = Buffer.from(buf.subarray(0, 64 * 1024 * 1024));
  if (h === '37804012') {
    for (let i = 0; i + 1 < out.length; i += 2) { const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t; }
  } else if (h === '40123780') {
    for (let i = 0; i + 3 < out.length; i += 4) {
      let t = out[i]; out[i] = out[i + 3]; out[i + 3] = t;
      t = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = t;
    }
  }
  return out;
}

// system = id de console RetroAchievements ; retourne '' si le système n'est pas géré
function romHash(file, system) {
  const ext = path.extname(file).toLowerCase();
  if (system === 27) return md5(Buffer.from(path.basename(file, ext))); // arcade : nom du fichier sans extension
  let buf;
  if (ext === '.zip') buf = readZip(file);
  else if (fs.statSync(file).size <= MAX) buf = fs.readFileSync(file);
  if (!buf) return '';
  switch (system) {
    case 1: case 4: case 6: case 11: case 14: case 15: case 25: break;
    case 5: buf = buf.subarray(0, 16 * 1024 * 1024); break;
    case 7: if (buf.length > 16 && buf.toString('latin1', 0, 4) === 'NES\x1a') buf = buf.subarray(16); break;
    case 3: if (buf.length % 1024 === 512) buf = buf.subarray(512); break;
    case 8: if (buf.length % 8192 === 512) buf = buf.subarray(512); break;
    case 13: if (buf.toString('latin1', 0, 4) === 'LYNX') buf = buf.subarray(64); break;
    case 2: buf = n64Normalize(buf); break;
    default: return '';
  }
  return md5(buf);
}

module.exports = { romHash, readZip };
