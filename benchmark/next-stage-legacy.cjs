'use strict';
const Core = require('./core.cjs');
const Campaign = require('./campaign-policies.cjs');
const Production = require('./production-v010.cjs');
const Frozen = require('./next-stage-legacy-frozen.cjs');
const Current = require('./context.cjs');
const Snapshot = require('../extension/contracts/snapshot.js');
const ROOT = null; // No research path or runtime loader: public static dependencies only.
const VERSION = 'realtime-quality-preparation/1';
const POLICIES = Object.freeze({ B0:'H4', B1:'H5', B2:'H2-dedup', B3:'AdviceHistory-Extract', B4:'SnapshotHistory-Extract', B5:'M', B6:'SnapshotHistory-Truncate', B7:'SnapshotHistory-Extract', B8:'SnapshotHistory-Truncate', D0:'D', D1:'D', A0:'AdviceHistory-Truncate', A1:'AdviceHistory-Extract', A2:'AdviceHistory-Truncate', P0:'H4', N0:'H4', NE:'H4', ND:'H4', NED:'H4', NF:'H4', 'SA-K':'H4', 'SS4-K':'H4' });
const P1 = `你为玩家分析本次冻结的日式立直麻将决策。当前状态与同stateId的本地计算是事实来源；旧建议只是当时意见，不能证明当前手牌、牌河或数值。编码、座位、局名使用本次导航映射，不自行换算缺失身份。
本次已附且状态匹配的计算可直接使用，无须重复查询；缺项、字段含义不清或证据不足时使用对应工具。不要凭记忆重算向听、进张枚数或宝牌。所有比较要说明对象和范围，并保留并列。
给出一个合法首选，解释当前攻守选择、主要风险对象及效率取舍；再比较至少一个真正有区别的合法备选。没有安全比较依据时明确未知，不把无证据当作安全或确定高危。不要为策略标签补造理由，不推测对手暗牌或牌山。
仅陈述与本次选择有关且可支持的事实。说明保留的牌形时先核对手中计数；无法确认的手牌分解、役种和打点不要断言。输出前核对首选牌、目标seat、数值口径和理由一致。最终输出规定JSON，不展示内部思维过程。`;
const oldIds = new Set(['B0','B1','B2','B3','B4','B5','B6','B7','B8','D0','D1','A0']);
const parse = text => { const i=text.indexOf('\n'); return {prefix:text.slice(0,i+1), data:JSON.parse(text.slice(i+1))}; };
const serialize = p => p.prefix+JSON.stringify(p.data);
const message = (title,data) => ({role:'user',content:title+'（有来源历史资料；旧意见不是当前事实）：\n'+JSON.stringify(data)});
function binding(node) { return {stateId:node.id,decisionId:node.id,eventPosition:node.position,snapshotHash:Core.stableHash(node.snapshot),authorizationRevision:Core.stableHash(node.authorization)}; }
function navigation(node) {
  const s=node.snapshot, g=s.game, round=g?.round, dealer=Number.isInteger(round?.index)&&round.index>=0&&round.index<4?round.index:null;
  const counts={}; for(const t of s.selfHand??[]) counts[t]=(counts[t]??0)+1;
  const canonical=t=>/^0[mps]$/.test(t)?'5'+t[1]:t, shapeCounts={}; for(const t of s.selfHand??[]) shapeCounts[canonical(t)]=(shapeCounts[canonical(t)]??0)+1;
  const wind=dealer===null?null:(s.selfSeat-dealer+4)%4;
  return {...binding(node), selfSeat:s.selfSeat,dealerSeat:dealer,identityRule:'four-player snapshot.round.index is dealer seat; extension/state.js seatWind convention',round:round??null,honba:g?.honba??null,selfWind:wind===null?'unknown':['东','南','西','北'][wind],roundWind:Number.isInteger(round?.wind)?['东','南','西','北'][round.wind]??'unknown':'unknown',
    seats:Array.from({length:4},(_,seat)=>({seat,relative:seat===s.selfSeat?'自家':((seat-s.selfSeat+4)%4===1?'下家':(seat-s.selfSeat+4)%4===2?'对家':'上家'),score:g?.scores?.[seat]??null,differenceFromSelf:g?.scores?g.scores[s.selfSeat]-g.scores[seat]:null})),selfRank:g?.scores?1+g.scores.filter(v=>v>g.scores[s.selfSeat]).length:null,
    hand:{raw:s.selfHand??null,rawCounts:counts,shapeCounts,drawnTile:s.selfDrawnTile??null,drawnAlreadyInHand:s.selfDrawnTile?(s.selfHand??[]).includes(s.selfDrawnTile):null,pairs:Object.keys(shapeCounts).filter(t=>shapeCounts[t]>=2),pairMeaning:'count >= 2; not optimal decomposition'},
    honors:Array.from({length:7},(_,i)=>({tile:(i+1)+'z',name:['东','南','西','北','白','发','中'][i],kind:i<4?'wind':'dragon',roundWind:i<4&&round?.wind===i,selfWind:i<4&&wind===i})),
    doraIndicators:g?.doras??null,actualDoras:(g?.doras??[]).map(raw=>{const t=canonical(raw);if(!/^[1-9][mpsz]$/.test(t))return null;const n=+t[0],suit=t[1];return (suit==='z'?(n<=4?n%4+1:(n-5+1)%3+5):n%9+1)+suit;}),doraRule:'standard four-player indicator cycle; red identity preserved in raw hand',
    decisionContext:node.decisionContext,discardConstraints:node.discardConstraints??null,legalActions:node.legalActions};
}
// Flatten scalar facts, then intern repeated (typed path,value) pairs across every
// collected state. No complete first/recent snapshot is embedded or renamed.
function compactAllFacts(node,source) {
  const entries=[{...source.baseline,origin:'baseline'},...(source.states??[]).map(s=>({...s,origin:s.origin??'collected-state'}))].filter(s=>s.position<node.position).sort((a,b)=>a.position-b.position).map(s=>({...s,snapshot:Snapshot.cleanSnapshot(s.snapshot)}));
  const dictionary=[], ids=new Map(), states=[];
  function leaves(value,at=[],out=[]) { if(value&&typeof value==='object'&&Object.keys(value).length) for(const k of Object.keys(value)) leaves(value[k],[...at,Array.isArray(value)?+k:k],out); else out.push({path:at,value}); return out; }
  for(const entry of entries) {
    if(Core.stableHash(Core.authorizationFor(entry.snapshot))!==Core.stableHash(node.authorization)) throw Error('Historical state authorization mismatch');
    const refs=leaves(entry.snapshot).map(f=>{const key=Core.canonicalStringify(f);if(!ids.has(key)){ids.set(key,dictionary.length);dictionary.push(f);}return ids.get(key);});
    states.push({position:entry.position,origin:entry.origin,snapshotHash:Core.stableHash(entry.snapshot),factRefs:refs});
  }
  const all=Production.authorizedEvents(node.snapshot,source.events??[],node.position),threats=new Set(node.snapshot.game?.players.filter(p=>p.riichi||p.melds.length).map(p=>p.seat)??[]);
  const eventRefs=all.filter(e=>['NewRound','ChiPengGang','AnGangAddGang','BaBei'].includes(e.kind)||e.riichi||threats.has(e.seat));
  return {format:'typed-field-intern-v1',meaning:'Historical authorized scalar fields; reference sets preserve every source field and explicit empty/null values. Never current authority.',fieldDictionary:dictionary,states,necessaryEvents:eventRefs,audit:{sourceStateCount:entries.length,sourceSnapshotHashes:entries.map(e=>Core.stableHash(e.snapshot)),allAuthorizedEvents:all.map(e=>({position:e.position,hash:Core.stableHash(e),retention:eventRefs.includes(e)?'necessary-event':'covered-by-observed-states-or-ordinary-event-omitted'})),sourceBytes:Buffer.byteLength(JSON.stringify(entries))}};
}
function build(input,source) {
  const id=input.scheme.id, policy=POLICIES[id]; if(!policy)throw Error('Unknown phase-one ID');
  if(input.channel&&input.channel!=='realtime')throw Error('Followup/global disabled');
  const node=input.node; if(node.snapshot.playerCount!==4||node.snapshot.rivers?.length!==4)throw Error('Complete four-player current rivers required');
  if(node.snapshot.lastStep!==node.position||Core.stableHash(Core.authorizationFor(node.snapshot))!==Core.stableHash(node.authorization))throw Error('Current state binding mismatch');
  const history=(input.history??[]).filter(e=>e.roundId===node.roundId&&e.sessionId===node.sessionId&&e.position<node.position&&Core.stableHash(e.authorization)===Core.stableHash(node.authorization));
  // Rebuild exclusively from the explicit frozen state contract, never from labels.
  const safe={scheme:{id,context:{current:'full',events:'all'}},node,events:input.events??[],history:[],channel:'realtime'};
  const base=(oldIds.has(id)?Frozen:Current).buildContext(safe), prepared=base.prepared;
  let selected=history;
  if(id==='D1') selected=history.map(e=>{const p=parse(e.request);delete p.data.snapshot; if(p.data.incremental)p.data.incremental.factAuthority='baseline plus ordered authorized events; tools provide current frozen facts';return {...e,request:Production.messagesFor(prepared,e.snapshot,{checkpoint:{position:e.position}},p.data.question??'').at(-1).content.split('\n')[0]+'\n'+JSON.stringify(p.data)};});
  const result=Campaign.buildCampaignContext({...input,history:selected,prepared,channel:'realtime',options:{version:Campaign.VERSION,policy,recent:4,trigger:1,extractLimit:4}},source);
  if(id==='B7'||id==='B8') {const baseline=result.messages.find(m=>m.content.startsWith('本小局已授权初始基线'));if(!baseline)throw Error('Missing fixed baseline');const p=parse(baseline.content);if(!p.data.initialSnapshot)throw Error('Baseline contract changed');delete p.data.initialSnapshot;baseline.content=serialize(p);}
  if(id==='D1') {const last=result.messages.at(-1),p=parse(last.content);p.data.snapshot=node.snapshot;p.data.incremental.factAuthority='current snapshot is authoritative; baseline/events are historical';last.content=serialize(p);}
  if(!oldIds.has(id)) {
    result.messages[0].content=P1+(id==='NF'?'\n聚焦输出：主建议、一个有实质区别的合法备选、主要风险对象与必要限制；沿用所有字段，不堆砌无关逐牌风险。':'')+'\n'+Current.ANALYSIS_JSON_CONTRACT+'\n输出JSON Schema：\n'+JSON.stringify(prepared.responseSchema);
    if(id!=='P0') result.messages.splice(-1,0,message('当前语义导航',navigation(node)));
    if(['NE','NED'].includes(id)) {const efficiency=structuredClone(prepared.data.localAnalysis.efficiency);efficiency.candidates?.sort((a,b)=>a.tile.localeCompare(b.tile));result.messages.splice(-1,0,message('当前效率证据',{...binding(node),algorithm:'extension/mahjong-analysis.js',efficiency}));}
    if(['ND','NED'].includes(id)) {const danger=structuredClone(prepared.data.localAnalysis.danger);if(danger?.candidates)danger.candidates=danger.candidates.filter(c=>node.legalActions.some(a=>a.tile===c.tile)).sort((a,b)=>a.tile.localeCompare(b.tile)).map(c=>({...c,opponents:c.opponents.map(o=>({...o,riichi:node.snapshot.game?.players[o.seat]?.riichi??null,melds:node.snapshot.game?.players[o.seat]?.melds??null,genbutsuSources:node.snapshot.rivers.find(r=>r.seat===o.seat)?.discards.flatMap((d,riverIndex)=>(d.tile.replace(/^0/,'5')===c.tile.replace(/^0/,'5')?[{riverIndex,tile:d.tile}]:[]))??[],evidenceAbsence:{genbutsu:!o.genbutsu,suji:!o.sujiReferences?.length,kabe:!o.kabeReferences?.length}}))}));result.messages.splice(-1,0,message('当前风险证据',{...binding(node),danger,limitation:'genbutsu limited to corresponding opponent; suji/kabe are not safety probabilities'}));}
    if(id==='SA-K'||id==='SS4-K') {
      const facts=compactAllFacts(node,source),factMsg=message('全部旧局面类型化事实',facts);
      // H4 already supplied important events; the compact record carries the
      // same important set plus threat-related ordering, so avoid retransmission.
      result.messages=result.messages.filter(m=>!m.content.startsWith('已授权历史事件'));
      result.messages.splice(-1,0,factMsg);
      if(history.length)result.messages.splice(-1,0,message('独立旧意见',id==='SA-K'?Campaign.codeAdvice(history):history.slice(-4).map(Campaign.coreAdvice)));
      result.compression.factCoverage=facts.audit;result.compression.factCompressedBytes=Buffer.byteLength(JSON.stringify(facts));result.compression.adviceSourceIds=(id==='SA-K'?history:history.slice(-4)).map(e=>e.decisionId);
    }
  }
  return {...base,...result,prepared,snapshot:node.snapshot,events:base.events,historyPolicy:{...result.historyPolicy,experimentVersion:VERSION,experimentId:id,promptBaseline:oldIds.has(id)?'frozen-v0.10.0-plus-common-json-contract':'P1'},compression:{...result.compression,experimentId:id}};
}
module.exports={version:1,VERSION,POLICIES,P1,build,navigation,compactAllFacts,parse,ROOT};
