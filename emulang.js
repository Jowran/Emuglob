// Émulateurs en français : quand Emuglob est en français, la langue de l'interface et la langue de la console émulée
// passent en français (une seule fois par réglage : un choix fait ensuite à la main dans l'émulateur est respecté).
// La RÉGION n'est jamais touchée : la changer casse des sauvegardes et empêche des jeux NTSC de démarrer.
const fs = require('fs');
const path = require('path');
const { Ini, adapters: { RA, P2, DOL, AZ, PP, CE } } = require('./emucfg');

const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
// latin1 = octets gardés tels quels (fichiers UTF-8 ou ANSI), on ne touche qu'à de l'ASCII ; la marque UTF-8 (BOM) est mise de côté
const BOM = '\xEF\xBB\xBF';
const rdTxt = (f) => fs.readFileSync(f, 'latin1').replace(/^\xEF\xBB\xBF/, '');
const wrTxt = (f, t) => Buffer.from((fs.readFileSync(f, 'latin1').startsWith(BOM) ? BOM : '') + t, 'latin1');

// ---------- lecture / écriture d'un réglage selon le format du fichier ----------
const KINDS = {
  ini: {   // [section] clé = valeur
    get: (r) => { const v = new Ini(rdTxt(r.file)).get(r.sec, r.key); return v === undefined ? null : v.trim().replace(/^"(.*)"$/, '$1'); },
    put: (r) => { const ini = new Ini(rdTxt(r.file)); ini.set(r.sec, r.key, r.quote ? `"${r.want}"` : r.want, r.sep || ' = '); return wrTxt(r.file, ini.toString()); },
  },
  line: {   // clé = "valeur", sans section (retroarch.cfg, ancien melonDS.ini)
    re: (r) => new RegExp(`^(\\s*${r.key}\\s*=\\s*)"?([^"\\r\\n]*)"?[ \\t]*$`, 'm'),
    get(r) { const m = this.re(r).exec(rdTxt(r.file)); return m ? m[2].trim() : null; },
    put(r) {
      const t = rdTxt(r.file), v = r.quote ? `"${r.want}"` : r.want;
      if (this.re(r).test(t)) return wrTxt(r.file, t.replace(this.re(r), (_m, a) => a + v));
      const eol = /\r\n/.test(t) ? '\r\n' : '\n';
      return wrTxt(r.file, t.replace(/\s*$/, '') + eol + `${r.key} = ${v}` + eol);
    },
  },
  json: {   // options d'un core RALibretro (Cores\<core>.json → core.<option>)
    get: (r) => { const j = JSON.parse(fs.readFileSync(r.file, 'utf-8').replace(/^﻿/, '')); const v = (j.core || {})[r.key]; return v === undefined ? null : String(v); },
    put: (r) => { const j = JSON.parse(fs.readFileSync(r.file, 'utf-8').replace(/^﻿/, '')); j.core = j.core || {}; j.core[r.key] = r.want; return Buffer.from(JSON.stringify(j), 'utf-8'); },
  },
  xml: {   // Cemu settings.xml : <content><console_language>2</console_language>
    re: (r) => new RegExp(`<${r.key}>([^<]*)</${r.key}>`),
    get(r) { const m = this.re(r).exec(rdTxt(r.file)); return m ? m[1].trim() : null; },
    put(r) {
      const t = rdTxt(r.file);
      if (this.re(r).test(t)) return wrTxt(r.file, t.replace(this.re(r), `<${r.key}>${r.want}</${r.key}>`));
      const eol = /\r\n/.test(t) ? '\r\n' : '\n';
      if (!/<\/content>/.test(t)) throw new Error('settings.xml inattendu');
      return wrTxt(r.file, t.replace(/(\s*)<\/content>/, `${eol}    <${r.key}>${r.want}</${r.key}>$1</content>`));
    },
  },
  sysconf: {   // Wii : fichier SYSCONF (« SCv0 »), entrée octet IPL.LNG (en-tête 0x66 = type octet, nom de 7 lettres)
    at(buf) { const i = buf.indexOf(Buffer.from([0x66, ...Buffer.from('IPL.LNG')])); if (buf.toString('latin1', 0, 4) !== 'SCv0' || i < 0) throw new Error('SYSCONF illisible'); return i + 8; },
    get(r) { const b = fs.readFileSync(r.file); return String(b[this.at(b)]); },
    put(r) { const b = fs.readFileSync(r.file); b[this.at(b)] = +r.want; return b; },
  },
  ctrcfg: {   // 3DS : sauvegarde système « config » (blocs), bloc 0x000A0002 = langue (1 octet, rangé dans l'entrée)
    at(buf) {
      const n = buf.readUInt16LE(0);
      if (n < 1 || n > 1000 || 4 + n * 12 > buf.length) throw new Error('config 3DS illisible');
      for (let k = 0; k < n; k++) { const o = 4 + k * 12; if (buf.readUInt32LE(o) === 0x000A0002 && buf.readUInt16LE(o + 8) === 1) return o + 4; }
      throw new Error('langue 3DS introuvable');
    },
    get(r) { const b = fs.readFileSync(r.file); return String(b[this.at(b)]); },
    put(r) { const b = fs.readFileSync(r.file); b[this.at(b)] = +r.want; return b; },
  },
};

// ---------- réglages par émulateur ----------
// want : valeur française ; from : valeurs remplacées sans forcer (absent = null, anglais, « auto » / langue système)
function rulesFor(exe) {
  const b = path.basename(exe), d = path.dirname(exe), out = [];
  const add = (emu, label, kind, file, o) => out.push({ emu, label, kind, file, ...o });
  if (RA.match(exe)) {   // RALibretro : langue de la console DS dans les cores (les autres cores n'en ont pas)
    const c = (core) => path.join(d, 'Cores', core + '.json');
    add('RALibretro', 'Langue DS (melonDS DS)', 'json', c('melondsds_libretro'), { key: 'melonds_firmware_language', want: 'fr', from: [null, 'auto', 'en'] });
    add('RALibretro', 'Langue DS (DeSmuME)', 'json', c('desmume_libretro'), { key: 'desmume_firmware_language', want: 'French', from: [null, 'Auto', 'English'] });
  } else if (/^retroarch/i.test(b)) {   // RetroArch : menus + langue transmise aux cores
    add('RetroArch', 'Langue (menus et cores)', 'line', path.join(d, 'retroarch.cfg'), { key: 'user_language', want: '2', quote: true, from: [null, '0'] });
  } else if (P2.match(exe)) {   // PCSX2 : interface (la langue PS2 vient du BIOS, réglée dans le menu du BIOS)
    add('PCSX2', "Langue de l'interface", 'ini', P2.file(exe), { sec: 'UI', key: 'Language', want: 'fr-FR', from: [null, '', 'system', 'en-US'] });
  } else if (DOL.match(exe)) {
    const cfg = DOL.dir(exe), ini = path.join(cfg, 'Dolphin.ini');
    add('Dolphin', "Langue de l'interface", 'ini', ini, { sec: 'Interface', key: 'LanguageCode', want: 'fr', from: [null, '', 'en'] });
    add('Dolphin', 'Langue GameCube', 'ini', ini, { sec: 'Core', key: 'SelectedLanguage', want: '2', from: [null, '0'] });   // 0 anglais, 2 français (jeux PAL)
    add('Dolphin', 'Langue de la Wii', 'sysconf', path.join(path.dirname(cfg), 'Wii', 'shared2', 'sys', 'SYSCONF'), { want: '3', from: ['1'] });   // 1 anglais, 3 français
  } else if (CE.match(exe)) {   // Cemu : langue de la Wii U (région laissée sur Auto)
    add('Cemu', 'Langue de la Wii U', 'xml', path.join(path.dirname(CE.dir(exe)), 'settings.xml'), { key: 'console_language', want: '2', from: [null, '1'] });
  } else if (AZ.match(exe)) {   // Azahar : langue de la 3DS (région auto : si le jeu ne connaît pas le français, l'émulateur repasse sur une langue de sa région)
    const root = path.dirname(path.dirname(AZ.file(exe)));
    add('Azahar', 'Langue de la 3DS', 'ctrcfg', path.join(root, 'nand', 'data', '0'.repeat(32), 'sysdata', '00010017', '00000000', 'config'), { want: '2', from: ['1'] });
  } else if (PP.match(exe)) {   // PPSSPP : interface ; langue PSP = « auto » (suit l'interface) ou anglais → français
    const f = path.join(PP.dir(exe), 'ppsspp.ini');
    add('PPSSPP', "Langue de l'interface", 'ini', f, { sec: 'General', key: 'Language', want: 'fr_FR', from: [null, '', 'en_US'] });
    add('PPSSPP', 'Langue de la PSP', 'ini', f, { sec: 'SystemParam', key: 'GameLanguage', want: '2', from: ['1'], ok: ['-1'] });
  } else if (/desmume/i.test(b)) {   // DeSmuME : langue du firmware DS
    add('DeSmuME', 'Langue DS', 'ini', path.join(d, 'desmume.ini'), { sec: 'Firmware', key: 'Language', want: '2', sep: '=', from: [null, '1'] });
  } else if (/^melonds/i.test(b)) {
    if (exists(path.join(d, 'melonDS.toml'))) add('melonDS', 'Langue DS', 'ini', path.join(d, 'melonDS.toml'), { sec: 'Instance0.Firmware', key: 'Language', want: '2', from: [null, '1'] });
    else add('melonDS', 'Langue DS', 'line', path.join(d, 'melonDS.ini'), { key: 'FirmwareLanguage', want: '2', from: [null, '1'] });
  }
  return out;
}

// done : { "fichier|clé": date } — réglages déjà vus (changés ou laissés), pour ne jamais revenir sur un choix fait à la main
function localize(exe, { done = {}, force = false } = {}) {
  const res = [], backed = new Set();
  for (const r of rulesFor(exe)) {
    const id = (r.file + '|' + (r.key || r.kind)).toLowerCase();
    const row = { emu: r.emu, label: r.label, file: r.file };
    if (!exists(r.file)) { res.push({ ...row, status: 'absent' }); continue; }   // émulateur jamais lancé : réessayé la prochaine fois
    if (done[id] && !force) { res.push({ ...row, status: 'vu' }); continue; }
    try {
      const k = KINDS[r.kind], cur = k.get(r);
      if (cur === r.want || (r.ok || []).includes(cur)) row.status = 'ok';
      else if (force || r.from.includes(cur)) {
        const data = k.put(r);
        if (!backed.has(r.file)) { fs.copyFileSync(r.file, r.file + '.bak'); backed.add(r.file); }
        const tmp = r.file + '.emuglob-tmp';
        fs.writeFileSync(tmp, data); fs.renameSync(tmp, r.file);
        Object.assign(row, { status: 'fr', from: cur });
      } else Object.assign(row, { status: 'manuel', value: cur });   // autre langue choisie à la main : on n'y touche pas
      done[id] = new Date().toISOString();
    } catch (e) { Object.assign(row, { status: 'erreur', error: e.message }); }
    res.push(row);
  }
  return res;
}

module.exports = { localize, rulesFor };
