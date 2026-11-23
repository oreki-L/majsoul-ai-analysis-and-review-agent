'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../extension/contracts/engine-explanation.js');
const Agent = require('../extension/agent.js');
const { fixture } = require('../agent/eval.cjs');

test('production prompt carries scoped fact semantics and preserves optional comparisons', () => {
  assert.equal(E.PROMPT_VERSION, 16);
  for (const requirement of [/facts\.explanationFocus/, /handTileAvailability按牌种/, /只有complete且已见4/,
    /全见不否定已有组合/, /单张也不等于孤张/, /先核对实体是否重叠/,
    /核对summary、reasons、limitations/, /从candidateEfficiency按括号内的精确牌码定位同一行/,
    /未见进张上界只在同向听档比较/, /本人弃过该牌与立直后通过是不同依据/, /只有该玩家确有riichi-passed/, /unknown不等于危险/,
    /summary和reasons都以facts.actionTransition.shantenWording为准/, /只有completionSupply为“所有补牌均已见尽”/,
    /tenpai.fixedYakuhaiSources/, /discard.removedKindWording/, /safetyByOpponent各自的wording/,
    /由你根据教学价值决定是否比较备选/, /历史建议与教学只用于承接/]) assert.match(E.prompt, requirement);
  assert.doesNotMatch(E.prompt, /自动分析的历史教学正文已移除|只保留历史动作和时点|至少比较一个实质备选/);
  assert.deepEqual(E.parse('{"summary":"打出这张牌。","reasons":[],"limitations":[]}'), {
    summary: '打出这张牌。', reasons: [], limitations: [], promptVersion: 16
  });
});

function snapshot() {
  const s = fixture('123m123p123s111z20p');
  s.source = 'live'; s.lastStep = 4; s.selfDrawnTile = '0p';
  return s;
}
const decision = () => ({ engine: { format: 'majsoul-engine-result-v1', phase: 'draw',
  action: { type: 'dahai', actor: 0, pai: '5pr', tsumogiri: true }, followUp: null, candidates: [] },
  provenance: { model: 'C', checkpoint: 'a'.repeat(64) } });
const parse = message => JSON.parse(message.content.slice(message.content.indexOf('{')));
async function capture(options = {}) {
  let sent;
  const s = options.snapshot || snapshot();
  const result = await Agent.run({ snapshot: s, engineDecision: decision(), contextPolicy: 'live-selective',
    sessionContext: { baseline: { snapshot: s, position: 0, origin: 'round-start' },
      checkpoint: { position: 4 }, lane: 'live', timeline: [], events: [] },
    ...options, transport: async () => { throw Error('No model network expected'); },
    runtime: { run: async request => { sent = request; return {
      text: JSON.stringify({ summary: '说明当前首选的依据。', reasons: [], limitations: [] }), turns: 1, toolCalls: 0
    }; } } });
  return { sent, result };
}

test('model projection converts every honor, red five and consumed tile without mutating stored actions or identity', () => {
  for (const [raw, expected] of [['E','1z'],['S','2z'],['W','3z'],['N','4z'],['P','5z'],['F','6z'],['C','7z'],
    ['5mr','0m'],['5pr','0p'],['5sr','0s'],['5p','5p']]) {
    const original = decision();
    original.engine.action = { type: 'pon', actor: 0, target: 1, pai: raw, consumed: [raw, raw] };
    original.engine.followUp = { type: 'dahai', actor: 0, pai: '5sr', tsumogiri: false };
    const before = structuredClone(original), projected = E.forModel(original);
    assert.equal(projected.engine.action.pai, expected);
    assert.deepEqual(projected.engine.action.consumed, [expected, expected]);
    assert.equal(projected.engine.followUp.pai, '0s');
    assert.equal(projected.provenance.model, 'C');
    assert.deepEqual(projected, E.forModel(projected));
    assert.deepEqual(original, before);
  }
  const reach = E.forModel({ format: 'majsoul-engine-result-v1', action: { type: 'reach', actor: 0 } });
  assert.equal(reach.followUp, undefined);
  assert.throws(() => E.forModel({ action: { type: 'dahai', pai: 'SECRET' } }), /牌编码/);
});

test('current engine action, snapshot and hand tool use the same exact red tile; session request retains the authoritative snapshot', async () => {
  const original = decision(), before = structuredClone(original);
  const { sent, result } = await capture({ engineDecision: original });
  const current = parse(sent.messages.at(-2)), engine = parse(sent.messages.at(-1));
  assert.ok(current.snapshot.selfHand.includes('0p'));
  assert.equal(current.snapshot.selfDrawnTile, '0p');
  assert.equal(engine.engine.action.pai, '0p');
  assert.equal(engine.engine.action.tsumogiri, true);
  const hand = JSON.parse((await sent.tools.find(t => t.name === 'get_self_hand').execute('hand', {})).content[0].text);
  assert.deepEqual(hand.hand, current.snapshot.selfHand);
  assert.equal(hand.drawnTile, engine.engine.action.pai);
  assert.equal(result.sessionTurn.request, sent.messages.at(-2).content);
  assert.equal(result.explanation.promptVersion, E.PROMPT_VERSION);
  assert.deepEqual(original, before);
});

test('hybrid live history retains previous teaching and normalized actions but excludes future advice without editing history', async () => {
  const s = snapshot();
  const answer = { decision: { action: 'unknown', tile: '0p', reasons: ['GENERIC_ENGINE_REASON'] }, limitations: [],
    engine: decision().engine, explanation: { status: 'completed', summary: 'PREVIOUS_TEACHING',
      reasons: ['PREVIOUS_REASON'], limitations: ['PREVIOUS_LIMIT'] } };
  const context = { baseline: { snapshot: s, position: 0, origin: 'round-start' }, checkpoint: { position: 4 }, lane: 'live', events: [],
    timeline: [{ type: 'exchange', automatic: true, id: 'prior', position: 1, answer: JSON.stringify(answer) },
      { type: 'exchange', automatic: true, id: 'future', position: 5, answer: JSON.stringify({ ...answer,
        explanation: { ...answer.explanation, summary: 'FUTURE_TEACHING' } }) }] };
  const before = structuredClone(context), { sent } = await capture({ sessionContext: context });
  const advice = parse(sent.messages[0]).advice;
  assert.equal(advice.length, 1);
  assert.equal(advice[0].engine.action.pai, '0p');
  assert.equal(advice[0].explanation.summary, 'PREVIOUS_TEACHING');
  assert.deepEqual(advice[0].explanation.reasons, ['PREVIOUS_REASON']);
  assert.deepEqual(advice[0].explanation.limitations, ['PREVIOUS_LIMIT']);
  assert.doesNotMatch(JSON.stringify(sent.messages), /FUTURE_TEACHING|"pai":"5pr"/);
  assert.deepEqual(context, before);
});

test('manual discussion normalizes structured historic actions and preserves the original teaching and follow-up question', async () => {
  const s = snapshot(), engine = decision().engine;
  engine.action.pai = 'C';
  const previous = { result: { decision: { action: 'unknown', tile: '7z', reasons: [] } }, engine,
    explanation: { status: 'completed', summary: 'ORIGINAL_TEACHING' } };
  const context = { baseline: { snapshot: s, position: 0 }, checkpoint: { position: 4 }, lane: 'manual-review', timeline: [
    { type: 'exchange', request: '已验证动作：' + JSON.stringify({ engine }), answer: JSON.stringify(previous) }] };
  const before = structuredClone(context), { sent } = await capture({ question: '这次为什么不保留赤五？', sessionContext: context });
  const old = JSON.parse(sent.messages.find(m => m.role === 'assistant').content[0].text);
  assert.equal(old.engine.action.pai, '7z');
  assert.equal(old.explanation.summary, 'ORIGINAL_TEACHING');
  assert.match(sent.messages.find(m => m.content?.startsWith('已验证动作：')).content, /"pai":"7z"/);
  assert.equal(parse(sent.messages.at(-2)).question, '这次为什么不保留赤五？');
  assert.deepEqual(context, before);
});

test('hybrid prompts never inherit pure LLM decision or mandatory-alternative instructions, regardless of requested policy', async () => {
  for (const contextPolicy of ['full', 'live-selective', 'live-ned', 'live-xf']) {
    const { sent } = await capture({ contextPolicy });
    assert.ok(sent.systemPrompt.startsWith(E.prompt));
    assert.doesNotMatch(sent.systemPrompt, /至少比较一个实质备选|使用efficiency理由或decision.reasons|输出JSON Schema/);
    assert.doesNotMatch(JSON.stringify(sent.messages), /phase3-compact-facts/);
  }
});

test('a useful summary without an alternative remains valid with one or multiple legal discards', async () => {
  for (const riichi of [false, true]) {
    const s = snapshot(); s.game.players[0].riichi = riichi;
    const { sent, result } = await capture({ snapshot: s });
    const legal = parse(sent.messages.at(-2)).outputConstraints.legalDiscards;
    assert.equal(legal.length === 1, riichi);
    assert.equal(result.explanation.summary, '说明当前首选的依据。');
    assert.deepEqual(result.explanation.reasons, []);
    assert.throws(() => E.parse(JSON.stringify({ summary: '改打另一张牌', reasons: [], limitations: [], tile: '5p' })), /合同/);
  }
});

test('bound R1 facts share the cleaned snapshot and engine action, keep tile names and scoped after-discard counts', async () => {
  const { sent } = await capture();
  const current = parse(sent.messages.at(-2)), engine = parse(sent.messages.at(-1));
  assert.equal(engine.facts.binding.position, current.snapshot.lastStep);
  assert.deepEqual(engine.facts.selectedAction.action, engine.engine.action);
  assert.equal(engine.facts.hand.concealedCount, current.snapshot.selfHand.length);
  assert.equal(engine.facts.selectedAction.afterDiscard.sameTileInOwnConcealedHand.exact, 0);
  assert.equal(engine.facts.tileLegend.find(t => t.code === '6z').name, '发');
  assert.equal(sent.validateFinal, E.parse);
});

test('required arrays cannot silently default and action overrides cannot be repaired into accepted teaching', () => {
  assert.throws(() => E.parse('{"summary":"理由","reasons":[]}'), e => e.canRepairOutput === true);
  assert.throws(() => E.parse('{"summary":"理由","reasons":[],"limitations":null}'), e => e.canRepairOutput === true);
  assert.throws(() => E.parse('{"summary":"理由","reasons":[],"limitations":[],"action":"dahai"}'), e => !e.canRepairOutput);
  const valid = { summary: '理由', reasons: [], limitations: [] };
  assert.throws(() => E.parse(JSON.stringify({ ...valid, reasons_note: null })), e => e.canRepairOutput === true);
  for (const extra of [{ reasons_note: null, action: 'dahai' }, { reasons_note: { tile: '1m' } }, { other_note: null }]) {
    assert.throws(() => E.parse(JSON.stringify({ ...valid, ...extra })), e => !e.canRepairOutput);
  }
});

test('hybrid facts respect task-specific calculation availability', async () => {
  for (const task of ['danger', 'efficiency']) {
    const { sent } = await capture({ task });
    const facts = parse(sent.messages.at(-1)).facts;
    if (task === 'danger') {
      assert.equal(facts.localAnalysis.status, 'unavailable');
      assert.equal(facts.selectedAction.afterDiscard.efficiency, null);
    } else assert.equal(facts.risk.candidates.length, 0);
  }
});

test('current facts override wrong historical round and candidate claims while advice stays identifiable as unexecuted',async()=>{
 const s=snapshot();s.selfSeat=1;s.game.round={wind:1,index:1};s.game.honba=2;
 s.game.turnProgress={status:'known',source:'events',bySeat:[5,4,5,5]};
 const answer={decision:{action:'unknown',tile:'0p',reasons:[]},engine:decision().engine,
  explanation:{status:'completed',summary:'南1局第2巡，各候选都相同。',reasons:[],limitations:[]}};
 const sessionContext={baseline:{snapshot:s,position:0},checkpoint:{position:4},lane:'live',events:[],timeline:[
  {type:'exchange',automatic:true,id:'old-advice',position:1,answer:JSON.stringify(answer)}]};
 const {sent}=await capture({snapshot:s,sessionContext});
 const history=parse(sent.messages[0]),payload=parse(sent.messages.at(-1)),current=payload.facts.currentContext;
 assert.equal(history.advice[0].currentFacts,false);assert.equal(history.advice[0].actionWasExecuted,null);
 assert.equal(history.advice[0].evidenceRole,'historical-model-advice');
 assert.equal(history.advice[0].explanation.summary,answer.explanation.summary);
 assert.equal(current.roundName,'南2局');assert.equal(current.selfWind,'东');assert.equal(current.selfTurn,4);
 assert.ok(payload.facts.candidateEfficiency.rows.length>0);
 assert.match(sent.systemPrompt,/历史文本可能有错/);assert.match(sent.systemPrompt,/不能当作已实际执行/);
 assert.match(sent.systemPrompt,/selfTurn为null或turnStatus为unknown/);assert.match(sent.systemPrompt,/按括号内的精确牌码定位同一行/);
 assert.match(sent.systemPrompt,/即使有多个合法候选，也不要求列出备选/);
});
