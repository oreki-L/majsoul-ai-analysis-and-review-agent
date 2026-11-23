'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFactCard } = require('../benchmark/mortal-teaching/released-v0168/engine-facts.js');
const { CANDIDATES, transformOptions } = require('../benchmark/teaching-optimization/candidates.cjs');
const { CURRENT, ENGINE, HISTORY } = require('../benchmark/mortal-teaching/retest-projection.cjs');
const Compact = require('../benchmark/mortal-teaching/compact-counts.cjs');
const tiles = text => text.match(/\d+[mpsz]/g).flatMap(g => [...g.slice(0,-1)].map(n => n + g.at(-1)));
function fixture(text='123m123p123s888s25z', action={type:'dahai',actor:1,pai:'5z'}) {
  const s={playerCount:4,selfSeat:1,lastStep:42,complete:true,selfHand:tiles(text),selfDrawnTile:'5z',game:{round:{wind:0,index:1},doras:['8p'],players:Array.from({length:4},(_,seat)=>({seat,melds:[],norths:0}))},rivers:Array.from({length:4},(_,seat)=>({seat,discards:[]}))};
  const engine={action,tileEncoding:'snapshot-v1'};
  const make=(question='')=>({systemPrompt:'frozen product prompt',validateFinal:()=>{},formatRepairMessage:'repair',tools:[{name:'compare_discards',execute:()=>{}}],messages:[{role:'user',content:HISTORY+JSON.stringify({policy:'H2-dedup+AdviceHistory-Extract',advice:[{position:20,decisionId:'old',question:'历史问题',decision:{action:'discard',tile:'1m',reasons:['错误旧理由']},engine:{action:{type:'dahai',actor:1,pai:'1m'},tileEncoding:'snapshot-v1'},explanation:{summary:'错误旧教学',reasons:['错误旧理由'],limitations:[]}}],importantEvents:[{position:12,kind:'DiscardTile',tile:'5z'}]})},{role:'user',content:CURRENT+JSON.stringify({snapshot:s,position:42,question})},{role:'user',content:ENGINE+JSON.stringify({engine,facts:buildFactCard(s,engine)})}]});
  return {s,engine,make};
}
const payload=out=>JSON.parse(out.messages.at(-1).content.slice(ENGINE.length));
test('new control exactly reproduces the prior compact transform; hooks, legal tools, current snapshot and engine remain intact',()=>{
  const {make}=fixture(),o=make(),before=JSON.stringify(o.messages);
  assert.deepEqual(transformOptions(o,'b-compact-control'),Compact.transformOptions(o));
  for(const c of CANDIDATES){const out=transformOptions(o,c.id);assert.equal(out.validateFinal,o.validateFinal);assert.equal(out.formatRepairMessage,o.formatRepairMessage);assert.equal(out.tools,o.tools);assert.deepEqual(payload(out).engine,payload(o).engine);assert.deepEqual(out.messages.at(-2),o.messages.at(-2));}
  assert.equal(JSON.stringify(o.messages),before);
});
test('focus preserves existing triplets at unseen zero; red five retains its exact identity and overlapping 35 link',()=>{
  const {s,make}=fixture('123p0p888s112225z',{type:'dahai',actor:1,pai:'0p'});
  s.selfDrawnTile='0p';s.rivers[0].discards=[{tile:'8s',called:false},{tile:'0p',called:false}];
  const out=transformOptions(make(),'s2-action-focus'),f=payload(out).facts;
  assert.deepEqual(f.handTileAvailability.rows.find(r=>r[0].endsWith('(8s)')),['8索(8s)',4,0]);
  assert.ok(f.explanationFocus.availableGroups.before.sameTileGroups.some(g=>g[0]==='8索(8s)'&&g[1]===3));
  assert.equal(f.explanationFocus.discard.tile,'赤5筒(0p)');
  assert.deepEqual(f.explanationFocus.discard.ownSameTile,[1,0]);
  assert.ok(f.explanationFocus.discard.localLinks.before.some(p=>p.join(',')==='3p,5p'));
  assert.ok(!f.explanationFocus.discard.localLinks.after.some(p=>p.includes('5p')));
  assert.ok(f.explanationFocus.availableGroups.before.sequences.some(p=>p.join(',')==='1p,2p,3p'));
});
test('positive river evidence stays bound to a named opponent; missing river evidence never becomes a safety verdict',()=>{
  const {s,make}=fixture();s.rivers[0].discards=[{tile:'5z',called:false}];
  const d=payload(transformOptions(make(),'s2-action-focus')).facts.explanationFocus.discard;
  assert.deepEqual(d.ownRiverSafeTo,[{seat:0,relativeName:'上家',riverIndices:[0]}]);
  assert.ok(!Object.hasOwn(d,'unsafeSeats'));assert.match(d.safetyScope,/不代表不安全/);
});
test('automatic isolation removes teaching and preserves actions, timing and captured events; explicit follow-up stays intact',()=>{
  const {make}=fixture(),o=make(),out=transformOptions(o,'s3-history-isolation');
  const old=JSON.parse(o.messages[0].content.slice(HISTORY.length)),h=JSON.parse(out.messages[0].content.slice(HISTORY.length));
  assert.deepEqual(h.importantEvents,old.importantEvents);assert.deepEqual(h.advice[0].engine,old.advice[0].engine);assert.equal(h.advice[0].position,20);
  assert.ok(!out.messages[0].content.includes('错误旧教学'));assert.ok(!out.messages[0].content.includes('错误旧理由'));
  const follow=make('你刚才为什么建议打1万？'),f=transformOptions(follow,'s3-history-isolation');
  assert.deepEqual(f.messages.slice(0,-2),follow.messages.slice(0,-2));
});
test('stale facts, altered engine actions, future history and duplicate projections fail closed',()=>{
  const {make}=fixture(),o=make();
  const stale=structuredClone(o.messages),p=JSON.parse(stale.at(-1).content.slice(ENGINE.length));p.facts.hand.concealedCount=99;stale.at(-1).content=ENGINE+JSON.stringify(p);
  assert.throws(()=>transformOptions({...o,messages:stale},'s2-action-focus'),/source facts mismatch/);
  assert.throws(()=>transformOptions(o,'unknown'),/unknown candidate/);
  assert.throws(()=>transformOptions(transformOptions(o,'s1-semantics'),'s1-semantics'),/source facts mismatch/);
  const future=structuredClone(o.messages),h=JSON.parse(future[0].content.slice(HISTORY.length));h.advice[0].position=43;future[0].content=HISTORY+JSON.stringify(h);
  assert.throws(()=>transformOptions({...o,messages:future},'s3-history-isolation'),/future history/);
  const actor=structuredClone(o.messages),e=JSON.parse(actor.at(-1).content.slice(ENGINE.length));e.engine.action.actor=2;actor.at(-1).content=ENGINE+JSON.stringify(e);
  assert.throws(()=>transformOptions({...o,messages:actor},'s1-semantics'),/binding mismatch/);
});
test('missing reach follow-up is not invented; unknown three-player wind stays unknown',()=>{
  const {s,make}=fixture('19m123p123s111z25z',{type:'reach',actor:1});s.playerCount=3;s.game.players.pop();s.rivers.pop();
  const f=payload(transformOptions(make(),'s2-action-focus')).facts.explanationFocus;
  assert.equal(f.round.selfWind,null);assert.equal(f.round.dealerSeat,null);assert.equal(f.discard,null);assert.equal(f.concealedSize[1],null);
});
test('unknown concealed tiles cannot produce invented shape evidence',()=>{
  const {s,make}=fixture();s.selfHand[0]='?';s.complete=false;
  const f=payload(transformOptions(make(),'s2-action-focus')).facts;
  assert.equal(f.handTileAvailability.status,'partial');assert.equal(f.explanationFocus.availableGroups.before,null);assert.equal(f.explanationFocus.discard.localLinks.before,null);assert.deepEqual(f.explanationFocus.discard.ownSameTile,[null,null]);
});
