// Discord Rich Presence sans dépendance : protocole IPC local de Discord (tube nommé sous Windows, socket Unix ailleurs).
// Trame = opcode (int32 LE) + longueur (int32 LE) + JSON. 0 = HANDSHAKE, 1 = FRAME, 2 = CLOSE, 3 = PING, 4 = PONG.
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const pipePath = (i) => (process.platform === 'win32'
  ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp', `discord-ipc-${i}`));

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const h = Buffer.alloc(8);
  h.writeInt32LE(op, 0); h.writeInt32LE(json.length, 4);
  return Buffer.concat([h, json]);
}

class DiscordPresence {
  constructor(log = () => {}) { this.log = log; this.sock = null; this.ready = false; this.clientId = ''; this.activity = null; this.retry = null; this.buf = Buffer.alloc(0); this.status = 'off'; }

  // activity = null pour effacer ; clientId vide = désactivé
  set(clientId, activity) {
    clientId = String(clientId || '').trim();
    if (clientId !== this.clientId) { this.close(); this.clientId = clientId; }
    this.activity = activity || null;
    if (!this.clientId) { this.status = 'off'; return; }
    if (this.ready) this.push();
    else if (!this.sock && this.activity) this.connect(0);
  }

  connect(i) {
    clearTimeout(this.retry); this.retry = null;
    const s = net.createConnection(pipePath(i));
    let opened = false;
    this.sock = s;
    s.on('connect', () => { opened = true; s.write(frame(0, { v: 1, client_id: this.clientId })); });
    s.on('data', (d) => this.onData(d));
    s.on('error', () => {});
    s.on('close', () => {
      if (this.sock !== s) return;
      this.sock = null; this.ready = false; this.buf = Buffer.alloc(0);
      if (!opened && i < 9) return this.connect(i + 1);   // Discord écoute sur le premier tube libre (0 à 9)
      this.status = opened ? 'déconnecté' : 'Discord introuvable';
      if (this.clientId && this.activity) this.retry = setTimeout(() => { if (!this.sock) this.connect(0); }, 15000);
    });
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = null;
      try { msg = JSON.parse(this.buf.toString('utf8', 8, 8 + len)); } catch { /* trame illisible */ }
      this.buf = this.buf.subarray(8 + len);
      if (op === 3) { this.sock && this.sock.write(frame(4, msg)); continue; }
      if (op === 2) { this.status = 'refusé : ' + ((msg && msg.message) || 'identifiant d\'application invalide ?'); this.log('discord : ' + this.status); this.clientId = ''; this.close(); return; }
      if (!msg) continue;
      if (msg.evt === 'READY') { this.ready = true; this.status = 'connecté'; this.push(); }
      else if (msg.evt === 'ERROR') { this.status = 'erreur : ' + ((msg.data && msg.data.message) || '?'); this.log('discord : ' + this.status); }
    }
  }

  push() {
    if (!this.sock || !this.ready) return;
    this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.activity || undefined }, nonce: crypto.randomUUID() }));
  }

  close() {
    clearTimeout(this.retry); this.retry = null;
    const s = this.sock; this.sock = null; this.ready = false; this.buf = Buffer.alloc(0);
    if (s) { try { s.end(frame(2, {})); } catch { /* déjà fermé */ } s.destroy(); }
  }
}

module.exports = { DiscordPresence, pipePath, frame };
