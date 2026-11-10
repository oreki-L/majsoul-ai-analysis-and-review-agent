'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildFactCard}=require('../extension/engine-facts.js');
const {fixture}=require('../agent/eval.cjs');
const base=(hand='123m123p123s55z789s')=>({...fixture(hand),selfSeat:0,source:'replay',lastStep:20,complete:true});
const engine=(pai='9s')=>({action:{type:'dahai',actor:0,pai,tsumogiri:false}});
const opponent=(card,tile,seat)=>card.risk.candidates.find(c=>c.tile===tile).opponents.find(o=>o.seat===seat);
function riichiFixture(){const s=base();s.game.players[1].riichi=true;s.rivers[1].discards=[{tile:'4m',riichi:true}];s.rivers[2].discards=[{tile:'9s',riichi:false}];return{s,events:[{kind:'DiscardTile',source:'replay',position:10,seat:1,tile:'4m',riichi:true},{kind:'DiscardTile',source:'replay',position:14,seat:2,tile:'9s'},{kind:'DealTile',source:'replay',position:15,seat:3}]};}
test('S2 production table remains three columns, red five shares canonical supply, and before/after scope stays separate',()=>{
 const s=base('123m123p123s05p89s'),prior=structuredClone(s),c=buildFactCard(s,engine('0p'));
 assert.deepEqual(c.handTileAvailability.columns,['牌','已见','未见上界']);
 const r=c.handTileAvailability.rows.find(r=>r[0]==='5筒(5p)');assert.ok(r);assert.equal(r[1],2);assert.equal(r[2],2);
 assert.equal(c.hand.exactCounts['0p'],1);assert.equal(c.selectedAction.afterDiscard.exactCounts['0p'],undefined);assert.equal(c.explanationFocus.discard.ownSameTile[1],1);
 assert.equal(c.explanationFocus.discard.method,'hand-tile');assert.deepEqual(s,prior);
});
test('89 completion reads 7, 12 reads 3, and overlapping 123 / 35 structures retain distinct completion counts',()=>{
 const s=base('1235p123m123s89s'),c=buildFactCard(s,engine('3p'));
 const completions=c.hand.shape.incompleteSequenceCompletions,waits=pair=>completions.find(p=>JSON.stringify(p.tiles)===JSON.stringify(pair)).waits;
 assert.deepEqual(waits(['8s','9s']).map(w=>w.tile.code),['7s']);assert.equal(waits(['8s','9s'])[0].unseenUpperBound,4);
 assert.deepEqual(waits(['1p','2p']).map(w=>w.tile.code),['3p']);assert.deepEqual(waits(['3p','5p']).map(w=>w.tile.code),['4p']);
 assert.ok(c.hand.shape.possibleSequences.some(p=>p.join(',')==='1p,2p,3p'));
 assert.ok(c.explanationFocus.discard.localLinks.before.some(p=>p.tiles.join(',')==='3p,5p'));
 assert.ok(!c.explanationFocus.discard.localLinks.after.some(p=>p.tiles.includes('3p')));
});
test('current action index binds its own efficiency and explicit hand/drawn method, never best candidate numbers',()=>{
 const s=base('112m357p567s12344z'),c=buildFactCard(s,engine('7p')),selected=c.localAnalysis.candidates.find(x=>x.tile==='7p');
 assert.deepEqual(c.explanationFocus.discard.efficiency,selected);assert.equal(c.explanationFocus.discard.efficiency.tile,'7p');
 assert.equal(buildFactCard(s,{action:{type:'reach'}}).explanationFocus.discard,null);
 assert.equal(buildFactCard(s,{action:{type:'dahai',pai:'7p'}}).selectedAction.discardMethod,'unknown');
});
test('riichi-passed requires declaration plus later action; evidence binds only the riichi opponent',()=>{
 const {s,events}=riichiFixture(),c=buildFactCard(s,engine(),undefined,{events});
 const o=opponent(c,'9s',1);assert.equal(o.genbutsu,false);assert.equal(o.safety.status,'confirmed');
 assert.deepEqual(o.safety.evidence,[{type:'riichi-passed',riichiPosition:10,discardPosition:14,discardedBy:2,passedAtPosition:15}]);
 assert.equal(opponent(c,'9s',3).safety.status,'unknown');assert.deepEqual(c.explanationFocus.situation.riichiSeats,[1]);
 assert.equal(c.explanationFocus.discard.safetyByOpponent.find(o=>o.seat===1).status,'confirmed');
});
test('pending discard, future evidence, source mismatch, failed declaration and terminal event cannot establish passed safety',()=>{
 for(const mode of ['pending','future','source','not-riichi','terminal','wrong-river','missing-declaration','conflicting','new-round']){
  const {s,events}=riichiFixture();
  if(mode==='pending')events.pop();if(mode==='future')events[2].position=21;if(mode==='source')events[2].source='live';
  if(mode==='not-riichi')s.game.players[1].riichi=false;if(mode==='terminal')events[2]={kind:'Hule',source:'replay',position:15,seat:1};
  if(mode==='wrong-river')s.rivers[2].discards=[];if(mode==='missing-declaration')s.rivers[1].discards[0].riichi=false;
  if(mode==='conflicting')events.push({...events[1],tile:'7s'});if(mode==='new-round')events.push({kind:'NewRound',source:'replay',position:12});
  assert.equal(opponent(buildFactCard(s,engine(),undefined,{events}),'9s',1).safety.status,'unknown',mode);
 }
});
test('same-kind red discard after riichi is evidence for normal five without changing exact chosen entity',()=>{
 const {s,events}=riichiFixture();s.selfHand=s.selfHand.map(t=>t==='9s'?'5p':t);s.rivers[2].discards=[{tile:'0p'}];events[1].tile='0p';
 const c=buildFactCard(s,engine('5p'),undefined,{events});assert.equal(opponent(c,'5p',1).safety.status,'confirmed');assert.equal(c.selectedAction.action.pai,'5p');
});
test('complete visible exclusion checks every sequence and kokushi, never turns full honor count alone into guaranteed safety',()=>{
 const s=base('123m123p123s15z89s');s.rivers[2].discards=[...Array(3)].map(()=>({tile:'1m',called:false})).concat([...Array(3)].map(()=>({tile:'2m',called:false})));
 let c=buildFactCard(s,engine('1m'));assert.equal(opponent(c,'1m',1).safety.status,'unknown'); // kokushi still possible
 s.rivers[3].discards=[...Array(3)].map(()=>({tile:'5z',called:false}));c=buildFactCard(s,engine('1m'));
 const evidence=opponent(c,'1m',1).safety.evidence.find(e=>e.type==='visible-exclusion');assert.ok(evidence);assert.equal(evidence.kokushi.excludedByFullyVisible,'5z');
 s.rivers[2].discards.pop();assert.equal(opponent(buildFactCard(s,engine('1m')),'1m',1).safety.status,'unknown'); // one sequence blocker missing
});
test('partial or conflicting counts do not support visibility exclusion or invented completion supply',()=>{
 const s=base();s.selfHand[0]='?';let c=buildFactCard(s,engine());assert.equal(c.handTileAvailability.status,'partial');assert.equal(c.hand.shape,null);
 s.selfHand[0]='1m';s.rivers[2].discards=Array.from({length:5},()=>({tile:'7s'}));c=buildFactCard(s,engine());
 assert.equal(c.handTileAvailability.status,'invalid');assert.ok(c.handTileAvailability.rows.every(r=>r[1]===null&&r[2]===null));
 assert.ok(c.hand.shape.incompleteSequenceCompletions.every(p=>p.waits.every(w=>w.unseenUpperBound===null)));
});
test('situation includes actual opponents meld counts, not only selected action owner',()=>{
 const s=base();s.game.players[2].melds=[{type:1,tiles:['7z','7z','7z'],froms:[2,2,1]}];
 const c=buildFactCard(s,engine());assert.equal(c.explanationFocus.situation.players.find(p=>p.seat===2).meldCount,1);
});



test('production Agent passes only authorized past events to facts and the risk tool shares the same typed evidence',async()=>{
 const Agent=require('../extension/agent.js'),{s,events}=riichiFixture();let request;
 const sessionContext={baseline:{snapshot:s,position:0,origin:'round-start'},checkpoint:{position:s.lastStep},lane:'live',timeline:[],events:[...events,{kind:'DiscardTile',source:'live',position:17,seat:3,tile:'9s'},{kind:'DiscardTile',source:'replay',position:25,seat:3,tile:'9s'}]};
 const result=await Agent.run({snapshot:s,engineDecision:{engine:{phase:'draw',...engine(),tileEncoding:'snapshot-v1'}},sessionContext,
  transport:async()=>{throw Error('No provider call expected');},runtime:{run:async options=>{request=options;return{text:'{"summary":"切9索，保留当前形状。","reasons":[],"limitations":[]}',turns:1,toolCalls:0};}}});
 assert.equal(result.explanation.summary,'切9索，保留当前形状。');
 const message=request.messages.at(-1).content,facts=JSON.parse(message.slice(message.indexOf('{'))).facts;
 assert.equal(opponent(facts,'9s',1).safety.status,'confirmed');
 const tool=request.tools.find(t=>t.name==='get_danger_evidence'),response=await tool.execute('test',{}),risk=JSON.parse(response.content[0].text);
 assert.deepEqual(risk,facts.risk);assert.deepEqual(opponent(facts,'9s',1).safety.evidence.map(e=>e.type),['riichi-passed']);
 assert.equal(facts.explanationFocus.discard.efficiency.tile,'9s');
});



test('post-riichi evidence rejects river order conflicts and accepts missing earlier observations',()=>{
 const {s,events}=riichiFixture();s.rivers[2].discards=[{tile:'9s'},{tile:'5p'}];
 const prior={kind:'DiscardTile',source:'replay',position:5,seat:2,tile:'5p'};
 assert.equal(opponent(buildFactCard(s,engine(),undefined,{events:[prior,...events]}),'9s',1).safety.status,'unknown');
 s.rivers[2].discards.reverse();
 assert.equal(opponent(buildFactCard(s,engine(),undefined,{events:[prior,...events]}),'9s',1).safety.status,'confirmed');
 assert.equal(opponent(buildFactCard(s,engine(),undefined,{events:[...events,{...events[1]}]}),'9s',1).safety.status,'confirmed');
});
test('middle-tile visibility excludes every sequence and honors require a separate kokushi blocker',()=>{
 const fixtureFor=blockers=>{
  const s=base('123m123p123s55z789s');s.selfHand[0]='5m';
  s.rivers[2].discards=Array.from({length:3},()=>({tile:'5m',called:false}));
  for(const tile of blockers){
   const inHand=s.selfHand.filter(t=>t===tile).length;
   s.rivers[3].discards.push(...Array.from({length:4-inHand},()=>({tile,called:false})));
  }
  return s;
 };
 assert.equal(opponent(buildFactCard(fixtureFor(['4m','6m']),engine('5m')),'5m',1).safety.status,'confirmed');
 for(const [unblocked,blockers] of [['345',['6m']],['456',['3m','7m']],['567',['4m']]]){
  assert.equal(opponent(buildFactCard(fixtureFor(blockers),engine('5m')),'5m',1).safety.status,'unknown',unblocked);
 }
 const h=base();h.rivers[2].discards=[{tile:'5z',called:false},{tile:'5z',called:false}];
 assert.equal(opponent(buildFactCard(h,engine('5z')),'5z',1).safety.status,'unknown');
 h.rivers[3].discards=Array.from({length:4},()=>({tile:'7z',called:false}));
 assert.equal(opponent(buildFactCard(h,engine('5z')),'5z',1).safety.status,'confirmed');
});
