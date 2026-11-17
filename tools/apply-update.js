// Remplace app.asar APRÈS la fermeture d'Emuglob (Windows verrouille le fichier tant que l'application tourne), puis relance Emuglob.
// Lancé par main.js avec l'exécutable d'Electron en mode Node (ELECTRON_RUN_AS_NODE=1) :
//   node apply-update.js <pid d'Emuglob> <nouveau app.asar> <app.asar à remplacer> <exécutable à relancer>
// L'ancien app.asar est gardé dans « app.asar.bak » (on peut donc revenir en arrière) ; en cas d'échec il est remis en place.
const fs = require('original-fs');   // fs « sans magie asar » : on écrit un fichier .asar
const path = require('path');
const { spawn } = require('child_process');

const [, , ppid, src, dst, exe] = process.argv;
const logFile = path.join(path.dirname(process.argv[1]), 'update.log');
const log = (m) => { try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + m + '\n'); } catch { /* le journal est un plus */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };

(async () => {
  log(`mise à jour : ${src} -> ${dst}`);
  for (let i = 0; i < 60 && alive(ppid); i++) await sleep(500);   // attend la fermeture d'Emuglob (30 s maximum)
  let ok = false;
  let data;
  try { data = fs.readFileSync(src); } catch (e) { log('lecture impossible : ' + e.message); }
  if (data) {
    const bak = dst + '.bak';
    for (let i = 0; i < 40 && !ok; i++) {   // les processus d'Electron peuvent mettre un instant à libérer le fichier
      try {
        if (fs.existsSync(dst)) fs.copyFileSync(dst, bak);
        fs.writeFileSync(dst, data);
        ok = true;
      } catch (e) {
        log('tentative ' + (i + 1) + ' : ' + e.message);
        await sleep(500);
      }
    }
    if (!ok && fs.existsSync(bak)) { try { fs.copyFileSync(bak, dst); log('ancienne version remise en place'); } catch (e) { log('remise en place impossible : ' + e.message); } }
  }
  log(ok ? 'mise à jour terminée' : 'mise à jour ÉCHOUÉE');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;   // sinon l'exécutable relancé se comporterait comme Node, pas comme Emuglob
  spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref();
})();
