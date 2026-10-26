'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const State = require('../extension/state.js');
const Snapshot = require('../extension/collector/snapshot-adapter.js');
const Mjai = require('../extension/adapters/mjai.js');
const Agent = require('../extension/engine-agent.js');

// Independent artificial live situations: no game account, replay, or network.
const basicHand = ['1m','3m','4m','5m','6m','1p','2p','3p','1s','2s','3s','1z','1z'];
const drop = (seat, tile, extra = {}) => ({ kind: 'DiscardTile', seat, tile, riichi: false, tsumogiri: false, ...extra });
const draw = (seat, tile = '?', extra = {}) => ({ kind: 'DealTile', seat, tile, ...extra });
const call = (seat, meldType, tiles, froms) => ({ kind: 'ChiPengGang', seat, meldType, tiles, froms });
function situation(actions, hand = basicHand, seat = 1) {
  let remaining = seat === 0 ? 70 : 69;
  const events = [{ kind: 'NewRound', source: 'live', step: 0, wind: 0, round: 0, honba: 0, sticks: 0,
    scores: [25000,25000,25000,25000], remaining: 69, doras: ['7z'], hand: hand.slice() },
    ...actions.map((e, i) => ({ source: 'live', step: i + 1, ...(e.kind === 'DealTile' ? {remaining: --remaining} : {}), ...e }))];
  let state = State.initial('live', seat);
  for (const event of events) state = State.apply(state, event);
  assert.equal(state.complete, true, state.warnings.join(';'));
  return { snapshot: Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true }),
    request: Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'live', state, events }, { hand: true }) };
}
const infer = (context, action) => Agent.run({ ...context, infer: async () => ({ action }) });
const chiEvents = [drop(0,'2m'), call(1,0,['1m','2m','3m'],[1,0,1])];

test('actions acceptance: own chi permits a hand discard, rejects fictional tsumogiri and called river mismatch', async () => {
  const c = situation(chiEvents);
  assert.equal(c.snapshot.rivers[0].discards[0].called, true);
  assert.equal((await infer(c,{type:'dahai',actor:1,pai:'4m',tsumogiri:false})).engine.action.pai,'4m');
  await assert.rejects(infer(c,{type:'dahai',actor:1,pai:'4m',tsumogiri:true}));
  c.snapshot.rivers[0].discards[0].called = false;
  let calls = 0;
  await assert.rejects(Agent.run({...c,infer:async()=>{calls++;return {action:{type:'dahai',actor:1,pai:'4m',tsumogiri:false}};}}));
  assert.equal(calls,0);
});

test('actions acceptance: call responses consume exact red tiles and preserve source', async () => {
  const hand = ['0p','5p',...basicHand.slice(2)];
  const c = situation([drop(0,'5p')], hand);
  const a = {type:'pon',actor:1,target:0,pai:'5p',consumed:['5pr','5p']};
  assert.deepEqual((await infer(c,a)).engine.action,a);
  for (const bad of [{...a,consumed:['5p','5p']},{...a,target:2},{...a,pai:'5pr'}]) await assert.rejects(infer(c,bad));
});

test('actions acceptance: opponent chi and pon resume at caller rather than normal next actor', async () => {
  for (const [type,tiles,froms] of [[0,['1m','2m','3m'],[0,0,3]],[1,['3m','3m','3m'],[0,0,3]]]) {
    const c = situation([drop(0,'9p'),draw(1,'9s'),drop(1,'9s',{tsumogiri:true}),draw(2),drop(2,'9p'),draw(3),drop(3,'3m'),
      call(0,type,tiles,froms),drop(0,'8p'),draw(1,'8s')]);
    assert.equal((await infer(c,{type:'dahai',actor:1,pai:'8s',tsumogiri:true})).engine.action.pai,'8s');
  }
});

test('actions acceptance: own daiminkan waits for replacement draw and appended dora', async () => {
  const hand = ['5p','0p','5p',...basicHand.slice(3)];
  const actions = [drop(0,'5p'),call(1,2,['5p','5p','0p','5p'],[0,1,1,1])];
  const response = {type:'daiminkan',actor:1,target:0,pai:'5p',consumed:['5p','5pr','5p']};
  assert.equal((await infer(situation(actions.slice(0,1),hand),response)).engine.action.type,'daiminkan');
  const pending = situation(actions,hand);
  await assert.rejects(infer(pending,{type:'dahai',actor:1,pai:'4m',tsumogiri:false}));
  const c = situation([...actions,draw(1,'9s',{doras:['7z','2z']})],hand);
  assert.equal((await infer(c,{type:'dahai',actor:1,pai:'9s',tsumogiri:true})).engine.action.pai,'9s');
  assert.deepEqual(c.snapshot.game.doras,['7z','2z']);
});

test('actions acceptance: own ankan consumes red composition, opponent ambiguous five ankan stays unsupported', async () => {
  const hand = ['0m','5m','5m',...basicHand.slice(3)];
  // Avoid the fourth 5m accidentally appearing in the unchanged tail.
  hand[3] = '7m';
  const response = {type:'ankan',actor:1,consumed:['5mr','5m','5m','5m']};
  assert.equal((await infer(situation([drop(0,'9p'),draw(1,'5m')],hand),response)).engine.action.type,'ankan');
  await assert.rejects(infer(situation([drop(0,'9p'),draw(1,'5m')],hand),{...response,consumed:['5m','5m','5m','5m']}));
  const c = situation([drop(0,'9p'),draw(1,'5m'),{kind:'AnGangAddGang',seat:1,meldType:3,tile:'5m'},draw(1,'9s')],hand);
  assert.deepEqual(c.request.events.find(e=>e.type==='ankan').consumed,['5mr','5m','5m','5m']);
  assert.equal((await infer(c,{type:'dahai',actor:1,pai:'9s',tsumogiri:true})).engine.action.pai,'9s');
  assert.throws(()=>situation([drop(0,'9p'),draw(1,'9s'),drop(1,'9s',{tsumogiri:true}),draw(2),{kind:'AnGangAddGang',seat:2,meldType:3,tile:'5p'}]));
});

test('actions acceptance: same-tile and edge-swap kuikae are rejected while unrelated tile passes', async () => {
  const hand = ['2m','3m','1m','4m',...basicHand.slice(4)];
  const c = situation([drop(0,'1m'),call(1,0,['1m','2m','3m'],[0,1,1])],hand);
  for (const pai of ['1m','4m']) await assert.rejects(infer(c,{type:'dahai',actor:1,pai,tsumogiri:false}));
  assert.equal((await infer(c,{type:'dahai',actor:1,pai:'6m',tsumogiri:false})).engine.action.pai,'6m');
});

test('actions acceptance: none is response-only and consumed history cannot be fabricated', async () => {
  const c = situation([drop(0,'2m')]);
  assert.equal((await infer(c,{type:'none'})).engine.action.type,'none');
  await assert.rejects(infer(situation(chiEvents),{type:'none'}));
  const invalid = situation(chiEvents);
  invalid.request.events.at(-1).consumed=['1m','4m'];
  let calls=0;
  await assert.rejects(Agent.run({...invalid,infer:async()=>{calls++;return {action:{type:'none'}};}}));
  assert.equal(calls,0);
});

test('actions acceptance: added kan replaces original pon and requires its own replacement draw', async () => {
  const hand = ['0p','5p',...basicHand.slice(2)];
  const actions = [drop(0,'5p'),call(1,1,['0p','5p','5p'],[1,0,1]),drop(1,'4m'),
    draw(2),drop(2,'8p'),draw(3),drop(3,'8p'),draw(0),drop(0,'8p'),draw(1,'5p'),
    {kind:'AnGangAddGang',seat:1,meldType:2,tile:'5p'}];
  const pending = situation(actions,hand);
  const before = situation(actions.slice(0,-1),hand);
  const response = {type:'kakan',actor:1,pai:'5p',consumed:['5pr','5p','5p']};
  assert.equal((await infer(before,response)).engine.action.type,'kakan');
  await assert.rejects(infer(before,{...response,consumed:['5p','5p','5p']}));
  assert.equal(pending.snapshot.game.players[1].melds.length,1);
  assert.equal(pending.snapshot.game.players[1].melds[0].type,2);
  await assert.rejects(infer(pending,{type:'dahai',actor:1,pai:'6m',tsumogiri:false}));
  const c = situation([...actions,draw(1,'9s',{doras:['7z','3z']})],hand);
  assert.equal((await infer(c,{type:'dahai',actor:1,pai:'9s',tsumogiri:true})).engine.action.pai,'9s');
});

test('actions acceptance: opponent non-five concealed kan resumes after replacement discard', async () => {
  const c = situation([drop(0,'9p'),draw(1,'9s'),drop(1,'9s',{tsumogiri:true}),draw(2),
    {kind:'AnGangAddGang',seat:2,meldType:3,tile:'8m'},draw(2,'?',{doras:['7z','4z']}),drop(2,'9p')]);
  assert.equal((await infer(c,{type:'none'})).engine.action.type,'none');
});

test('actions acceptance: observed opponent riichi ankan does not block subsequent own discard', async () => {
  const c = situation([drop(0,'9p'),draw(1,'9s'),drop(1,'9s',{tsumogiri:true}),draw(2),drop(2,'8p',{riichi:true}),
    draw(3,'?',{riichiSuccess:{seat:2,score:24000,sticks:1,failed:false}}),drop(3,'7p'),draw(0),drop(0,'7p'),
    draw(1,'9s'),drop(1,'9s',{tsumogiri:true}),draw(2),{kind:'AnGangAddGang',seat:2,meldType:3,tile:'8m'},
    draw(2,'?',{doras:['7z','5z']}),drop(2,'9p',{tsumogiri:true}),draw(3),drop(3,'6p'),draw(0),drop(0,'6p'),draw(1,'8s')]);
  assert.equal(c.snapshot.game.players[2].riichi,true);
  assert.equal((await infer(c,{type:'dahai',actor:1,pai:'8s',tsumogiri:true})).engine.action.pai,'8s');
});

const readyHand = ['1m','2m','3m','1p','2p','3p','1s','2s','3s','1z','1z','1z','2z'];
test('actions acceptance: tsumo and ron require current same-step client entitlement and winning shape', async () => {
  const tsumo = situation([drop(0,'9p'),draw(1,'2z',{operation:{seat:1,types:[8]}})],readyHand);
  assert.equal((await infer(tsumo,{type:'hora',actor:1,target:1,pai:'S'})).engine.action.type,'hora');
  const ron = situation([drop(0,'2z',{operation:{seat:1,types:[9]}})],readyHand);
  assert.equal((await infer(ron,{type:'hora',actor:1,target:0,pai:'S'})).engine.action.type,'hora');
  for (const edit of [c=>{delete c.snapshot.availableActions;},c=>{c.snapshot.availableActions.lastStep--;},c=>{c.snapshot.availableActions.types=[8];}]) {
    const c=structuredClone(ron); edit(c);
    await assert.rejects(infer(c,{type:'hora',actor:1,target:0,pai:'S'}));
  }
  await assert.rejects(infer(situation([drop(0,'2z',{operation:{seat:1,types:[9]}})]),{type:'hora',actor:1,target:0,pai:'S'}));
});

test('actions acceptance: absent win entitlement rejects no-yaku/furiten claims and expires on later events', async () => {
  const noEntitlement = situation([drop(0,'2z')],readyHand);
  await assert.rejects(infer(noEntitlement,{type:'hora',actor:1,target:0,pai:'S'}));
  const furiten = situation([drop(0,'9p'),draw(1,'2z'),drop(1,'2z',{tsumogiri:true}),draw(2),drop(2,'2z')],readyHand);
  await assert.rejects(infer(furiten,{type:'hora',actor:1,target:2,pai:'S'}));
  const contradictory = situation([drop(0,'9p'),draw(1,'2z'),drop(1,'2z',{tsumogiri:true}),draw(2),drop(2,'2z',{operation:{seat:1,types:[9]}})],readyHand);
  await assert.rejects(infer(contradictory,{type:'hora',actor:1,target:2,pai:'S'}));
  const twoWaits=['1m','2m','3m','1p','2p','3p','1z','1z','1z','2s','3s','5p','5p'];
  const otherWait = situation([drop(0,'9m'),draw(1,'1s'),drop(1,'1s',{tsumogiri:true}),draw(2),drop(2,'4s',{operation:{seat:1,types:[9]}})],twoWaits);
  await assert.rejects(infer(otherWait,{type:'hora',actor:1,target:2,pai:'4s'}));
  const expired = situation([drop(0,'2z',{operation:{seat:1,types:[9]}}),draw(1,'9s')],readyHand);
  assert.equal(expired.snapshot.availableActions,undefined);
  await assert.rejects(infer(expired,{type:'hora',actor:1,target:1,pai:'9s'}));
});
