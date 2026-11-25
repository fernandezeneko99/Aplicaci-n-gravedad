'use strict';
// El host corre en ExtendScript (ECMAScript 3): se comprueba la sintaxis y se vetan métodos que ES3 no tiene.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const acorn = require('acorn'), walk = require('acorn-walk');
const dir = path.join(__dirname, '..', 'src', 'host');
const files = fs.readdirSync(dir).filter((f) => /\.jsx?$/.test(f) && f !== 'json2.js');
const banned = new Set(['map', 'forEach', 'filter', 'reduce', 'some', 'every', 'trim', 'bind', 'isArray', 'find', 'findIndex', 'includes', 'startsWith', 'endsWith', 'repeat', 'padStart']);
const objectOnly = new Set(['keys', 'assign', 'create', 'defineProperty', 'freeze']);

for (const f of files) {
  test('ES3 válido: ' + f, () => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(/^[\x00-\x7f]*$/.test(src), f + ' debe ser ASCII (usa \\u para acentos): ExtendScript puede leerlo con otra codificación');
    const ast = acorn.parse(src, { ecmaVersion: 3, allowReserved: false });
    walk.simple(ast, {
      CallExpression(n) {
        if (n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'Object' && objectOnly.has(n.callee.property.name)) assert.fail(f + ': usa Object.' + n.callee.property.name);
        if (n.callee.type === 'MemberExpression' && !n.callee.computed && banned.has(n.callee.property.name) && !(n.callee.object.type === 'Identifier' && /^(Gravedad|GravedadGeometry|JSON)$/.test(n.callee.object.name)))
          assert.fail(f + ':' + src.slice(0, n.start).split('\n').length + ' usa .' + n.callee.property.name + '() que ExtendScript no tiene');
      }
    });
  });
}
