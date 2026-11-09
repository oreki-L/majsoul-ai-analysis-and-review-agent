'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stableHash } = require('../benchmark/core.cjs');
const { journal } = require('../benchmark/durable.cjs');
const { sha256 } = require('../benchmark/mortal-teaching/prompts.cjs');
const { assertWholeBranches } = require('../benchmark/mortal-teaching/unified.cjs');
const { loadReuse, mergedRows } = require('../benchmark/mortal-teaching/reuse.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-reuse-'));
  t.after(() => { if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('unified-reuse-')) throw Error('Unsafe cleanup'); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(root,'source'), output = path.join(root,'output'); fs.mkdirSync(source); fs.mkdirSync(output);
  const file = 'results.jsonl', log = journal(path.join(source,file));
  const row = { id: 'old-failure', nodeId: 'n1', variant: 'p0', roundId: 'round', delivered: false, outcome: { ok: false, error: 'original format failure' }, inputHash: 'original-input', promptHash: 'original-prompt', mock: false };
  log.write('result',row);
  const plan = { kind: 'mortal-teaching-reuse-v1', sourceDirectory: source, sourceFiles: { [file]:sha256(fs.readFileSync(path.join(source,file))) }, datasetHash:'new-data', manifestHash:'same-prompts', rulesHash:'same-rules', main:[{ id:'new-batch:development:n1:p0', nodeId:'n1',variant:'p0',roundId:'round',file,sourceId:row.id,sourceHash:stableHash(row) }], supplement:[],engines:[] };
  fs.writeFileSync(path.join(output,'reuse-plan.json'),JSON.stringify(plan));
  fs.writeFileSync(path.join(output,'contract.json'),JSON.stringify({ datasetHash:plan.datasetHash,manifestHash:plan.manifestHash,rulesHash:plan.rulesHash,reusePlanHash:stableHash(plan) }));
  return { source,output,row,plan };
}
test('unified reuse requires complete variant/round branches so missing jobs never lose preceding teaching history',()=>{
  const nodes=[{id:'a',roundId:'r1'},{id:'b',roundId:'r1'},{id:'c',roundId:'r2'}];
  const specs=[{nodeId:'a',roundId:'r1',variant:'p0'},{nodeId:'b',roundId:'r1',variant:'p0'}];
  assert.doesNotThrow(()=>assertWholeBranches(nodes,specs));
  assert.throws(()=>assertWholeBranches(nodes,specs.slice(0,1)),/Partially reused history/);
  assert.throws(()=>assertWholeBranches(nodes,[...specs,specs[0]]),/Duplicate reused/);
});
test('retained failures stay in the unified result denominator without retry or replacement',t=>{
  const { output,row }=fixture(t); const before=JSON.stringify(row);
  const rows=mergedRows(output,path.join(output,'live','development'),'development');
  assert.equal(rows.length,1); assert.equal(rows[0].delivered,false);
  assert.equal(rows[0].outcome.error,'original format failure'); assert.equal(rows[0].reuseProvenance.billingJobId,row.id);
  assert.equal(JSON.stringify(row),before); assert.equal(fs.existsSync(path.join(output,'live')),false);
});
test('unified merge rejects any duplicate dispatch of an already retained opportunity',t=>{
  const { output,plan }=fixture(t);const dir=path.join(output,'live','development');fs.mkdirSync(dir,{recursive:true});
  journal(path.join(dir,'results.jsonl')).write('result',{id:plan.main[0].id,delivered:true});
  assert.throws(()=>mergedRows(output,dir,'development'),/Duplicate generated\/reused/);
});
test('reuse refuses changed archived bytes and changed target bindings',t=>{
  const { source,output }=fixture(t);
  assert.equal(loadReuse(output).rows().length,1);
  fs.appendFileSync(path.join(source,'results.jsonl'),'\n');
  assert.throws(()=>loadReuse(output),/Original reuse evidence changed/);
  const target=JSON.parse(fs.readFileSync(path.join(output,'contract.json'))); target.datasetHash='other';fs.writeFileSync(path.join(output,'contract.json'),JSON.stringify(target));
  assert.throws(()=>loadReuse(output),/Frozen reuse plan changed/);
});
