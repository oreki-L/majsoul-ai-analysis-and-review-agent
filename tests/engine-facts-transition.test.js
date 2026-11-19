'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('../agent/eval.cjs'),{buildFactCard}=require('../extension/engine-facts.js');
const base=(h='123m123p123s111z2z9p')=>({...fixture(h),selfSeat:0,source:'replay',lastStep:20});
const action=(pai='9p',tsumogiri=false)=>({action:{type:'dahai',actor:0,pai,tsumogiri}});
const codes=xs=>xs.map(t=>t.code);
test('isolated set includes every singleton with neither canonical partner nor adjacent/gapped suit relation',()=>{
 const s=base('019m24p89s12355z'),before=structuredClone(s),c=buildFactCard(s,action('0m'));
 assert.deepEqual(codes(c.hand.shape.isolatedTiles),['0m','1m','9m','1z','2z','3z']);
 assert.deepEqual(codes(c.actionTransition.isolatedTiles.after),['1m','9m','1z','2z','3z']);
 assert.equal(c.actionTransition.discardedTile.name,'赤5万');assert.deepEqual(s,before);
});
test('red and ordinary five share shape partners while canonical triplets are not declared kans or unique decompositions',()=>{
 const s=base('05m888s1111z'),c=buildFactCard(s,action('0m'));
 assert.deepEqual(c.hand.shape.isolatedTiles,[]);
 assert.equal(c.hand.shape.sameTileGroups.find(g=>g.tile.code==='5m').shapeName,'对子形');
 assert.equal(c.hand.shape.sameTileGroups.find(g=>g.tile.code==='8s').shapeName,'刻子形');
 assert.equal(c.hand.shape.sameTileGroups.find(g=>g.tile.code==='1z').shapeName,'四张同种（未宣杠）');
 assert.deepEqual(codes(c.actionTransition.isolatedTiles.after),['5m']);
});
test('unknown or conflicting hand leaves isolated set and whole-hand count unknown',()=>{
 for(const hand of [['0m','?','2z'],['1m','1m','1m','1m','1m']]){
  const s=base();s.selfHand=hand;const c=buildFactCard(s,action(hand[0]));
  assert.equal(c.hand.shape,null);assert.equal(c.actionTransition.isolatedTiles.before,null);
  assert.equal(c.actionTransition.ownTileCount.before,null);
 }
});
test('local completion names distinguish 12/89 edges, 35 gaps and 45 two-sided shapes',()=>{
 const c=buildFactCard(base('124m3589p45s111z')),find=(a,b)=>c.hand.shape.incompleteSequenceCompletions.find(x=>x.tiles.join(',')===a+','+b);
 assert.equal(find('1m','2m').shapeName,'边张');assert.deepEqual(codes(find('1m','2m').waits.map(w=>w.tile)),['3m']);
 assert.equal(find('8p','9p').shapeName,'边张');assert.deepEqual(codes(find('8p','9p').waits.map(w=>w.tile)),['7p']);
 assert.equal(find('3p','5p').shapeName,'嵌张');assert.equal(find('4s','5s').shapeName,'两面');
});
test('all players receive explicit existing open and concealed meld labels without equating concealed kan to triplet',()=>{
 const s=base();s.game.players[0].melds=[{type:1,tiles:['8m','8m','8m'],froms:[0,0,1]}];
 s.game.players[1].melds=[{type:0,tiles:['4p','0p','6p'],froms:[0,1,1]}];
 s.game.players[2].melds=[{type:2,tiles:['2s','2s','2s','2s'],froms:[0,2,2,2]}];
 s.game.players[3].melds=[{type:3,tiles:['7z','7z','7z','7z'],froms:[]}];
 const c=buildFactCard(s,action());assert.equal(c.hand.melds[0].label,'明刻');assert.equal(c.hand.melds[0].visibility,'open');
 assert.deepEqual(c.situation.players.map(p=>p.melds[0].label),['明刻','明顺子','明杠','暗杠']);
 assert.equal(c.situation.players[1].melds[0].tiles[1],'赤5筒(0p)');
 assert.deepEqual(c.explanationFocus.situation,c.situation);
});
test('unknown or inconsistent meld types and shapes never invent named or yakuhai combinations',()=>{
 for(const m of [{type:99,tiles:['5z','5z','5z']},{type:0,tiles:['5z','5z','5z']},{type:3,tiles:['5z','5z','5z']},{type:1,tiles:['5z','?','5z']}]){
  const s=base();s.game.players[0].melds=[m];const c=buildFactCard(s);
  assert.equal(c.hand.melds[0].label,null);assert.equal(c.hand.melds[0].visibility,'unknown');assert.equal(c.hand.melds[0].status,'unavailable');
  assert.deepEqual(c.yakuhai.completedGroups.filter(g=>g.area==='meld'),[]);
 }
});
test('discard transition separates draw identity from hand-cut and maintains existing tenpai',()=>{
 const s=base();s.selfDrawnTile='2z';const c=buildFactCard(s,action());
 assert.equal(c.actionTransition.status,'available');assert.equal(c.actionTransition.discardMethod,'hand-tile');
 assert.equal(c.actionTransition.drawnTile.code,'2z');assert.equal(c.actionTransition.discardedTile.code,'9p');
 assert.deepEqual(c.actionTransition.shanten,{before:0,after:0,change:'unchanged'});
 assert.equal(c.actionTransition.ownTileCount.before,1);assert.equal(c.actionTransition.ownTileCount.after,0);
 assert.equal(c.actionTransition.meldsChangedByDiscard,false);assert.match(c.actionTransition.scope,/已含摸牌/);
 const drawn=buildFactCard({...s,selfDrawnTile:'9p'},action('9p',true));assert.equal(drawn.actionTransition.discardMethod,'drawn-tile');
});
test('red discard transition uses same-kind own count while preserving exact selected entity',()=>{
 const s=base('05m123p123s111z22z');s.selfDrawnTile='0m';const c=buildFactCard(s,action('0m',true));
 assert.equal(c.actionTransition.ownTileCount.before,2);assert.equal(c.actionTransition.ownTileCount.after,1);
 assert.equal(c.selectedAction.afterDiscard.exactCounts['0m'],undefined);assert.equal(c.selectedAction.afterDiscard.exactCounts['5m'],1);
});
test('transition never guesses unavailable efficiency, unspecified discard method, missing reach followup or a post-call hand',()=>{
 const s=base(),unavailable=buildFactCard(s,{action:{type:'dahai',pai:'9p'}},{efficiency:{status:'unavailable',candidates:[]},danger:{candidates:[]}});
 assert.deepEqual(unavailable.actionTransition.shanten,{before:null,after:null,change:'unknown'});assert.equal(unavailable.actionTransition.discardMethod,'unknown');
 for(const e of [{action:{type:'reach'}},{action:{type:'dahai',pai:'0p'}}]){
  const c=buildFactCard(s,e);assert.equal(c.actionTransition.status,'unavailable');assert.equal(c.actionTransition.shanten,undefined);
 }
 assert.equal(buildFactCard(s,{action:{type:'pon',pai:'2z',consumed:['2z','2z']}}).actionTransition.status,'not-applicable');
 const reach=buildFactCard(s,{action:{type:'reach'},followUp:action().action});assert.equal(reach.actionTransition.status,'available');
});
test('partial visibility retains shape tenpai but suppresses the total-ukeire ranking', () => {
 const s=base();
 s.rivers=s.rivers.filter(r=>r.seat===s.selfSeat);
 const c=buildFactCard(s,action()),comparison=c.explanationFocus.discard.efficiencyComparison;
 assert.equal(c.localAnalysis.visibleTiles.partial,true);
 assert.ok(comparison.tenpaiCount>0);
 assert.equal(comparison.sameShantenUnseen,null);
});

test('same-shanten ranking identifies unique, tied, lower and singleton cases and rejects incomplete candidates',()=>{
 const Analysis=require('../extension/mahjong-analysis.js'), s=base(), original=Analysis.analyze(s);
 const candidates=original.efficiency.candidates;
 function card(values, cut=false){
  const rows=candidates.map((r,i)=>({...r,shanten:values[i]?.[0]??1,totalUnseenUpperBound:values[i]?.[1]??1}));
  const efficiency={...original.efficiency,candidates:cut?rows.slice(1):rows};
  return buildFactCard(s,action(rows[0].tile),{...original,efficiency}).explanationFocus.discard.efficiencyComparison;
 }
 assert.ok(candidates.length>=3);
 assert.equal(card([[0,8],[0,7],[0,5]]).sameShantenUnseen.conclusion,'唯一最高');
 const tie=card([[0,8],[0,8],[0,5]]).sameShantenUnseen;
 assert.equal(tie.conclusion,'并列最高');assert.equal(tie.tiedWithOtherDiscards.length,1);
 assert.equal(card([[0,5],[0,8],[0,7]]).sameShantenUnseen.conclusion,'非最高');
 assert.equal(card([[0,5],[1,8],[1,7]]).sameShantenUnseen.conclusion,'该向听档只有这一项');
 assert.equal(card([[0,5]],true),null);
});
test('wind roles distinguish seat, round, both and guest winds',()=>{
 const s=base('123m123p123s1234z9p');s.game.round.wind=0;s.game.round.index=1;
 assert.equal(buildFactCard(s,action('1z')).explanationFocus.discard.tileFacts.windRole,'场风');
 assert.equal(buildFactCard(s,action('4z')).explanationFocus.discard.tileFacts.windRole,'自风');
 assert.equal(buildFactCard(s,action('2z')).explanationFocus.discard.tileFacts.windRole,'客风');
 s.game.round.index=0;
 assert.equal(buildFactCard(s,action('1z')).explanationFocus.discard.tileFacts.windRole,'自风兼场风');
});
