'use strict';
// Offline, opt-in diagnostics. No transport, repair hook, quality gate or I/O.
const Core = require('./core.cjs');
const VERSION = 'answer-consistency/0.1';
const TILE = '[0-9][mps]|[1-7]z';
const T = '(' + TILE + ')';
const norm = t => t.replace(/^0/, '5');
const count = (hand, tile) => hand.filter(t => norm(t) === norm(tile)).length;
const exactCount = (hand, tile) => hand.filter(t => t === tile).length;
const afterDiscard = (hand, tile) => {
  if (!Array.isArray(hand) || !hand.includes(tile)) return null;
  const after = [...hand]; after.splice(after.indexOf(tile), 1); return after;
};

function passages(answer) {
  const out = [];
  const add = (reasons, pointer, inherited = {}) => {
    for (const [i,text] of (reasons || []).entries()) if (typeof text === 'string') out.push({text, pointer: pointer + '/' + i, ...inherited});
  };
  add(answer.decision?.reasons, '/decision/reasons');
  for (const [i,e] of (answer.efficiency || []).entries()) add(e.reasons, '/efficiency/' + i + '/reasons', {tile:e.tile});
  for (const [i,d] of (answer.danger || []).entries()) for (const [j,o] of (d.opponents || []).entries()) {
    add(o.reasons, `/danger/${i}/opponents/${j}/reasons`, {tile:d.tile, seat:o.seat});
  }
  // Limitations can describe uncertainty or counterexamples; not actionable prose.
  return out;
}

function inspect(context, answer) {
  const s = context?.snapshot;
  if (!s || !answer || typeof answer !== 'object') throw new Error('Snapshot and parsed answer required');
  if (context.factCatalog?.binding?.snapshotHash && context.factCatalog.binding.snapshotHash !== Core.stableHash(s)) throw new Error('Consistency snapshot binding mismatch');
  const local = context.prepared?.data?.localAnalysis || context.localAnalysis || {};
  const candidates = local.efficiency?.status === 'available' ? local.efficiency.candidates || [] : [];
  const assertions = [], findings = [], boundaryWarnings = [], spans = [];
  function record(p, quote, kind, actual, expected, details = {}) {
    const at = p.text.indexOf(quote);
    if (/可能|未必/.test(quote) || /可能|未必/.test(p.text.slice(Math.max(0,at-4),at))) return;
    const consistent = Core.canonicalStringify(actual) === Core.canonicalStringify(expected);
    const item = {kind, pointer:p.pointer, quote, actual, expected, consistent, ...details};
    assertions.push(item);
    if (!consistent) findings.push({...item, correctionEligible:false});
  }
  function seatFor(name) {
    if (!Number.isInteger(s.selfSeat) || s.playerCount !== 4) return null;
    return (s.selfSeat + ({下家:1,对家:2,上家:3}[name])) % 4;
  }
  const identityKnown = s.playerCount === 4 && Number.isInteger(s.selfSeat) && s.selfSeat >= 0 && s.selfSeat < 4 && Number.isInteger(s.game?.round?.index) && s.game.round.index >= 0 && s.game.round.index < 4 && Number.isInteger(s.game.round.wind) && s.game.round.wind >= 0 && s.game.round.wind < 4;
  const roundWind = identityKnown ? (s.game.round.wind + 1) + 'z' : null;
  const selfWind = identityKnown ? ((s.selfSeat - s.game.round.index + 4) % 4 + 1) + 'z' : null;
  const all = passages(answer);
  for (const p of all) {
    // Do not parse hypotheses, questions, quotations, negated examples or lists
    // with an unstated comparison universe. Deliberately prefer abstention.
    if (/[“”「」"？?]|如果|假设|若|不能|并非|不是说|不应|例如/.test(p.text)) { spans.push({pointer:p.pointer,status:'abstained'}); continue; }
    const n0 = assertions.length;
    if (identityKnown) {
      const re = /([1-7]z)(?:是|为)(?:自家[东南西北]风[、，]?)?(?:孤张|孤立|单张)?(客风|非役牌|场风|自风|三元牌|役牌)/g;
      for (const m of p.text.matchAll(re)) {
        const [quote,tile,role] = m, dragon = Number(tile[0]) >= 5, valueWind = tile === roundWind || tile === selfWind;
        const expected = role === '客风' || role === '非役牌' ? !dragon && !valueWind : role === '场风' ? tile === roundWind : role === '自风' ? tile === selfWind : role === '三元牌' ? dragon : dragon || valueWind;
        record(p,quote,'honor-identity',true,expected,{tile,role,roundWind,selfWind});
      }
    }
    const rank = p.text.match(/(?:进张|未见枚数)(?:上界)?(?:合计|为|只有)?\s*(\d+)枚[^。；;]*?(?:并列最高|最多)/);
    if (rank && !/低于|小于|少于|不及|逊于|落后|不超过/.test(rank[0]) && !/这几|这两|这三|三者|两者|其中|所列|上述|以下|这组|仅在/.test(p.text)) {
      // Only the efficiency row's explicit tile gives an unambiguous subject.
      const c = candidates.find(c => c.tile === p.tile);
      if (c) {
        const peers = candidates.filter(x => x.shanten === c.shanten), max = Math.max(...peers.map(x => x.totalUnseenUpperBound));
        record(p,rank[0],'ranking-maximum',Number(rank[1]),max,{tile:c.tile,shanten:c.shanten,scope:'all legal candidates at the same shanten',topTiles:peers.filter(x=>x.totalUnseenUpperBound===max).map(x=>x.tile)});
      }
    }
    for (const m of p.text.matchAll(new RegExp('(?:打|切)' + T + '([^。；;打切]{0,55}?)(?:拆掉|拆开)' + T + '对子','g'))) {
      const after = afterDiscard(s.selfHand,m[1]);
      if (after && !/不|未|没|无|避免/.test(m[2])) record(p,m[0],'pair-broken',true,count(s.selfHand,m[3])>=2 && count(after,m[3])<2,{discard:m[1],pairTile:m[3],remaining:count(after,m[3])});
    }
    for (const m of p.text.matchAll(new RegExp('(?:打|切)' + T + '[^。；;打切]{0,40}?放弃(?:自家)?([东南西北白发中])(?:风)?对子(?!可能|潜力)','g'))) {
      const pairTile = ('东南西北白发中'.indexOf(m[2])+1)+'z';
      if (s.selfHand && norm(m[1])===pairTile) record(p,m[0],'existing-honor-pair',true,count(s.selfHand,pairTile)>=2,{discard:m[1],pairTile,originalCount:count(s.selfHand,pairTile)});
    }
    for (const m of p.text.matchAll(new RegExp('(?:打|切)' + T + '((?:后)?(?:可|仍|会|能|也|继续)?)保留赤5([mps])','g'))) {
      const after = afterDiscard(s.selfHand,m[1]), red='0'+m[3];
      if (after && !/不|未|没|无|避免/.test(m[2])) record(p,m[0],'red-retained',true,exactCount(after,red)>0,{discard:m[1],redTile:red,remaining:exactCount(after,red)});
    }
    const onePair = p.text.match(new RegExp('保留另一张' + T + '作对子'));
    if (onePair && p.tile) {
      const after = afterDiscard(s.selfHand,p.tile);
      if (after) record(p,onePair[0],'post-discard-pair',true,count(after,onePair[1])>=2,{discard:p.tile,pairTile:onePair[1],remaining:count(after,onePair[1])});
    }
    for (const m of p.text.matchAll(new RegExp(T + '(?:与|和|、)' + T + '(?:的|构成|组成|作为)?(边张|两面|嵌张)?搭子','g'))) {
      if (/不是|并非|不构成|不能/.test(p.text.slice(Math.max(0,m.index-4),m.index))) continue;
      const a=norm(m[1]), b=norm(m[2]), gap=Math.abs(Number(a[0])-Number(b[0]));
      const lo=Math.min(Number(a[0]),Number(b[0]));
      const qualifies = m[3]==='边张' ? gap===1 && (lo===1 || lo===8) : m[3]==='两面' ? gap===1 && lo>=2 && lo<=7 : m[3]==='嵌张' ? gap===2 : gap>=1 && gap<=2;
      record(p,m[0],'taatsu-shape',true,a[1]===b[1] && a[1]!=='z' && qualifies,{tiles:[m[1],m[2]],shape:m[3]||'generic'});
    }
    const gen = new RegExp(T + '对(上家|下家|对家)(?:和(上家|下家|对家))?(?:都)?(不是|并非|是|为)现物','g');
    for (const m of p.text.matchAll(gen)) for (const name of [m[2],m[3]].filter(Boolean)) {
      const seat = seatFor(name), river=s.rivers?.find(r=>r.seat===seat);
      if (seat === null || !river) continue;
      record(p,m[0],'genbutsu-seat',m[4]==='是'||m[4]==='为',river.discards.some(d=>norm(d.tile)===norm(m[1])),{tile:m[1],seat,relative:name});
    }
    if (Number.isInteger(p.seat) && p.tile) {
      const river=s.rivers?.find(r=>r.seat===p.seat);
      const m=p.text.match(new RegExp('(?:^|[，。；])' + T + '(是|为|不是)现物'));
      if(m && m[1]===p.tile && river) record(p,m[0],'genbutsu-seat',m[2]!=='不是',river.discards.some(d=>norm(d.tile)===norm(p.tile)),{tile:p.tile,seat:p.seat});
    }
    if (/全场(?:无人立直[、，且并]*)?(?:无副露|没有副露)|无人立直[、，且并]+无副露/.test(p.text) && s.game?.players?.length===s.playerCount) {
      record(p,p.text,'meld-absence',0,s.game.players.reduce((n,x)=>n+(x.melds?.length||0),0));
    }
    // This is a boundary advisory, never evidence that a hand has no yaku.
    if (/和牌进张/.test(p.text)) boundaryWarnings.push({kind:'yaku-not-verified',pointer:p.pointer,quote:p.text,reason:'Local efficiency checks shape completion, not yaku, furiten or scoring.',correctionEligible:false});
    spans.push({pointer:p.pointer,status:assertions.length>n0?'partially-checked':'unparsed'});
  }
  return {version:VERSION,mode:'offline-diagnostic',qualityPass:null,naturalLanguageVerified:false,automaticCorrectionEnabled:false,
    findings,assertions,boundaryWarnings,coverage:{passages:all.length,checkedPassages:spans.filter(x=>x.status==='partially-checked').length,abstainedPassages:spans.filter(x=>x.status==='abstained').length,unparsedPassages:spans.filter(x=>x.status==='unparsed').length},
    limitations:['Narrow literal Chinese grammars only; unparsed prose is not verified.','Matching assertions do not certify strategy or overall quality.','No yaku engine, generated feedback, API call or automatic repair is provided.']};
}
module.exports={VERSION,inspect};
