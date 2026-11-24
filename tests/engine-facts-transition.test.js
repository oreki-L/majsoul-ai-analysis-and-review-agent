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
test('a two-sided local link is exhausted only when both completion kinds are fully seen',()=>{
 const s=base('123m123p6678s1112z');
 const fill=tile=>Array.from({length:4-s.selfHand.filter(t=>t===tile).length},()=>({tile,called:false}));
 s.rivers[1].discards=[...fill('8s'),...fill('9s')];
 const get=()=>buildFactCard(s,action('7s')).explanationFocus.discard.localLinks;
 const sample=links=>links.before.filter(p=>p.shapeName==='两面').map(p=>[p.tiles.join(','),p.waits.map(w=>[w.tile.code,w.unseenUpperBound]),p.completionSupply]);
 const positive='至少一种补牌的未见上界大于0', dead='所有补牌均已见尽';
 assert.deepEqual(sample(get()),[['6s,7s',[['5s',4],['8s',0]],positive],['7s,8s',[['6s',2],['9s',0]],positive]]);
 assert.deepEqual(get().after,[]);
 s.rivers[2].discards=fill('5s');
 assert.deepEqual(sample(get()),[['6s,7s',[['5s',0],['8s',0]],dead],['7s,8s',[['6s',2],['9s',0]],positive]]);
 s.rivers.pop();
 assert.ok(sample(get()).every(([, , supply])=>supply===null));
 s.rivers[2].discards.push({tile:'5s',called:false});
 assert.ok(sample(get()).every(([, waits,supply])=>supply===null && waits.every(([,limit])=>limit===null)));
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
 assert.equal(c.actionTransition.shantenWording,'弃牌后维持0向听（形状听牌）');
 const different=buildFactCard(s,action('1p')).actionTransition;
 assert.deepEqual(different.shanten,{before:0,after:1,change:'worsened'});
 assert.equal(different.shantenWording,'从弃前0向听（形状听牌）变为弃后1向听');
 assert.equal(c.actionTransition.ownTileCount.before,1);assert.equal(c.actionTransition.ownTileCount.after,0);
 assert.equal(c.actionTransition.meldsChangedByDiscard,false);assert.match(c.actionTransition.scope,/已含摸牌/);
 const drawn=buildFactCard({...s,selfDrawnTile:'9p'},action('9p',true));assert.equal(drawn.actionTransition.discardMethod,'drawn-tile');
});
test('red discard transition uses same-kind own count while preserving exact selected entity',()=>{
 const s=base('05m123p123s111z22z');s.selfDrawnTile='0m';const c=buildFactCard(s,action('0m',true));
 assert.equal(c.actionTransition.ownTileCount.before,2);assert.equal(c.actionTransition.ownTileCount.after,1);
 assert.equal(c.selectedAction.afterDiscard.exactCounts['0m'],undefined);assert.equal(c.selectedAction.afterDiscard.exactCounts['5m'],1);
 assert.equal(c.explanationFocus.discard.removedKindWording,null);
});

test('discarded red five cannot form an after-discard group and fixed dragon yaku comes from the meld',()=>{
 const s=base('0m3055p345s');
 s.game.players[0].melds=[{type:1,tiles:['7z','7z','7z'],froms:[0,0,1]},{type:1,tiles:['8p','8p','8p'],froms:[0,0,1]}];
 const d=buildFactCard(s,action('0m',true)).explanationFocus.discard;
 assert.match(d.removedKindWording,/弃后暗手已无5万/);
 assert.deepEqual(d.tenpai.shapeWaits.map(([tile])=>tile),['3筒(3p)','4筒(4p)']);
 assert.deepEqual(d.fixedYakuhaiSources,['明刻「中」提供役牌（三元牌），与补牌或雀头无关']);
 s.game.players[0].melds[0]={type:3,tiles:['7z','7z','7z','7z'],froms:[]};
 assert.match(buildFactCard(s,action('0m',true)).explanationFocus.discard.fixedYakuhaiSources[0],/^暗杠「中」/);
 assert.equal(buildFactCard(base('123m123p123s55z789p'),action('9p')).explanationFocus.discard.fixedYakuhaiSources.length,0);
});
test('transition never guesses unavailable efficiency, unspecified discard method, missing reach followup or a post-call hand',()=>{
 const s=base(),unavailable=buildFactCard(s,{action:{type:'dahai',pai:'9p'}},{efficiency:{status:'unavailable',candidates:[]},danger:{candidates:[]}});
 assert.deepEqual(unavailable.actionTransition.shanten,{before:null,after:null,change:'unknown'});assert.equal(unavailable.actionTransition.discardMethod,'unknown');
 assert.equal(unavailable.actionTransition.shantenWording,null);
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
 const below = card([[0,5],[0,8],[0,8],[1,10]]).sameShantenUnseen;
 const labels = candidates.slice(1,3).map(r => require('../extension/contracts/snapshot.js').label(r.tile));
 assert.equal(below.conclusion,'非最高');
 assert.ok(below.wording.endsWith(`同档切${labels.join('、')}为最高8枚`));
 assert.ok(tie.wording.includes(`与切${labels[0]}并列0向听档最高`));
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

test('tenpai evidence binds shape waits and a known yaku to the exact discard', () => {
 const s=base('135m789s22z');
 s.game.players[0].melds=[{type:0,tiles:['1p','2p','3p'],froms:[3,0,0]},{type:0,tiles:['1s','2s','3s'],froms:[3,0,0]}];
 const selected=buildFactCard(s,action('5m')).explanationFocus.discard.tenpai;
 assert.deepEqual(selected.shapeWaits.map(([tile])=>tile),['2万(2m)']);
 assert.deepEqual(selected.knownYakuByDiscard,[{discard:'5万(5m)',waits:[['2万(2m)',['三色同顺']]]}]);
 const alternative=buildFactCard(s,action('1m')).explanationFocus.discard.tenpai;
 assert.deepEqual(alternative.shapeWaits.map(([tile])=>tile),['4万(4m)']);
 assert.deepEqual(alternative.knownYakuByDiscard,selected.knownYakuByDiscard);
 s.game.players[0].melds[1].type=99;
 const unknown=buildFactCard(s,action('5m')).explanationFocus.discard.tenpai;
 assert.deepEqual(unknown.shapeWaits,selected.shapeWaits);
 assert.deepEqual(unknown.knownYakuByDiscard,[]);
});

test('a fully visible wait remains a shape wait but contributes no yaku-positive available copy', () => {
 const s=base();
 s.rivers[1].discards=['2z','2z','2z'].map(tile=>({tile,called:false}));
 const tenpai=buildFactCard(s,action()).explanationFocus.discard.tenpai;
 assert.deepEqual(tenpai.shapeWaits,[['南(2z)',0]]);
 assert.equal(tenpai.knownYakuByDiscard.some(r=>r.discard==='9筒(9p)'),false);
});
