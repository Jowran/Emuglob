// Aide de TEST uniquement (variable EMUGLOB_FAKE_EMBED) : imite EmbedHelper.exe sans toucher à Windows.
const fs = require('fs');
const log = process.env.FAKE_EMBED_LOG;
const out = (s) => process.stdout.write(s + '\n');
out('ready');
require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
  if (log) fs.appendFileSync(log, line + '\n');
  const p = line.trim().split(' ');
  if (p[0] === 'embed') setTimeout(() => (process.env.FAKE_EMBED_FAIL ? out('error aucune fenetre trouvee (test)') : (out('found 4242'), out('embedded 4242'))), 400);
  else if (p[0] === 'close') out('closing');
  else if (p[0] === 'vol') { global.v = global.v || { l: 80, m: 0 }; if (+p[2] >= 0) global.v.l = +p[2]; if (+p[3] >= 0) global.v.m = +p[3]; out(`vol ${global.v.l} ${global.v.m} 1`); }
});
