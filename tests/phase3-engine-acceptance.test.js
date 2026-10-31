'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRunner } = require('../agent/mjai-process.cjs');
const wrapper = path.resolve(__dirname, '../agent/mjai-python-wrapper.py');
const python = ['python', 'python3'].find(command => spawnSync(command, ['-c', 'import sys; assert sys.version_info >= (3,8)'], { windowsHide: true, timeout: 5000 }).status === 0);
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-independent-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const events = seat => [{ type: 'start_game', id: seat }];
function invoke(dir, args, input) { return spawnSync(python, [wrapper, '--module', 'fixture_bot', '--module-dir', dir, ...args], { input: JSON.stringify(input) + '\n', encoding: 'utf8', timeout: 5000, windowsHide: true }); }

test('phase3 independent: check imports but never constructs or infers, including seat constructor', { skip: !python }, t => {
  const dir = directory(t), marker = path.join(dir, 'imported');
  fs.writeFileSync(path.join(dir, 'fixture_bot.py'), `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('import side effect')\nclass Bot:\n    def __init__(self, seat): raise RuntimeError('SECRET_CONSTRUCTOR')\n    def react(self, events): raise RuntimeError('SECRET_INFERENCE')\n`);
  const checked = invoke(dir, ['--constructor', 'seat', '--check'], null);
  assert.equal(checked.status, 0); assert.equal(checked.stderr, ''); assert.equal(fs.readFileSync(marker, 'utf8'), 'import side effect');
  assert.deepEqual(JSON.parse(checked.stdout), { format: 'mjai-python-interface-v1', constructor: 'seat', react: 'events-json', signatureCompatible: true, inferenceVerified: false });
  const mismatch = invoke(dir, ['--check'], events(2));
  assert.equal(mismatch.status, 1); assert.equal(mismatch.stdout, ''); assert.equal(mismatch.stderr.trim(), 'mjai wrapper failed: INTERFACE_INCOMPATIBLE');
  const inference = invoke(dir, ['--constructor', 'seat'], events(2));
  assert.equal(inference.status, 1); assert.equal(inference.stderr.trim(), 'mjai wrapper failed: CONSTRUCTOR_FAILED');
  assert.doesNotMatch(inference.stderr, /SECRET/);
});

test('phase3 independent: seat is actual start_game id; invalid/duplicate starts never construct', { skip: !python }, t => {
  const dir = directory(t), marker = path.join(dir, 'constructed');
  fs.writeFileSync(path.join(dir, 'fixture_bot.py'), `import json\nfrom pathlib import Path\nclass Bot:\n    def __init__(self, seat):\n        Path(${JSON.stringify(marker)}).write_text(str(seat))\n        self.seat=seat\n    def react(self, payload):\n        assert json.loads(payload)[0]['id'] == self.seat\n        return {'type':'reach','actor':self.seat}\n`);
  for (const seat of [0,1,2,3]) { const r = invoke(dir, ['--constructor', 'seat'], events(seat)); assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout), { type: 'reach', actor: seat }); }
  fs.unlinkSync(marker);
  for (const input of [events(true), events(-1), events(4), events('2'), [], [...events(0), ...events(1)], [{type:'none'}, ...events(2)]]) {
    const r = invoke(dir, ['--constructor', 'seat'], input); assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.equal(r.stderr.trim(), 'mjai wrapper failed: INVALID_INPUT'); assert.equal(fs.existsSync(marker), false);
  }
});

function request() { return { format:'majsoul-mjai-v1', seat:0, events:[{type:'start_game',id:0,names:[0,1,2,3].map(i=>'Player '+i)},{type:'start_kyoku',bakaze:'E',dora_marker:'1m',kyoku:1,honba:0,kyotaku:0,oya:0,scores:[25000,25000,25000,25000],tehais:[Array(13).fill('1m'),...Array.from({length:3},()=>Array(13).fill('?'))]},{type:'tsumo',actor:0,pai:'9p'}] }; }
const running = pid => {
  try {
    process.kill(pid, 0);
    // Linux kill(pid, 0) also succeeds for a dead zombie awaiting its new
    // parent's reap. SIGKILL has terminated it; it cannot execute or be waited
    // for by this test, which is not its parent. Keep live descendants failing.
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] === 'Z') return false;
    }
    return true;
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes(error.code)) return false;
    throw error;
  }
};
test('phase3 independent: actual runner terminates parent and child process after success and cancellation', { timeout: 15000 }, async t => {
  const dir = directory(t), bot = path.join(dir,'tree.cjs');
  fs.writeFileSync(bot, `const fs=require('node:fs'),{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,c.pid]));require('node:readline').createInterface({input:process.stdin}).once('line',()=>{if(process.argv[3]==='success')console.log('{"type":"none"}');setInterval(()=>{},1000);});`);
  for (const mode of ['success','cancel']) {
    const file = path.join(dir,mode+'.json'), controller = new AbortController();
    const pending = createRunner({command:process.execPath,args:[bot,file,mode],timeoutMs:5000}).infer(request(),{signal:controller.signal});
    for(let n=0;n<100&&!fs.existsSync(file);n++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(fs.existsSync(file),'child process started'); const pids=JSON.parse(fs.readFileSync(file,'utf8'));
    if(mode==='cancel') { controller.abort(); await assert.rejects(pending,{name:'AbortError'}); } else assert.deepEqual(await pending,{action:{type:'none'}});
    assert.deepEqual(pids.filter(running),[],'runner completion must follow process tree termination (terminated zombies are not running)');
  }
});
