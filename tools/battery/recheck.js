#!/usr/bin/env node
'use strict';
// Vuelve a ejecutar con el código actual cada escena guardada en qa/battery/failures y dice cuáles siguen fallando.
const fs = require('fs'), path = require('path');
const families = require('./families.js'), Sim = require('../../src/engine/sim.js');
const dir = path.join(__dirname, '..', '..', 'qa', 'battery', 'failures'), still = {}, fixed = {};
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), m = families[j.family].make(j.seed);
  let fails; try { fails = m.check(Sim.run(JSON.parse(JSON.stringify(m.scene)))); } catch (e) { fails = [{ check: 'excepción', observed: e.message }]; }
  const key = j.family + ' · ' + j.fails[0].check;
  if (fails.length) (still[key] = still[key] || []).push(j.seed + ' (' + fails[0].observed + ')'); else fixed[key] = (fixed[key] || 0) + 1;
}
console.log('Resueltas con el código actual:', JSON.stringify(fixed, null, 1));
console.log('Siguen fallando:', JSON.stringify(still, null, 1));
