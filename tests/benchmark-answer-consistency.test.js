'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const Consistency=require('../benchmark/answer-consistency.cjs');
const Core=require('../benchmark/core.cjs');
function context() {
  const snapshot={playerCount:4,selfSeat:1,selfHand:['1s','1s','2s','0s','2z','5z','2p','3p','6m'],game:{round:{wind:1,index:0},players:[0,1,2,3].map(seat=>({seat,riichi:false,melds:seat===0?[{tiles:['1z','1z','1z']}]:[]}))},rivers:[0,1,2,3].map(seat=>({seat,discards:seat===3?[{tile:'3z'},{tile:'0s'}]:[]}))};
  return {snapshot,localAnalysis:{efficiency:{status:'available',candidates:[{tile:'6m',shanten:4,totalUnseenUpperBound:24},{tile:'5z',shanten:4,totalUnseenUpperBound:74}]}}};
}
function answer(text,tile) { return {decision:{tile:'1s',reasons:tile?[]:[text]},efficiency:tile?[{tile,reasons:[text]}]:[],danger:[]}; }
function kinds(result) { return result.findings.map(f=>f.kind); }
test('current wind and dragon identities reject incorrect guest roles without forbidding a discard',()=>{
  const c=context();
  assert.deepEqual(kinds(Consistency.inspect(c,answer('2z是客风单张。'))),['honor-identity']);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('5z是客风。'))),['honor-identity']);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('5z是孤张客风牌。'))),['honor-identity']);
  assert.equal(Consistency.inspect(c,answer('2z是场风，但仍选择切2z。')).findings.length,0);
  c.snapshot.game.round.index=3;
  assert.equal(Consistency.inspect(c,answer('3z是自风。')).findings.length,0);
});
test('rejects pair and red retention reversals using the exact post-discard hand',()=>{
  const c=context();
  assert.deepEqual(kinds(Consistency.inspect(c,answer('备选打2s同样保持两向听，但会拆掉1s对子。'))),['pair-broken']);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('备选打2s同样保持两向听，但会拆掉1s对子，进张可能缩水。'))),['pair-broken'],'later uncertainty does not negate an earlier explicit assertion');
  assert.equal(Consistency.inspect(c,answer('打1s会拆掉1s对子。')).findings.length,0);
  assert.equal(Consistency.inspect(c,answer('打2s不会拆掉1s对子。')).findings.length,0);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('打0s保留赤5s打点。'))),['red-retained']);
  assert.equal(Consistency.inspect(c,answer('打5z保留赤5s打点。')).findings.length,0);
  assert.equal(Consistency.inspect(c,answer('打5z与打0s同向听，因此选择保留赤5s。')).findings.length,0,'comparative sentence changes subject before retention');
  assert.deepEqual(kinds(Consistency.inspect(c,answer('保留另一张1s作对子。','1s'))),['post-discard-pair']);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('备选打2z会放弃自家南风对子，损失役牌潜力。'))),['existing-honor-pair']);
});
test('does not confuse same-shanten ranking with strategic preference or scoped subsets',()=>{
  const c=context();
  assert.deepEqual(kinds(Consistency.inspect(c,answer('进张上界为24枚，与0m、9s、8s并列最高。','6m'))),['ranking-maximum']);
  assert.equal(Consistency.inspect(c,answer('进张上界为74枚，并列最高。','5z')).findings.length,0);
  assert.equal(Consistency.inspect(c,answer('进张上界24枚，虽然更窄但选择6m作防守取舍。','6m')).findings.length,0);
  assert.equal(Consistency.inspect(c,answer('进张上界24枚，在这三者中并列最高。','6m')).assertions.length,0);
  assert.equal(Consistency.inspect(c,answer('进张上界合计24枚，低于并列最高值74枚。','6m')).findings.length,0,'quoting a higher maximum is not claiming this candidate is maximum');
});
test('uses each opponents river with red-five normalization, never a meld as genbutsu',()=>{
  const c=context();
  assert.deepEqual(kinds(Consistency.inspect(c,answer('3z对下家是现物。'))),['genbutsu-seat']);
  assert.equal(Consistency.inspect(c,answer('3z对对家是现物。')).findings.length,0);
  assert.equal(Consistency.inspect(c,answer('5s对对家是现物。')).findings.length,0);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('3z对下家和对家都不是现物。'))),['genbutsu-seat']);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('1z对上家是现物。'))),['genbutsu-seat']);
  c.snapshot.rivers=c.snapshot.rivers.filter(x=>x.seat!==2);
  assert.equal(Consistency.inspect(c,answer('3z对下家是现物。')).assertions.length,0);
});
test('taatsu must have a supported same-suit shape, not merely adjacent numbers',()=>{
  const c=context();
  assert.deepEqual(kinds(Consistency.inspect(c,answer('代价是拆掉8p、9s的边张搭子。'))),['taatsu-shape']);
  assert.equal(Consistency.inspect(c,answer('保留2p、3p搭子。')).findings.length,0);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('2p、3p的边张搭子。'))),['taatsu-shape']);
  assert.equal(Consistency.inspect(c,answer('1p、2p的边张搭子。')).findings.length,0);
  assert.equal(Consistency.inspect(c,answer('2p、4p的嵌张搭子。')).findings.length,0);
  assert.deepEqual(kinds(Consistency.inspect(c,answer('1p与5p构成搭子。'))),['taatsu-shape']);
});
test('unknown identity, hypotheses, negations and ambiguous language abstain',()=>{
  const c=context();
  for(const text of ['如果2z是客风，就可以切出。','不能把2z称为客风。','2z不是客风。','“2z是客风”是错误说法。','2z可能是客风。','可能2z是客风。','打2s可能会拆掉1s对子。']) assert.equal(Consistency.inspect(c,answer(text)).findings.length,0,text);
  c.snapshot.game.round=null;
  const r=Consistency.inspect(c,answer('2z是客风。'));
  assert.equal(r.assertions.length,0);assert.equal(r.qualityPass,null);assert.equal(r.naturalLanguageVerified,false);
});
test('shape-only evidence produces a yaku boundary warning, never a no-yaku verdict or repair',()=>{
  const r=Consistency.inspect(context(),answer('和牌进张只有4m。'));
  assert.equal(r.findings.length,0);assert.equal(r.boundaryWarnings[0].kind,'yaku-not-verified');
  assert.equal(r.automaticCorrectionEnabled,false);assert.equal(r.boundaryWarnings[0].correctionEligible,false);
});
test('detects false global meld absence while preserving caller data and stale-state isolation',()=>{
  const c=context(), a=answer('全场无人立直、无副露，选择进攻。'), before=JSON.stringify({c,a});
  assert.deepEqual(kinds(Consistency.inspect(c,a)),['meld-absence']);assert.equal(JSON.stringify({c,a}),before);
  c.factCatalog={binding:{snapshotHash:Core.stableHash(c.snapshot)}};
  assert.doesNotThrow(()=>Consistency.inspect(c,a));c.snapshot.selfHand.pop();
  assert.throws(()=>Consistency.inspect(c,a),/binding mismatch/);
});
