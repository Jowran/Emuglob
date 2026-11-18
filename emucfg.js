// Contrôles et raccourcis des émulateurs, modifiés directement dans leurs fichiers de configuration.
// Couverts : RALibretro, PCSX2, Dolphin, Azahar. Une copie .bak est faite avant chaque écriture.
//
// Une « touche » arrive du renderer sous une forme neutre :
//   { t:'key', code:'KeyA', ch:'a', ctrl, alt, shift }   (code = touche physique, ch = caractère de la disposition)
//   { t:'btn', i }   bouton de manette (numérotation standard du navigateur : 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3, 12-15 croix, 16 Guide)
//   { t:'axis', a, dir }   stick (a : 0 LX, 1 LY, 2 RX, 3 RY ; dir : -1 / 1, LY -1 = haut)
//   { t:'none' }
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PAD_FR = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'Croix ↑', 'Croix ↓', 'Croix ←', 'Croix →', 'Guide'];
const AXIS_FR = (a, dir) => `${a < 2 ? 'Stick G' : 'Stick D'} ${a % 2 ? (dir < 0 ? '↑' : '↓') : (dir < 0 ? '←' : '→')}`;
const MOD_FR = (b) => (b.ctrl ? 'Ctrl+' : '') + (b.alt ? 'Alt+' : '') + (b.shift ? 'Maj+' : '');
const FUNC = { Enter: 'Entrée', Escape: 'Échap', Space: 'Espace', Tab: 'Tab', Backspace: 'Retour arr.', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Insert: 'Inser', Delete: 'Suppr', Home: 'Début', End: 'Fin', PageUp: 'Page ↑', PageDown: 'Page ↓', PrintScreen: 'Impr. écran', ScrollLock: 'Arrêt défil', Pause: 'Pause', CapsLock: 'Verr. maj',
  ShiftLeft: 'Maj', ShiftRight: 'Maj D', ControlLeft: 'Ctrl', ControlRight: 'Ctrl D', AltLeft: 'Alt', AltRight: 'Alt Gr' };
const keyText = (b) => MOD_FR(b) + (FUNC[b.code] || (/^F\d+$/.test(b.code) ? b.code : /^Numpad/.test(b.code) ? 'Pavé ' + b.code.slice(6) : (b.ch || b.code).toUpperCase()));
// texte affiché pour une touche neutre
function bindText(b) {
  if (!b || b.t === 'none') return '—';
  if (b.t === 'btn') return 'Manette ' + (PAD_FR[b.i] || b.i);
  if (b.t === 'axis') return 'Manette ' + AXIS_FR(b.a, b.dir);
  return keyText(b);
}
const isMod = (code) => /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code);

// ---------- petit éditeur INI qui garde le fichier tel quel (ordre, commentaires) ----------
class Ini {
  constructor(text) { this.lines = String(text || '').split(/\r?\n/); this.eol = /\r\n/.test(text || '') ? '\r\n' : (os.EOL || '\n'); }
  _sec(name) {
    const head = '[' + name + ']';
    const s = this.lines.findIndex((l) => l.trim() === head);
    if (s < 0) return null;
    let e = s + 1;
    while (e < this.lines.length && !/^\s*\[.*\]\s*$/.test(this.lines[e])) e++;
    return [s, e];
  }
  keys(sec) {
    const r = this._sec(sec), out = [];
    if (!r) return out;
    for (let i = r[0] + 1; i < r[1]; i++) { const m = /^([^=;#]+?)\s*=\s?(.*)$/.exec(this.lines[i]); if (m) out.push([m[1].trim(), m[2]]); }
    return out;
  }
  get(sec, key) { const k = this.keys(sec).find(([n]) => n === key); return k ? k[1] : undefined; }
  set(sec, key, val, sep = ' = ') {
    let r = this._sec(sec);
    if (!r) {
      while (this.lines.length && this.lines[this.lines.length - 1] === '') this.lines.pop();
      this.lines.push('[' + sec + ']');
      r = [this.lines.length - 1, this.lines.length];
    }
    for (let i = r[0] + 1; i < r[1]; i++) {
      const m = /^([^=;#]+?)\s*=/.exec(this.lines[i]);
      if (m && m[1].trim() === key) { this.lines[i] = key + sep + val; return; }
    }
    let at = r[1];
    while (at > r[0] + 1 && this.lines[at - 1].trim() === '') at--;   // avant la ligne vide qui sépare les sections
    this.lines.splice(at, 0, key + sep + val);
  }
  toString() { return this.lines.join(this.eol); }
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf-8').replace(/^\uFEFF/, ''); } catch { return null; } };
function writeWithBackup(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  const tmp = file + '.emuglob-tmp';
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, file);
}
const docs = () => { try { return require('electron').app.getPath('documents'); } catch { return path.join(os.homedir(), 'Documents'); } };
const appData = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

// ======================= RALibretro (RALibretro.json, noms SDL) =======================
const SDL_BTN = ['a', 'b', 'x', 'y', 'leftshoulder', 'rightshoulder', 'lefttrigger', 'righttrigger', 'back', 'start', 'leftstick', 'rightstick', 'dpup', 'dpdown', 'dpleft', 'dpright', 'guide'];
const SDL_AXIS = ['leftx', 'lefty', 'rightx', 'righty'];
const SDL_KEY = { Enter: 'Return', Escape: 'Escape', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', PrintScreen: 'PrintScreen', ScrollLock: 'ScrollLock', Pause: 'Pause', CapsLock: 'CapsLock',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt',
  NumpadAdd: 'Keypad +', NumpadSubtract: 'Keypad -', NumpadMultiply: 'Keypad *', NumpadDivide: 'Keypad /', NumpadEnter: 'Keypad Enter', NumpadDecimal: 'Keypad .' };
const RA = {
  id: 'ralibretro', name: 'RALibretro',
  match: (exe) => /ralibretro/i.test(path.basename(exe)),
  file: (exe) => path.join(path.dirname(exe), 'RALibretro.json'),
  groups: [
    ...[0, 1].map((p) => ({ id: 'J' + p, title: `Manette ${p + 1}`, items: [['UP', 'Croix haut'], ['DOWN', 'Croix bas'], ['LEFT', 'Croix gauche'], ['RIGHT', 'Croix droite'], ['A', 'A'], ['B', 'B'], ['X', 'X'], ['Y', 'Y'],
      ['L', 'L'], ['R', 'R'], ['L2', 'L2'], ['R2', 'R2'], ['L3', 'L3'], ['R3', 'R3'], ['SELECT', 'Select'], ['START', 'Start'],
      ['LSTICK_UP', 'Stick gauche haut'], ['LSTICK_DOWN', 'Stick gauche bas'], ['LSTICK_LEFT', 'Stick gauche gauche'], ['LSTICK_RIGHT', 'Stick gauche droite'],
      ['RSTICK_UP', 'Stick droit haut'], ['RSTICK_DOWN', 'Stick droit bas'], ['RSTICK_LEFT', 'Stick droit gauche'], ['RSTICK_RIGHT', 'Stick droit droite']].map(([k, l]) => [`J${p}_${k}`, l]) })),
    { id: 'hk', title: 'Raccourcis', items: [['PAUSE', 'Pause'], ['SHOW_OVERLAY', 'Menu RetroAchievements'], ['FAST_FORWARD', 'Avance rapide (maintenir)'], ['FAST_FORWARD_TOGGLE', 'Avance rapide (activer/couper)'],
      ['FRAME_ADVANCE', 'Image par image'], ['TOGGLE_FULLSCREEN', 'Plein écran'], ['SCREENSHOT', "Capture d'écran"], ['RESET', 'Réinitialiser le jeu'], ['GAME_FOCUS_TOGGLE', 'Mode focus jeu'],
      ['SAVE_SLOT', 'Sauvegarde rapide (emplacement actif)'], ['LOAD_SLOT', 'Chargement rapide (emplacement actif)'], ['NEXT_SLOT', 'Emplacement suivant'], ['PREV_SLOT', 'Emplacement précédent'],
      ...[1, 2, 3, 4].flatMap((n) => [[`SAVE${n}`, `Sauvegarder emplacement ${n}`], [`LOAD${n}`, `Charger emplacement ${n}`]]),
      ['DISK_NEXT', 'Disque suivant'], ['TRAY_OPEN', 'Ouvrir le plateau du disque']] },
  ],
  encode(b, gid) {
    if (b.t === 'none') return 'none';
    const j = gid === 'J1' ? 'J1' : 'J0';
    if (b.t === 'btn') return `${j} ${SDL_BTN[b.i]}`;
    if (b.t === 'axis') return `${j} ${b.dir < 0 ? '-' : '+'}${SDL_AXIS[b.a]}`;
    const name = SDL_KEY[b.code] || (/^F\d+$/.test(b.code) ? b.code : /^Numpad\d$/.test(b.code) ? 'Keypad ' + b.code.slice(6) : (b.ch || '').toUpperCase());
    if (!name) throw new Error('touche non reconnue');
    return (b.ctrl ? 'Ctrl+' : '') + (b.alt ? 'Alt+' : '') + (b.shift ? 'Shift+' : '') + name;
  },
  text(raw) {
    if (!raw || raw === 'none') return '—';
    let m = /^J(\d) ([+-]?)(\w+)$/.exec(raw);
    if (m) {
      const i = SDL_BTN.indexOf(m[3]); if (i >= 0 && !m[2]) return `Manette ${+m[1] + 1} ${PAD_FR[i]}`;
      const a = SDL_AXIS.indexOf(m[3]); if (a >= 0) return `Manette ${+m[1] + 1} ${AXIS_FR(a, m[2] === '-' ? -1 : 1)}`;
    }
    return raw.replace('Shift+', 'Maj+').replace('Return', 'Entrée').replace('Escape', 'Échap').replace('Space', 'Espace');
  },
  decode(raw) {
    const m = /^J\d ([+-]?)(\w+)$/.exec(raw || '');
    if (!m) return null;
    const i = SDL_BTN.indexOf(m[2]); if (i >= 0 && !m[1]) return { t: 'btn', i };
    const a = SDL_AXIS.indexOf(m[2]); if (a >= 0 && m[1]) return { t: 'axis', a, dir: m[1] === '-' ? -1 : 1 };
    return null;
  },
  load(exe) {
    const f = this.file(exe), txt = readText(f);
    if (txt === null) throw new Error(`fichier introuvable : ${f}. Lance RALibretro une fois pour le créer.`);
    const json = JSON.parse(txt);
    const vals = json.bindings || {};
    return { files: [f], get: (gid, key) => vals[key] };
  },
  save(exe, changes) {
    const f = this.file(exe), json = JSON.parse(readText(f));
    json.bindings = json.bindings || {};
    for (const c of changes) json.bindings[c.key] = c.raw;
    writeWithBackup(f, JSON.stringify(json));
    return [f];
  },
};

// ======================= PCSX2 (inis/PCSX2.ini) =======================
const P2_BTN = ['FaceSouth', 'FaceEast', 'FaceWest', 'FaceNorth', 'LeftShoulder', 'RightShoulder', '+LeftTrigger', '+RightTrigger', 'Back', 'Start', 'LeftStick', 'RightStick', 'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight', 'Guide'];
const P2_AXIS = ['LeftX', 'LeftY', 'RightX', 'RightY'];
const QT_NAME = { Enter: 'Return', Escape: 'Escape', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', PrintScreen: 'Print', ScrollLock: 'ScrollLock', Pause: 'Pause', CapsLock: 'CapsLock',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', ControlRight: 'Control', AltLeft: 'Alt', AltRight: 'Alt', NumpadEnter: 'Enter' };
const QT_CHAR = { '!': 'Exclam', '"': 'QuoteDbl', '#': 'NumberSign', $: 'Dollar', '%': 'Percent', '&': 'Ampersand', "'": 'Apostrophe', '(': 'ParenLeft', ')': 'ParenRight', '*': 'Asterisk', '+': 'Plus',
  ',': 'Comma', '-': 'Minus', '.': 'Period', '/': 'Slash', ':': 'Colon', ';': 'Semicolon', '<': 'Less', '=': 'Equal', '>': 'Greater', '?': 'Question', '@': 'At', '[': 'BracketLeft', '\\': 'Backslash',
  ']': 'BracketRight', '^': 'AsciiCircum', _: 'Underscore', '`': 'QuoteLeft', '{': 'BraceLeft', '|': 'Bar', '}': 'BraceRight', '~': 'AsciiTilde', '²': 'twosuperior', '£': 'sterling', '§': 'section',
  '°': 'degree', '¨': 'diaeresis', µ: 'micro', 'à': 'Agrave', 'â': 'Acircumflex', 'ç': 'Ccedilla', 'è': 'Egrave', 'é': 'Eacute', 'ê': 'Ecircumflex', 'ù': 'Ugrave' };
function qtKeyName(b) {
  if (QT_NAME[b.code]) return QT_NAME[b.code];
  if (/^F\d+$/.test(b.code)) return b.code;
  const ch = b.ch || '';
  if (/^[a-z0-9]$/i.test(ch)) return ch.toUpperCase();
  if (QT_CHAR[ch]) return QT_CHAR[ch];
  throw new Error('touche non reconnue');
}
const P2_PAD = [['Up', 'Croix haut'], ['Down', 'Croix bas'], ['Left', 'Croix gauche'], ['Right', 'Croix droite'], ['Cross', 'Croix ✕'], ['Circle', 'Rond ○'], ['Square', 'Carré □'], ['Triangle', 'Triangle △'],
  ['L1', 'L1'], ['R1', 'R1'], ['L2', 'L2'], ['R2', 'R2'], ['L3', 'L3'], ['R3', 'R3'], ['Select', 'Select'], ['Start', 'Start'], ['Analog', 'Bouton Analog'],
  ['LUp', 'Stick gauche haut'], ['LDown', 'Stick gauche bas'], ['LLeft', 'Stick gauche gauche'], ['LRight', 'Stick gauche droite'],
  ['RUp', 'Stick droit haut'], ['RDown', 'Stick droit bas'], ['RLeft', 'Stick droit gauche'], ['RRight', 'Stick droit droite']];
const P2_DZ = { num: true, min: 0, max: 100, unit: '%', sticks: [0, 2], in: (r) => Math.round((parseFloat(r) || 0) * 100), out: (v) => (v / 100).toFixed(2) };
const P2_HK = [['OpenPauseMenu', 'Menu pause'], ['TogglePause', 'Pause'], ['ToggleFullscreen', 'Plein écran'], ['ToggleTurbo', 'Turbo (activer/couper)'], ['HoldTurbo', 'Turbo (maintenir)'],
  ['ToggleSlowMotion', 'Ralenti'], ['ToggleFrameLimit', 'Limite de vitesse'], ['SaveStateToSlot', 'Sauvegarde rapide'], ['LoadStateFromSlot', 'Chargement rapide'],
  ['NextSaveStateSlot', 'Emplacement suivant'], ['PreviousSaveStateSlot', 'Emplacement précédent'], ['Screenshot', "Capture d'écran"], ['ResetVM', 'Réinitialiser'], ['ShutdownVM', 'Arrêter le jeu'],
  ['ZoomIn', 'Zoom +'], ['ZoomOut', 'Zoom −'], ['CycleAspectRatio', "Format d'image"], ['ToggleSoftwareRendering', 'Rendu logiciel']];
const P2 = {
  id: 'pcsx2', name: 'PCSX2',
  match: (exe) => /pcsx2/i.test(path.basename(exe)),
  file(exe) {
    const d = path.dirname(exe);
    if (fs.existsSync(path.join(d, 'portable.ini')) || fs.existsSync(path.join(d, 'portable.txt'))) return path.join(d, 'inis', 'PCSX2.ini');
    return path.join(docs(), 'PCSX2', 'inis', 'PCSX2.ini');
  },
  groups: [{ id: 'Pad1', title: 'Manette 1', items: [...P2_PAD, ['Deadzone', 'Zone morte des sticks', P2_DZ]] }, { id: 'Pad2', title: 'Manette 2', items: [...P2_PAD, ['Deadzone', 'Zone morte des sticks', P2_DZ]] }, { id: 'Hotkeys', title: 'Raccourcis', items: P2_HK }],
  dev: 'SDL-0',
  encode(b, gid) {
    if (b.t === 'none') return '';
    const dev = gid === 'Pad2' ? this.dev.replace(/\d+$/, (n) => +n + 1) : this.dev;
    if (b.t === 'btn') return `${dev}/${P2_BTN[b.i]}`;
    if (b.t === 'axis') return `${dev}/${b.dir < 0 ? '-' : '+'}${P2_AXIS[b.a]}`;
    const parts = [];
    if (b.ctrl) parts.push('Control'); if (b.alt) parts.push('Alt'); if (b.shift) parts.push('Shift');
    parts.push(qtKeyName(b));
    return parts.map((p) => 'Keyboard/' + p).join(' & ');
  },
  text(raw) {
    if (!raw) return '—';
    return raw.split(' & ').map((p) => {
      const m = /^(SDL|XInput|DInput)-(\d+)\/(.+)$/.exec(p);
      if (m) {
        const i = P2_BTN.indexOf(m[3]); if (i >= 0) return `Manette ${+m[2] + 1} ${PAD_FR[i]}`;
        const a = /^([+-])(\w+)$/.exec(m[3]); if (a && P2_AXIS.includes(a[2])) return `Manette ${+m[2] + 1} ${AXIS_FR(P2_AXIS.indexOf(a[2]), a[1] === '-' ? -1 : 1)}`;
        return `Manette ${+m[2] + 1} ${m[3]}`;
      }
      return p.replace(/^Keyboard\//, '').replace(/^Control$/, 'Ctrl').replace(/^Shift$/, 'Maj').replace(/^Return$/, 'Entrée').replace(/^Escape$/, 'Échap').replace(/^Space$/, 'Espace');
    }).join(' + ');
  },
  decode(raw) {
    const m = /^(?:SDL|XInput|DInput)-\d+\/(.+)$/.exec(raw || '');
    if (!m) return null;
    const i = P2_BTN.indexOf(m[1]); if (i >= 0) return { t: 'btn', i };
    const a = /^([+-])(\w+)$/.exec(m[1]); if (a && P2_AXIS.includes(a[2])) return { t: 'axis', a: P2_AXIS.indexOf(a[2]), dir: a[1] === '-' ? -1 : 1 };
    return null;
  },
  load(exe) {
    const f = this.file(exe), txt = readText(f);
    if (txt === null) throw new Error(`fichier introuvable : ${f}. Lance PCSX2 une fois pour le créer.`);
    const ini = new Ini(txt);
    const m = /((?:SDL|XInput)-\d+)\//.exec(ini.keys('Pad1').map(([, v]) => v).join(' '));
    this.dev = m ? m[1] : 'SDL-0';
    return { files: [f], get: (gid, key) => ini.get(gid, key) };
  },
  save(exe, changes) {
    const f = this.file(exe), ini = new Ini(readText(f));
    for (const c of changes) {
      if (c.group === 'Pad2' && !ini.get('Pad2', 'Type')) ini.set('Pad2', 'Type', 'DualShock2');
      if (c.group === 'Pad2' && ini.get('Pad2', 'Type') === 'None') ini.set('Pad2', 'Type', 'DualShock2');
      ini.set(c.group, c.key, c.raw);
    }
    writeWithBackup(f, ini.toString());
    return [f];
  },
};

// ======================= Dolphin (Config/GCPadNew.ini, WiimoteNew.ini, Hotkeys.ini) =======================
const DOL_PAD = {
  XInput: ['Button A', 'Button B', 'Button X', 'Button Y', 'Shoulder L', 'Shoulder R', 'Trigger L', 'Trigger R', 'Back', 'Start', 'Thumb L', 'Thumb R', 'Pad N', 'Pad S', 'Pad W', 'Pad E', 'Guide'],
  SDL: ['Button S', 'Button E', 'Button W', 'Button N', 'Shoulder L', 'Shoulder R', 'Trigger L', 'Trigger R', 'Back', 'Start', 'Thumb L', 'Thumb R', 'Pad N', 'Pad S', 'Pad W', 'Pad E', 'Guide'],
  WGInput: ['Button A', 'Button B', 'Button X', 'Button Y', 'Bumper L', 'Bumper R', 'Trigger L', 'Trigger R', 'View', 'Menu', 'Thumb L', 'Thumb R', 'Pad N', 'Pad S', 'Pad W', 'Pad E', null],
};
const DOL_AXIS = (a, dir) => `${a < 2 ? 'Left' : 'Right'} ${a % 2 ? 'Y' : 'X'}${a % 2 ? (dir < 0 ? '+' : '-') : (dir < 0 ? '-' : '+')}`;   // Dolphin : Y+ = haut
const DIK = { Enter: 'RETURN', Escape: 'ESCAPE', Space: 'SPACE', Tab: 'TAB', Backspace: 'BACK', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Insert: 'INSERT', Delete: 'DELETE', Home: 'HOME', End: 'END', PageUp: 'PRIOR', PageDown: 'NEXT', PrintScreen: 'SYSRQ', ScrollLock: 'SCROLL', Pause: 'PAUSE', CapsLock: 'CAPITAL',
  ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', ControlLeft: 'LCONTROL', ControlRight: 'RCONTROL', AltLeft: 'LMENU', AltRight: 'RMENU',
  Minus: 'MINUS', Equal: 'EQUALS', BracketLeft: 'LBRACKET', BracketRight: 'RBRACKET', Semicolon: 'SEMICOLON', Quote: 'APOSTROPHE', Backquote: 'GRAVE', Backslash: 'BACKSLASH',
  Comma: 'COMMA', Period: 'PERIOD', Slash: 'SLASH', IntlBackslash: 'OEM_102', NumpadAdd: 'ADD', NumpadSubtract: 'SUBTRACT', NumpadMultiply: 'MULTIPLY', NumpadDivide: 'DIVIDE', NumpadEnter: 'NUMPADENTER', NumpadDecimal: 'DECIMAL' };
function dikName(code) {   // Dolphin lit les touches physiques (DirectInput)
  if (DIK[code]) return DIK[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code); if (m) return 'NUMPAD' + m[1];
  if (/^F\d+$/.test(code)) return code;
  throw new Error('touche non reconnue');
}
const quote = (s) => (/^[A-Za-z0-9_]+$/.test(s) ? s : '`' + s + '`');
const DOL_KB = 'DInput/0/Keyboard Mouse';
const DOL_HK_DEFAULTS = {
  'General/Open': '@(Ctrl+O)', 'General/Toggle Pause': 'F10', 'General/Stop': 'ESCAPE', 'General/Toggle Fullscreen': '@(Alt+RETURN)', 'General/Take Screenshot': 'F9', 'General/Open Achievements': '@(Alt+A)',
  'Stepping/Step Into': 'F11', 'Stepping/Step Over': '@(Shift+F10)', 'Stepping/Step Out': '@(Shift+F11)', 'Breakpoint/Toggle Breakpoint': '@(Shift+F9)',
  'Wii/Connect Wii Remote 1': '@(Alt+F5)', 'Wii/Connect Wii Remote 2': '@(Alt+F6)', 'Wii/Connect Wii Remote 3': '@(Alt+F7)', 'Wii/Connect Wii Remote 4': '@(Alt+F8)', 'Wii/Connect Balance Board': '@(Alt+F9)',
  'Emulation Speed/Disable Emulation Speed Limit': 'TAB',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [[`Load State/Load State Slot ${i}`, `F${i}`], [`Save State/Save State Slot ${i}`, `@(Shift+F${i})`]])),
  'Other State Hotkeys/Undo Load State': 'F12', 'Other State Hotkeys/Undo Save State': '@(Shift+F12)',
  'GBA Core/Load ROM': '@(`Ctrl`+`Shift`+`O`)', 'GBA Core/Unload ROM': '@(`Ctrl`+`Shift`+`W`)', 'GBA Core/Reset': '@(`Ctrl`+`Shift`+`R`)',
  'GBA Volume/Volume Down': '`SUBTRACT`', 'GBA Volume/Volume Up': '`ADD`', 'GBA Volume/Volume Toggle Mute': '`M`',
  'GBA Window Size/1x': '`NUMPAD1`', 'GBA Window Size/2x': '`NUMPAD2`', 'GBA Window Size/3x': '`NUMPAD3`', 'GBA Window Size/4x': '`NUMPAD4`',
  'USB Emulation Devices/Show Skylanders Portal': '@(Ctrl+P)', 'USB Emulation Devices/Show Infinity Base': '@(Ctrl+I)',
};
const DOL_NUM = (stickKey) => ({ num: true, min: 0, max: 50, unit: '%', stickKey, in: (r) => Math.round(parseFloat(r) || 0), out: (v) => String(v) });
const DOL_GC = [['Buttons/A', 'A'], ['Buttons/B', 'B'], ['Buttons/X', 'X'], ['Buttons/Y', 'Y'], ['Buttons/Z', 'Z'], ['Buttons/Start', 'Start'],
  ['Triggers/L', 'L'], ['Triggers/R', 'R'], ['Triggers/L-Analog', 'L (analogique)'], ['Triggers/R-Analog', 'R (analogique)'],
  ['D-Pad/Up', 'Croix haut'], ['D-Pad/Down', 'Croix bas'], ['D-Pad/Left', 'Croix gauche'], ['D-Pad/Right', 'Croix droite'],
  ['Main Stick/Up', 'Stick haut'], ['Main Stick/Down', 'Stick bas'], ['Main Stick/Left', 'Stick gauche'], ['Main Stick/Right', 'Stick droite'],
  ['C-Stick/Up', 'Stick C haut'], ['C-Stick/Down', 'Stick C bas'], ['C-Stick/Left', 'Stick C gauche'], ['C-Stick/Right', 'Stick C droite'],
  ['Main Stick/Dead Zone', 'Zone morte du stick', DOL_NUM('Main Stick/Up')], ['C-Stick/Dead Zone', 'Zone morte du stick C', DOL_NUM('C-Stick/Up')]];
const DOL_WII = [['Buttons/A', 'A'], ['Buttons/B', 'B'], ['Buttons/1', '1'], ['Buttons/2', '2'], ['Buttons/-', '−'], ['Buttons/+', '+'], ['Buttons/Home', 'Home'],
  ['D-Pad/Up', 'Croix haut'], ['D-Pad/Down', 'Croix bas'], ['D-Pad/Left', 'Croix gauche'], ['D-Pad/Right', 'Croix droite'],
  ['Shake/X', 'Secouer'], ['Nunchuk/Buttons/C', 'Nunchuk C'], ['Nunchuk/Buttons/Z', 'Nunchuk Z'],
  ['Nunchuk/Stick/Up', 'Nunchuk stick haut'], ['Nunchuk/Stick/Down', 'Nunchuk stick bas'], ['Nunchuk/Stick/Left', 'Nunchuk stick gauche'], ['Nunchuk/Stick/Right', 'Nunchuk stick droite'],
  ['Nunchuk/Stick/Dead Zone', 'Zone morte du stick Nunchuk', DOL_NUM('Nunchuk/Stick/Up')]];
const DOL_HK = [['General/Toggle Pause', 'Pause'], ['General/Stop', 'Arrêter'], ['General/Reset', 'Réinitialiser'], ['General/Toggle Fullscreen', 'Plein écran'], ['General/Take Screenshot', "Capture d'écran"],
  ['Emulation Speed/Disable Emulation Speed Limit', 'Vitesse illimitée'], ['Emulation Speed/Decrease Emulation Speed', 'Ralentir'], ['Emulation Speed/Increase Emulation Speed', 'Accélérer'],
  ['Frame Advance/Frame Advance', 'Image par image'], ['Load State/Load from Selected Slot', 'Chargement rapide (emplacement actif)'], ['Save State/Save to Selected Slot', 'Sauvegarde rapide (emplacement actif)'],
  ['Other State Hotkeys/Increase Selected State Slot', 'Emplacement suivant'], ['Other State Hotkeys/Decrease Selected State Slot', 'Emplacement précédent'],
  ...[1, 2, 3, 4].flatMap((i) => [[`Save State/Save State Slot ${i}`, `Sauvegarder emplacement ${i}`], [`Load State/Load State Slot ${i}`, `Charger emplacement ${i}`]]),
  ['Wii/Connect Wii Remote 1', 'Connecter la Wiimote 1'], ['General/Open Achievements', 'Succès RetroAchievements']];
const DOL = {
  id: 'dolphin', name: 'Dolphin',
  match: (exe) => /dolphin/i.test(path.basename(exe)),
  dir(exe) {
    const d = path.dirname(exe);
    if (fs.existsSync(path.join(d, 'portable.txt'))) return path.join(d, 'User', 'Config');
    const doc = path.join(docs(), 'Dolphin Emulator');
    if (fs.existsSync(doc)) return path.join(doc, 'Config');
    return path.join(appData(), 'Dolphin Emulator', 'Config');
  },
  where: { GCPad1: 'GCPadNew.ini', GCPad2: 'GCPadNew.ini', Wiimote1: 'WiimoteNew.ini', Hotkeys: 'Hotkeys.ini' },
  groups: [{ id: 'GCPad1', title: 'GameCube 1', items: DOL_GC }, { id: 'GCPad2', title: 'GameCube 2', items: DOL_GC }, { id: 'Wiimote1', title: 'Wiimote 1', items: DOL_WII }, { id: 'Hotkeys', title: 'Raccourcis', items: DOL_HK }],
  devs: {},
  padDev(gid) {
    const d = this.devs[gid] || '';
    if (/^(XInput|SDL|WGInput)\//.test(d)) return d;
    const other = Object.values(this.devs).find((x) => /^(XInput|SDL|WGInput)\//.test(x));
    return other || 'XInput/0/Gamepad';
  },
  encode(b, gid) {
    if (b.t === 'none') return '';
    const dev = this.devs[gid] || '';
    if (b.t === 'key') {
      const k = dikName(b.code);
      const mods = [b.ctrl && 'Ctrl', b.alt && 'Alt', b.shift && 'Shift'].filter(Boolean);
      const expr = mods.length ? `@(${[...mods, k].join('+')})` : quote(k);
      if (dev.startsWith('DInput/0/Keyboard')) return expr;
      if (mods.length) throw new Error('combinaison de touches possible seulement si ce groupe utilise le clavier');
      return '`' + DOL_KB + ':' + k + '`';
    }
    const pd = this.padDev(gid), fam = pd.split('/')[0];
    const name = b.t === 'btn' ? DOL_PAD[fam][b.i] : DOL_AXIS(b.a, b.dir);
    if (!name) throw new Error("ce bouton n'existe pas pour cette manette dans Dolphin");
    return pd === dev ? quote(name) : '`' + pd + ':' + name + '`';
  },
  text(raw) {
    if (!raw) return '—';
    let s = raw.replace(/`/g, '');
    const m = /^@\((.+)\)$/.exec(s); if (m) s = m[1];
    s = s.replace(/^DInput\/0\/Keyboard Mouse:/, '').replace(/^(XInput|SDL|WGInput)\/(\d+)\/[^:]+:/, (_x, _f, n) => `Manette ${+n + 1} `);
    for (const fam of Object.values(DOL_PAD)) { const i = fam.indexOf(s); if (i >= 0) return 'Manette ' + PAD_FR[i]; }
    const ax = /^(Left|Right) ([XY])([+-])$/.exec(s.replace(/^Manette \d+ /, ''));
    if (ax) return 'Manette ' + AXIS_FR((ax[1] === 'Left' ? 0 : 2) + (ax[2] === 'Y' ? 1 : 0), ax[2] === 'Y' ? (ax[3] === '+' ? -1 : 1) : (ax[3] === '-' ? -1 : 1));
    return s.replace('Shift', 'Maj').replace('RETURN', 'Entrée').replace('ESCAPE', 'Échap').replace('SPACE', 'Espace');
  },
  decode(raw) {
    let s = String(raw || '').replace(/`/g, '');
    if (/^DInput\/0\/Keyboard/.test(s) || /^@\(/.test(s)) return null;
    s = s.replace(/^(XInput|SDL|WGInput)\/\d+\/[^:]+:/, '');
    for (const fam of Object.values(DOL_PAD)) { const i = fam.indexOf(s); if (i >= 0) return { t: 'btn', i }; }
    const ax = /^(Left|Right) ([XY])([+-])$/.exec(s);
    if (ax) return { t: 'axis', a: (ax[1] === 'Left' ? 0 : 2) + (ax[2] === 'Y' ? 1 : 0), dir: ax[2] === 'Y' ? (ax[3] === '+' ? -1 : 1) : (ax[3] === '-' ? -1 : 1) };
    return null;
  },
  load(exe) {
    const dir = this.dir(exe), inis = {};
    for (const [gid, f] of Object.entries(this.where)) {
      const t = readText(path.join(dir, f));
      inis[f] = new Ini(t === null ? '' : t);
      if (t === null && f !== 'Hotkeys.ini') throw new Error(`fichier introuvable : ${path.join(dir, f)}. Ouvre une fois les réglages manette de Dolphin pour le créer.`);
    }
    const hk = inis['Hotkeys.ini'];
    if (!hk.keys('Hotkeys').length) {   // jamais modifiés : Dolphin utilise ses valeurs par défaut, on les recopie pour ne rien perdre en écrivant
      hk.set('Hotkeys', 'Device', DOL_KB);
      for (const [k, v] of Object.entries(DOL_HK_DEFAULTS)) hk.set('Hotkeys', k, v);
    }
    this.inis = inis;
    for (const gid of Object.keys(this.where)) this.devs[gid] = inis[this.where[gid]].get(gid, 'Device') || '';
    return { files: [...new Set(Object.values(this.where))].map((f) => path.join(dir, f)), get: (gid, key) => inis[this.where[gid]].get(gid, key) };
  },
  save(exe, changes) {
    this.load(exe);
    const dir = this.dir(exe), touched = new Set();
    for (const c of changes) {
      const f = this.where[c.group];
      if (c.group === 'GCPad2' && !this.inis[f].get('GCPad2', 'Device')) this.inis[f].set('GCPad2', 'Device', this.padDev('GCPad2'));
      this.inis[f].set(c.group, c.key, c.raw);
      touched.add(f);
    }
    for (const f of touched) writeWithBackup(path.join(dir, f), this.inis[f].toString());
    return [...touched].map((f) => path.join(dir, f));
  },
};

// ======================= Azahar (config/qt-config.ini, format Qt) =======================
const QK = { Escape: 0x01000000, Tab: 0x01000001, Backspace: 0x01000003, Enter: 0x01000004, NumpadEnter: 0x01000005, Insert: 0x01000006, Delete: 0x01000007, Pause: 0x01000008, PrintScreen: 0x01000009,
  Home: 0x01000010, End: 0x01000011, ArrowLeft: 0x01000012, ArrowUp: 0x01000013, ArrowRight: 0x01000014, ArrowDown: 0x01000015, PageUp: 0x01000016, PageDown: 0x01000017,
  ShiftLeft: 0x01000020, ShiftRight: 0x01000020, ControlLeft: 0x01000021, ControlRight: 0x01000021, AltLeft: 0x01000023, AltRight: 0x01000023, CapsLock: 0x01000024, ScrollLock: 0x01000026, Space: 0x20 };
const QSEQ = { Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace', Enter: 'Return', NumpadEnter: 'Enter', Insert: 'Ins', Delete: 'Del', Pause: 'Pause', PrintScreen: 'Print', Home: 'Home', End: 'End',
  ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down', PageUp: 'PgUp', PageDown: 'PgDown', Space: 'Space' };
function qtCode(b) {
  if (QK[b.code] !== undefined) return QK[b.code];
  const f = /^F(\d+)$/.exec(b.code); if (f) return 0x01000030 + (+f[1] - 1);
  const ch = (b.ch || '').toUpperCase();
  if (ch.length === 1 && ch.charCodeAt(0) < 256) return ch.charCodeAt(0);
  throw new Error('touche non reconnue');
}
const SDL_IDX = [0, 1, 2, 3, 9, 10, null, null, 4, 6, 7, 8, 11, 12, 13, 14, 5];   // bouton du navigateur → bouton SDL GameController
const AZ_BTN = [['button_a', 'A'], ['button_b', 'B'], ['button_x', 'X'], ['button_y', 'Y'], ['button_l', 'L'], ['button_r', 'R'], ['button_zl', 'ZL'], ['button_zr', 'ZR'],
  ['button_start', 'Start'], ['button_select', 'Select'], ['button_home', 'Home'], ['button_up', 'Croix haut'], ['button_down', 'Croix bas'], ['button_left', 'Croix gauche'], ['button_right', 'Croix droite']];
const AZ_SC_FR = { 'Continue/Pause Emulation': 'Pause / reprendre', 'Toggle Screen Layout': "Disposition des écrans", 'Swap Screens': 'Inverser les écrans', 'Fullscreen': 'Plein écran',
  'Capture Screenshot': "Capture d'écran", 'Restart Emulation': 'Redémarrer', 'Stop Emulation': 'Arrêter', 'Toggle Speed Limit': 'Limite de vitesse', 'Increase Speed Limit': 'Accélérer',
  'Decrease Speed Limit': 'Ralentir', 'Exit Azahar': 'Quitter Azahar', 'Exit Fullscreen': 'Quitter le plein écran', 'Load Amiibo': 'Charger un Amiibo', 'Remove Amiibo': 'Retirer l’Amiibo',
  'Advance Frame': 'Image par image', 'Toggle Frame Advancing': 'Mode image par image', 'Load File': 'Ouvrir un fichier', 'Toggle Filter Bar': 'Barre de filtre', 'Toggle Status Bar': "Barre d'état",
  'Rotate Screens Upright': 'Rotation des écrans', 'Toggle Per-Game Speed': 'Vitesse par jeu', 'Toggle Texture Dumping': 'Export des textures', 'Toggle Custom Textures': 'Textures perso',
  'Increase 3D Factor': '3D +', 'Decrease 3D Factor': '3D −', 'Quick Save': 'Sauvegarde rapide', 'Quick Load': 'Chargement rapide' };
const unq = (v) => (v && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : v || '');
const AZ = {
  id: 'azahar', name: 'Azahar',
  match: (exe) => /azahar|lime3ds|citra/i.test(path.basename(exe)),
  file(exe) {
    const d = path.dirname(exe);
    if (fs.existsSync(path.join(d, 'user'))) return path.join(d, 'user', 'config', 'qt-config.ini');
    const n = /lime3ds/i.test(exe) ? 'Lime3DS' : /citra/i.test(exe) && !/azahar/i.test(exe) ? 'Citra' : 'Azahar';
    return path.join(appData(), n, 'config', 'qt-config.ini');
  },
  groups: [],
  encode(b, gid) {
    if (gid === 'sc') {
      if (b.t === 'none') return '';
      if (b.t !== 'key') throw new Error('raccourcis Azahar : clavier uniquement');
      const k = QSEQ[b.code] || (/^F\d+$/.test(b.code) ? b.code : (b.ch || '').toUpperCase());
      if (!k) throw new Error('touche non reconnue');
      return (b.ctrl ? 'Ctrl+' : '') + (b.alt ? 'Alt+' : '') + (b.shift ? 'Shift+' : '') + k;
    }
    if (b.t === 'none') return '';
    if (b.t === 'key') {
      if (b.ctrl || b.alt || b.shift) throw new Error("Azahar n'accepte pas de combinaison pour un bouton");
      return `code:${qtCode(b)},engine:keyboard`;
    }
    if (!this.guid) throw new Error("aucune manette n'est encore configurée dans Azahar : impossible de connaître son identifiant. Assigne d'abord au clavier.");
    const base = `engine:sdl,guid:${this.guid},maptype:guid+port,port:${this.port || 0}`;
    if (b.t === 'btn') {
      if (b.i === 6 || b.i === 7) return `api:controller,axis:${b.i === 6 ? 4 : 5},direction:+,${base},threshold:0.5`;
      return `api:controller,button:${SDL_IDX[b.i]},${base}`;
    }
    return `api:controller,axis:${b.a},direction:${b.dir < 0 ? '-' : '+'},${base},threshold:${b.dir < 0 ? '-0.5' : '0.5'}`;
  },
  text(raw, gid) {
    if (!raw) return '—';
    if (gid === 'sc') return raw.replace('Shift', 'Maj');
    const p = Object.fromEntries(raw.split(',').map((x) => x.split(':')).filter((x) => x.length === 2));
    if (p.engine === 'keyboard') {
      const c = +p.code, sp = Object.entries(QK).find(([, v]) => v === c);
      if (sp) return FUNC[sp[0]] || sp[0];
      if (c >= 0x01000030 && c < 0x01000050) return 'F' + (c - 0x01000030 + 1);
      return String.fromCharCode(c);
    }
    if (p.engine === 'sdl') {
      if (p.button !== undefined) { const i = SDL_IDX.indexOf(+p.button); return 'Manette ' + (i >= 0 ? PAD_FR[i] : p.button); }
      if (p.axis === '4' || p.axis === '5') return 'Manette ' + (p.axis === '4' ? 'LT' : 'RT');
      if (p.axis !== undefined) return 'Manette ' + AXIS_FR(+p.axis, p.direction === '-' ? -1 : 1);
    }
    return p.name || raw;
  },
  decode(raw) {
    const p = Object.fromEntries(String(raw || '').split(',').map((x) => x.split(':')).filter((x) => x.length === 2));
    if (p.engine !== 'sdl') return null;
    if (p.button !== undefined) { const i = SDL_IDX.indexOf(+p.button); return i >= 0 ? { t: 'btn', i } : null; }
    if (p.axis === '4' || p.axis === '5') return { t: 'btn', i: p.axis === '4' ? 6 : 7 };
    if (p.axis !== undefined) return { t: 'axis', a: +p.axis, dir: p.direction === '-' ? -1 : 1 };
    return null;
  },
  load(exe) {
    const f = this.file(exe), txt = readText(f);
    if (txt === null) throw new Error(`fichier introuvable : ${f}. Lance Azahar une fois pour le créer.`);
    const ini = new Ini(txt);
    const prof = (+unq(ini.get('Controls', 'profile')) || 0) + 1;
    this.pre = `profiles\\${prof}\\`;
    const ctl = ini.keys('Controls').map(([, v]) => v).join(' ');
    const g = /guid:([0-9a-f]{32})/.exec(ctl); this.guid = g ? g[1] : '';
    const pt = /guid:[0-9a-f]{32}[^"]*?port:(\d+)/.exec(ctl); this.port = pt ? +pt[1] : 0;
    const sc = ini.keys('UI').map(([k]) => /^Shortcuts\\Main%20Window\\(.+)\\KeySeq$/.exec(k)).filter(Boolean).map((m) => m[1]);
    this.groups = [{ id: 'btn', title: 'Boutons', items: AZ_BTN },
      { id: 'sc', title: 'Raccourcis (clavier)', items: sc.map((k) => { const n = decodeURIComponent(k.replace(/\\/g, '/')); return [k, AZ_SC_FR[n] || n]; }) }];
    return {
      files: [f],
      get: (gid, key) => (gid === 'btn' ? unq(ini.get('Controls', this.pre + key)) : unq(ini.get('UI', `Shortcuts\\Main%20Window\\${key}\\KeySeq`))),
    };
  },
  save(exe, changes) {
    const f = this.file(exe), ini = new Ini(readText(f));
    const q = (v) => (/[,"\\;=]/.test(v) ? '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : v);
    for (const c of changes) {
      const sec = c.group === 'btn' ? 'Controls' : 'UI';
      const key = c.group === 'btn' ? this.pre + c.key : `Shortcuts\\Main%20Window\\${c.key}\\KeySeq`;
      ini.set(sec, key + '\\default', 'false', '=');
      ini.set(sec, key, q(c.raw), '=');
    }
    writeWithBackup(f, ini.toString());
    return [f];
  },
};

const ADAPTERS = [RA, P2, DOL, AZ];
const adapterFor = (exe) => (exe ? ADAPTERS.find((a) => a.match(exe)) : null);

function running(exe) {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(exe)}`, '/NH'], { encoding: 'utf-8', windowsHide: true, timeout: 5000 });
    return out.toLowerCase().includes(path.basename(exe).toLowerCase());
  } catch { return false; }
}

function load(exe) {
  const ad = adapterFor(exe);
  if (!ad) return { ok: false, unsupported: true, error: "Cet émulateur n'est pas encore pris en charge par l'éditeur intégré (RALibretro, PCSX2, Dolphin et Azahar le sont)." };
  if (!fs.existsSync(exe)) return { ok: false, error: 'Exécutable introuvable : ' + exe };
  try {
    const m = ad.load(exe);
    return {
      ok: true, id: ad.id, name: ad.name, files: m.files,
      groups: ad.groups.map((g) => ({ id: g.id, title: g.title, items: g.items.map(([key, label, opt]) => {
        const raw = m.get(g.id, key) || '';
        if (opt && opt.num) {   // réglage chiffré (zone morte) : sticks physiques concernés pour l'aperçu
          const ref = opt.stickKey ? ad.decode(m.get(g.id, opt.stickKey)) : null;
          return { key, label, num: true, min: opt.min, max: opt.max, unit: opt.unit, value: opt.in(raw), sticks: opt.sticks || (ref && ref.t === 'axis' ? [ref.a < 2 ? 0 : 2] : [0]) };
        }
        return { key, label, raw, text: ad.text(raw, g.id), pad: ad.decode ? ad.decode(raw) : null };
      }) })),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}
// convertit une touche neutre au format de l'émulateur (pour l'aperçu avant d'enregistrer)
function encode(exe, group, bind) {
  const ad = adapterFor(exe);
  try { if (!ad) throw new Error('émulateur non pris en charge'); ad.load(exe); const raw = ad.encode(bind, group); return { ok: true, raw, text: ad.text(raw, group), pad: ad.decode ? ad.decode(raw) : null }; } catch (e) { return { ok: false, error: e.message }; }
}
function save(exe, changes) {
  const ad = adapterFor(exe);
  if (!ad) return { ok: false, error: 'émulateur non pris en charge' };
  if (running(exe)) return { ok: false, error: `${ad.name} est ouvert : ferme-le avant d'enregistrer (il écraserait les changements en quittant).` };
  try {
    ad.load(exe);
    for (const c of changes) if (c.num !== undefined) {   // valeur affichée → format du fichier
      const g = ad.groups.find((x) => x.id === c.group), it = g && g.items.find(([k]) => k === c.key);
      if (!it || !it[2] || !it[2].num) throw new Error('réglage inconnu : ' + c.key);
      c.raw = it[2].out(Math.max(it[2].min, Math.min(it[2].max, Math.round(+c.num || 0))));
    }
    return { ok: true, files: ad.save(exe, changes) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---------- détection des émulateurs déposés dans le dossier « emulators » à côté d'Emuglob.exe ----------
const KNOWN_EXE = { 'ralibretro.exe': 'ralibretro', 'dolphin.exe': 'dolphin', 'pcsx2-qt.exe': 'pcsx2', 'pcsx2.exe': 'pcsx2', 'ppssppwindows64.exe': 'ppsspp', 'ppssppwindows.exe': 'ppsspp',
  'azahar.exe': 'azahar', 'eden.exe': 'eden', 'lichii.exe': 'lichii' };
function emuRoots(base) { return ['emulators', 'Emulators', 'emulateurs', 'Emulateurs'].map((d) => path.join(base, d)).filter((d, i, a) => a.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i && fs.existsSync(d)); }
function detect(base) {
  const found = {};
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isFile() && KNOWN_EXE[e.name.toLowerCase()] && !found[KNOWN_EXE[e.name.toLowerCase()]]) found[KNOWN_EXE[e.name.toLowerCase()]] = path.join(dir, e.name);
    if (depth < 3) for (const e of ents) if (e.isDirectory() && !/^(cores|saves|system|assets|plugins|locales|resources|shaders|cache|languages|sys|user)$/i.test(e.name)) walk(path.join(dir, e.name), depth + 1);
  };
  const roots = emuRoots(base);
  try { const ud = path.join(require('electron').app.getPath('userData'), 'emulators'); if (fs.existsSync(ud)) roots.push(ud); } catch { /* hors Electron */ }
  for (const r of roots) walk(r, 0);
  return found;
}

module.exports = { load, encode, save, bindText, isMod, Ini, detect, emuRoots, running };
