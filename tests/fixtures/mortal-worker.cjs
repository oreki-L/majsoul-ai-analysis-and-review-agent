'use strict';
const readline = require('node:readline');
const source = require('../../agent/mortal-source.json');
const mode = process.argv[2];
if(mode==='boot-crash'){
  if(process.argv[3])require('node:fs').appendFileSync(process.argv[3],process.pid+'\n');
  process.exit(9);
}
console.log(JSON.stringify({ protocol: source.protocol, type: 'ready', identity: { model: source.model, modelRevision: source.modelRevision,
  sourceCommit: source.sourceCommit, checkpoint: source.files[0].sha256, runtime: 'win64-py3119-torch270cpu-np1262-' + source.native.sha256.slice(0,16) } }));
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (mode === 'crash') process.exit(7);
  if (mode === 'hang') return;
  if (mode === 'malformed') { console.log('{'); return; }
  if (mode === 'oversized') { console.log('x'.repeat(70000)); return; }
  console.log(JSON.stringify({ protocol: source.protocol, type: 'result', requestId: mode === 'wrong-id' ? 'wrong' : request.requestId,
    action: { type: 'dahai', actor: request.seat, pai: 'C', tsumogiri: false } }));
});
