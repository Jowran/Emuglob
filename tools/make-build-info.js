// À lancer avant de construire app.asar : écrit build-info.json (date + empreintes SHA-256).
// Au démarrage, boot.js compare ces empreintes pour signaler un fichier abîmé dans app.asar.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const files = ['package.json', 'index.html', ...fs.readdirSync(root).filter((f) => f.endsWith('.js') && f !== 'boot.js'),
  ...fs.readdirSync(path.join(root, 'tools')).map((f) => 'tools/' + f)];
const sha256 = {};
for (const f of files.sort()) sha256[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify({ built: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), sha256 }, null, 1) + '\n');
console.log(`build-info.json : ${files.length} fichiers`);
