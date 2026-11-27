'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runJobs } = require('../benchmark/job-runner.cjs');
const { typedSchema } = require('../benchmark/discussion-policies.cjs');

test('invalid typed summary retains exact text, hash, usage and timing before rejection without replay', async t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-invalid-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const descriptor = {
    id: 'summary-invalid',
    outputSchema: typedSchema(),
    sourceHash: 'source',
    coveredDecisionIds: ['d1'],
    source: { pairs: [], frozenSnapshot: {}, frozenSnapshotHash: 'snap' },
    messages: [{ role: 'user', content: 'Summarize' }],
    mockText: ' {invalid response bytes}\n'
  };
  const manifest = {
    schemaVersion: 1,
    id: 'invalid-typed-summary',
    sourceFreezeHash: 'freeze',
    models: { mock: { provider: 'mock', model: 'synthetic', maxTokens: 4096 } },
    budget: { cap: 70, currency: 'CNY' },
    jobs: [{ id: descriptor.id, modelId: 'mock', credentialAlias: 'alias:fixture', schemeId: 'H7-code+typed', descriptor }]
  };

  const first = await runJobs(manifest, { mode: 'mock', output });
  assert.equal(first.status, 'incomplete');
  const r = first.requests[descriptor.id];
  assert.equal(r.status, 'failed');
  assert.equal(r.responseText, descriptor.mockText);
  assert.match(r.validationFailure, /Typed summary is not JSON/);
  assert.match(r.rawResponseSha256, /^[a-f0-9]{64}$/);
  assert.ok(r.startedAt && r.finishedAt && r.attempts[0].usage);
  assert.equal(first.results.length, 0);

  const second = await runJobs(manifest, { mode: 'mock', output, resume: true });
  assert.deepEqual(second.requests, first.requests);
  assert.equal(second.results.length, 0);

  for (const blockedStatus of ['received', 'unresolved']) {
    const cpPath = path.join(output, 'checkpoint.json');
    const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
    cp.requests[descriptor.id].status = blockedStatus;
    fs.writeFileSync(cpPath, JSON.stringify(cp));
    await assert.rejects(runJobs(manifest, { mode: 'mock', output, resume: true }), /replay prohibited/);
  }
});
