'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { source, sampleRequest, runtimeConfig, verifyFiles, setup, main } = require('../agent/akagi-local.cjs');
const Mjai = require('../extension/adapters/mjai.js');

test('Akagi profile pins each downloaded artifact and passes anonymous synthetic input', () => {
  assert.match(source.commit, /^[a-f0-9]{40}$/);
  assert.equal(source.files.length, 5);
  assert(source.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && !file.path.includes('..')));
  assert.equal(Mjai.validateRequest(sampleRequest()).seat, 0);
  const config = runtimeConfig({ dir: 'local model', python: 'python.exe' });
  assert.equal(config.command, 'python.exe');
  assert.equal(config.args[0], '-I');
  assert.equal(config.args.at(-1), path.resolve('local model'));
  assert(config.timeoutMs >= 15000);
});

test('Akagi setup preserves existing mismatched files and reports missing artifacts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'akagi-profile-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(verifyFiles(dir), /FILES_MISSING/);
  await fs.writeFile(path.join(dir, 'model.py'), 'user content');
  await assert.rejects(verifyFiles(dir), /SOURCE_HASH_MISMATCH/);
  await assert.rejects(setup(dir), /EXISTING_FILE_MISMATCH/);
  assert.equal(await fs.readFile(path.join(dir, 'model.py'), 'utf8'), 'user content');
});

test('Akagi CLI rejects ambiguous command lines before reading model files', async () => {
  await assert.rejects(main(['check', '--dir', 'x']), /MISSING_ARGUMENTS/);
  await assert.rejects(main(['check', '--config', 'x']), /INVALID_ARGUMENTS/);
  await assert.rejects(main(['other']), /INVALID_COMMAND/);
});
