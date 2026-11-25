// Convierte los caracteres no ASCII de los .jsx en secuencias \uXXXX (ExtendScript no siempre lee UTF-8 sin BOM).
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src', 'host');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsx'))) {
  const p = path.join(dir, f), src = fs.readFileSync(p, 'utf8');
  const out = src.replace(/[^\x00-\x7f]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  if (out !== src) { fs.writeFileSync(p, out); console.log('ascii:', f); }
}
