'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunner } = require('../agent/mjai-process.cjs');
const wrapper = path.resolve(__dirname, '../agent/mjai-python-wrapper.py');
const python = ['python', 'python3'].find(command => {
  const result = spawnSync(command, ['-c', 'import sys; assert sys.version_info >= (3, 8)'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  return result.status === 0;
});
const request = () => ({ format: 'majsoul-mjai-v1', seat: 0, events: [
  { type: 'start_game', id: 0, names: [0, 1, 2, 3].map(n => 'Player ' + n) },
  { type: 'start_kyoku', bakaze: 'E', dora_marker: '1m', kyoku: 1, honba: 0, kyotaku: 0, oya: 0, scores: [25000, 25000, 25000, 25000], tehais: [Array(13).fill('1m'), ...Array.from({ length: 3 }, () => Array(13).fill('?'))] },
  { type: 'tsumo', actor: 0, pai: '5mr' }
] });
function setup(t, source, className = 'Bot') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mjai-python-test-'));
  fs.writeFileSync(path.join(directory, 'user_bot.py'), source);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { command: python, args: [wrapper, '--module', 'user_bot', '--class', className, '--module-dir', directory], timeoutMs: 5000 };
}

test('Python wrapper isolates initialization/react debug and strips metadata while preserving red tiles', { skip: !python }, async t => {
  const config = setup(t, `import json, os
print('INIT_DEBUG')
os.write(1, b'NATIVE_INIT_DEBUG\\n')
class CustomBot:
    def __init__(self): print('CONSTRUCTOR_DEBUG')
    def react(self, payload):
        print('REACT_DEBUG')
        os.write(1, b'NATIVE_REACT_DEBUG\\n')
        events = json.loads(payload)
        assert isinstance(events, list)
        return json.dumps({'type': 'dahai', 'actor': events[0]['id'], 'pai': events[-1]['pai'], 'tsumogiri': True, 'meta': {'q_values': [1, 2]}, 'apiKey': 'PRIVATE'})
`, 'CustomBot');
  assert.deepEqual(await createRunner(config).infer(request()), { action: { type: 'dahai', actor: 0, pai: '5mr', tsumogiri: true } });
});

test('Python wrapper supports dictionary responses and retains only standard action fields', { skip: !python }, async t => {
  const config = setup(t, `class Bot:
    def react(self, payload):
        return {'type': 'pon', 'actor': 0, 'target': 1, 'pai': '5mr', 'consumed': ['5m', '5m'], 'meta': {'secret': 'PRIVATE'}, 'unknown': 123}
`);
  assert.deepEqual(await createRunner(config).infer(request()), { action: { type: 'pon', actor: 0, target: 1, pai: '5mr', consumed: ['5m', '5m'] } });
});

test('Python wrapper failures expose only a fixed diagnostic and no stdout', { skip: !python }, async t => {
  for (const source of [
    "raise RuntimeError('PRIVATE_INIT_TOKEN')\n",
    "class Bot:\n    def react(self, payload): raise RuntimeError('PRIVATE_REACT_TOKEN')\n",
    "class Bot:\n    def react(self, payload): return 'not JSON PRIVATE'\n",
    `class Bot:\n    def react(self, payload): return '{"type":"none","meta":NaN}'\n`,
    `class Bot:\n    def react(self, payload): return '{"type":"none","meta":Infinity}'\n`,
    "class Bot:\n    def react(self, payload): return {'type': 'dahai', 'actor': float('nan'), 'pai': '1m', 'tsumogiri': True}\n",
    "class Bot:\n    def react(self, payload): return {'type': 'none', 'meta': float('inf')}\n"
  ]) {
    const config = setup(t, source);
    const result = spawnSync(config.command, config.args, { input: JSON.stringify(request().events) + '\n', encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr.replace(/\r\n/g, '\n'), /^mjai wrapper failed: (IMPORT_FAILED|REACT_FAILED|INVALID_ACTION)\n$/);
    await assert.rejects(createRunner(config).infer(request()), error => error.message === 'Engine inference failed' && !String(error).includes('PRIVATE'));
  }
});

test('seat constructor receives the requested player id for every seat without fallback', { skip: !python }, async t => {
  const config = setup(t, `import json
class Bot:
    def __init__(self, player_id): self.player_id = player_id
    def react(self, payload):
        events = json.loads(payload)
        assert events[0]['id'] == self.player_id
        return {'type': 'dahai', 'actor': self.player_id, 'pai': events[-1]['pai'], 'tsumogiri': True}
`);
  config.args.push('--constructor', 'seat');
  for (let seat = 0; seat < 4; seat++) {
    const input = request(); input.seat = seat; input.events[0].id = seat;
    input.events[1].tehais = Array.from({ length: 4 }, (_, index) => Array(13).fill(index === seat ? '1m' : '?'));
    input.events[2].actor = seat;
    assert.equal((await createRunner(config).infer(input)).action.actor, seat);
  }
  const zero = spawnSync(python, config.args.slice(0, -2), { input: JSON.stringify(request().events) + '\n', encoding: 'utf8', windowsHide: true });
  assert.equal(zero.status, 1);
  assert.equal(zero.stderr.trim(), 'mjai wrapper failed: INTERFACE_INCOMPATIBLE');
});

test('interface check inspects signatures without constructing or inferring and rejects incompatible APIs', { skip: !python }, t => {
  const config = setup(t, `print('IMPORT_DEBUG')
class Bot:
    def __init__(self, player_id): raise RuntimeError('PRIVATE_CONSTRUCTOR')
    def react(self, payload): raise RuntimeError('PRIVATE_REACT')
`);
  const result = spawnSync(python, [...config.args, '--constructor', 'seat', '--check'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(result.status, 0);
  assert.equal(result.stderr.trim(), 'IMPORT_DEBUG');
  assert.deepEqual(JSON.parse(result.stdout), { format: 'mjai-python-interface-v1', constructor: 'seat', react: 'events-json', signatureCompatible: true, inferenceVerified: false });
  for (const source of [
    'class Bot:\n    pass\n',
    'class Bot:\n    async def react(self, payload): pass\n',
    'class Bot:\n    def react(self, payload): yield {}\n',
    'class Bot:\n    def react(self, payload, required): pass\n',
    'Bot = lambda: None\n'
  ]) {
    const incompatible = setup(t, source);
    const checked = spawnSync(python, [...incompatible.args, '--check'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(checked.status, 1);
    assert.equal(checked.stdout, '');
    assert.equal(checked.stderr.trim(), 'mjai wrapper failed: INTERFACE_INCOMPATIBLE');
  }
});

test('wrapper rejects invalid or repeated player identities before constructing the bot', { skip: !python }, t => {
  const config = setup(t, `class Bot:
    def __init__(self, player_id): raise RuntimeError('PRIVATE_CONSTRUCTOR')
    def react(self, payload): return {'type': 'none'}
`);
  config.args.push('--constructor', 'seat');
  const valid = request().events;
  for (const events of [[], valid.slice(1), [{ ...valid[0], id: true }, ...valid.slice(1)], [{ ...valid[0], id: 4 }, ...valid.slice(1)], [...valid, valid[0]], [valid[1], valid[0], valid[2]]]) {
    const result = spawnSync(python, config.args, { input: JSON.stringify(events) + '\n', encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'mjai wrapper failed: INVALID_INPUT');
  }
  const constructed = spawnSync(python, config.args, { input: JSON.stringify(valid) + '\n', encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(constructed.stderr.trim(), 'mjai wrapper failed: CONSTRUCTOR_FAILED');
  assert.equal(constructed.stdout, '');
});

test('normal inference preserves callable APIs with unavailable signatures while check fails explicitly', { skip: !python }, async t => {
  for (const unavailable of ['constructor', 'react', 'both']) {
    const config = setup(t, `import json
class Bot:
    def react(self, payload):
        events = json.loads(payload)
        return {'type': 'dahai', 'actor': events[0]['id'], 'pai': events[-1]['pai'], 'tsumogiri': True}
${unavailable !== 'react' ? 'Bot.__signature__ = object()' : ''}
${unavailable !== 'constructor' ? 'Bot.react.__signature__ = object()' : ''}
`);
    assert.deepEqual(await createRunner(config).infer(request()), { action: { type: 'dahai', actor: 0, pai: '5mr', tsumogiri: true } });
    const checked = spawnSync(python, [...config.args, '--check'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(checked.status, 1);
    assert.equal(checked.stdout, '');
    assert.equal(checked.stderr.trim(), 'mjai wrapper failed: SIGNATURE_UNAVAILABLE');
  }
  // An unavailable constructor signature must not bypass definite react errors.
  for (const react of ['def react(self, payload, required): pass', 'async def react(self, payload): pass', 'def react(self, payload): yield {}']) {
    const config = setup(t, `class Bot:\n    __signature__ = object()\n    ${react}\n`);
    const result = spawnSync(python, config.args, { input: JSON.stringify(request().events) + '\n', encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'mjai wrapper failed: INTERFACE_INCOMPATIBLE');
  }
});
