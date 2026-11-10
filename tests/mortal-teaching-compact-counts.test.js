'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFactCard } = require('../benchmark/mortal-teaching/released-v0168/engine-facts.js');
const Analysis = require('../extension/mahjong-analysis.js');
const { buildCompactCounts, transformOptions, PROMPT_SUFFIX } = require('../benchmark/mortal-teaching/compact-counts.cjs');
const { CURRENT, ENGINE } = require('../benchmark/mortal-teaching/retest-projection.cjs');
const tiles = text => text.match(/\d+[mpsz]/g).flatMap(g => [...g.slice(0,-1)].map(n=>n+g.at(-1)));
function fixture(hand='123m123p123s111z25z') {
  const snapshot = { playerCount:4,selfSeat:1,lastStep:42,complete:true,selfHand:tiles(hand),selfDrawnTile:'5z',game:{round:{wind:0,index:1},doras:['8p'],players:Array.from({length:4},(_,seat)=>({seat,melds:[],norths:0}))},rivers:Array.from({length:4},(_,seat)=>({seat,discards:[]})) };
  const engine={action:{type:'dahai',actor:1,pai:'2z'},tileEncoding:'snapshot-v1'};
  return {snapshot,engine};
}
const row=(table,code)=>table.rows.find(r=>r[0].endsWith('('+code+')'));
test('compact table distinguishes zero own copies after discard from one unseen copy; moving to river preserves global count',()=>{
  const {snapshot:s,engine}=fixture();s.rivers[0].discards=[{tile:'2z',called:false},{tile:'2z',called:false}];
  const facts=buildFactCard(s,engine),table=buildCompactCounts(s,facts);
  assert.equal(table.status,'complete');assert.deepEqual(row(table,'2z'),['南(2z)',3,1]);
  assert.equal(facts.selectedAction.afterDiscard.sameTileInOwnConcealedHand.canonical,0);
  const after=structuredClone(s);after.selfHand=after.selfHand.filter(t=>t!=='2z');after.rivers[1].discards.push({tile:'2z',called:false});
  assert.equal(Analysis.analyze(after).efficiency.visibleTiles.counts['2z'],row(table,'2z')[1]);
});
test('table groups red and ordinary fives and does not add the drawn tile twice',()=>{
  const {snapshot:s,engine}=fixture('123m123p123s055s22z');s.selfDrawnTile='0s';
  const table=buildCompactCounts(s,buildFactCard(s,engine));
  assert.equal(table.rows.filter(r=>r[0].endsWith('(5s)')).length,1);
  assert.deepEqual(row(table,'5s'),['5索(5s)',3,1]);assert.ok(!row(table,'0s'));
});
test('called discard is counted once, kan has four physical copies',()=>{
  const {snapshot:s,engine}=fixture('123m123p123s25z');
  s.game.players[0].melds=[{type:1,tiles:tiles('222z'),froms:[0,0,2]}];
  s.rivers[2].discards=[{tile:'2z',called:true}];
  let table=buildCompactCounts(s,buildFactCard(s,engine));
  assert.deepEqual(row(table,'2z'),['南(2z)',4,0]);
  s.game.players[0].melds=[{type:3,tiles:tiles('5555z'),froms:[]}];s.selfHand=s.selfHand.filter(t=>t!=='5z');s.selfDrawnTile=null;s.rivers[2].discards=[];
  const facts=buildFactCard(s,engine);assert.equal(facts.localAnalysis.visibleTiles.counts['5z'],4);
  assert.equal(buildCompactCounts(s,facts).status,'complete');
});
test('partial input carries its status; invalid or unavailable counts never become confident numbers',()=>{
  const {snapshot:s,engine}=fixture();s.complete=false;
  let facts=buildFactCard(s,engine);assert.equal(buildCompactCounts(s,facts).status,'partial');
  s.rivers[0].discards=Array.from({length:4},()=>({tile:'2z',called:false}));facts=buildFactCard(s,engine);
  let table=buildCompactCounts(s,facts);assert.equal(table.status,'invalid');assert.ok(table.rows.every(r=>r[1]===null&&r[2]===null));
  delete facts.localAnalysis.visibleTiles;table=buildCompactCounts(s,facts);assert.equal(table.status,'unavailable');assert.ok(table.rows.every(r=>r[2]===null));
});
test('three-player table excludes removed manzu and invalidates a hand containing them',()=>{
  const {snapshot:s,engine}=fixture('19m123p123s111z25z');s.playerCount=3;s.game.players.pop();s.rivers.pop();
  let table=buildCompactCounts(s,buildFactCard(s,engine));assert.equal(table.status,'complete');assert.ok(!table.rows.some(r=>/\([2-8]m\)/.test(r[0])));
  s.selfHand.push('2m');table=buildCompactCounts(s,buildFactCard(s,engine));assert.equal(table.status,'invalid');assert.ok(table.rows.every(r=>r[1]===null));
});
test('experimental projection preserves product repair hooks, action, history, tools and original input',()=>{
  const {snapshot,engine}=fixture();const facts=buildFactCard(snapshot,engine),validateFinal=()=>{},tools=[];
  const options={systemPrompt:'frozen product prompt',validateFinal,formatRepairMessage:'repair',tools,messages:[{role:'user',content:'history'},{role:'user',content:CURRENT+JSON.stringify({snapshot,position:42,question:''})},{role:'user',content:ENGINE+JSON.stringify({engine,facts})}]};
  const before=JSON.stringify(options.messages),out=transformOptions(options),payload=JSON.parse(out.messages.at(-1).content.slice(ENGINE.length));
  assert.equal(JSON.stringify(options.messages),before);assert.equal(out.validateFinal,validateFinal);assert.equal(out.formatRepairMessage,'repair');assert.equal(out.tools,tools);assert.deepEqual(out.messages.slice(0,-1),options.messages.slice(0,-1));assert.deepEqual(payload.engine,engine);assert.deepEqual(payload.facts.handTileAvailability.columns,['牌','已见','未见上界']);assert.equal(out.systemPrompt,options.systemPrompt+PROMPT_SUFFIX);assert.throws(()=>transformOptions(out),/already applied/);
  const bad={...options,messages:options.messages.slice()};bad.messages[1]={role:'user',content:CURRENT+JSON.stringify({snapshot,position:43})};assert.throws(()=>transformOptions(bad),/binding mismatch/);
  const stale=structuredClone(facts);stale.binding.position=41;assert.throws(()=>buildCompactCounts(snapshot,stale),/binding mismatch/);
});
