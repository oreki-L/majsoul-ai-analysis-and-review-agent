/* Engine output is data, never renderer markup or a model-defined schema. */
(function (root) {
  'use strict';
  const canonical = tile => typeof tile === 'string' && /^0[mps]$/.test(tile) ? '5' + tile[1] : tile;
  const fail = () => { throw new Error('专业引擎结果无效或当前动作不受支持。'); };
  const fromMjai = value => {
    if (typeof value !== 'string') return null;
    if (/^[1-9][mps]$/.test(value)) return value;
    if (/^5[mps]r$/.test(value)) return '0' + value[1];
    return ({ E: '1z', S: '2z', W: '3z', N: '4z', P: '5z', F: '6z', C: '7z' })[value] || null;
  };
  // Bound traversal before serialization, including objects supplied directly by a local transport.
  function bounded(value, depth = 0, budget = { nodes: 0, chars: 0 }, seen = new Set()) {
    if (++budget.nodes > 16000 || depth > 12) fail();
    if (typeof value === 'number' && !Number.isFinite(value)) fail();
    if (typeof value === 'string') { budget.chars += value.length; if (budget.chars > 65536) fail(); }
    if (value && typeof value === 'object') {
      if (seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail();
      seen.add(value);
      const keys = Object.keys(value);
      if (keys.length > 4096) fail();
      for (const key of keys) { budget.chars += key.length; if (budget.chars > 65536) fail(); bounded(value[key], depth + 1, budget, seen); }
      seen.delete(value);
    } else if (!['undefined', 'boolean', 'number', 'string', 'object'].includes(typeof value)) fail();
  }
  function validateResult(raw, { snapshot, request, localAnalysis }) {
    bounded(raw);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.action || typeof raw.action !== 'object' || Array.isArray(raw.action)) fail();
    const a = raw.action, seat = snapshot.selfSeat, efficiency = localAnalysis.efficiency;
    if (raw.followUp != null && a.type !== 'reach') fail();
    for (const meta of [raw.meta, a.meta]) {
      if (meta?.q_values !== undefined && (!Array.isArray(meta.q_values) || meta.q_values.some(q => typeof q !== 'number' || !Number.isFinite(q)))) fail();
    }
    const context = localAnalysis.engineContext;
    const last = context.trigger;
    const own = snapshot.game?.players[seat];
    const turn = last?.actor === seat && ['draw', 'post-call-discard', 'reach-discard'].includes(context.phase);
    const legalDiscard = t => turn && efficiency.status === 'available' && efficiency.canDiscard === true &&
      snapshot.selfHand.includes(t) && !context.forbidden.includes(canonical(t)) && efficiency.candidates.some(c => c.tile === t);
    const reasons = [], limitations = ['引擎策略分值不是放铳概率；此结果仅供参考，不会自动执行动作。', '荣和/自摸需同一步 live 游戏操作资格；役与临时/立直振听依赖该事实，抢杠与立直后杠暂不支持。'];
    let tile = null, action, followUp = null;
    const discard = d => {
      const t = fromMjai(d?.pai);
      if (d?.type !== 'dahai' || d.actor !== seat || !t || !legalDiscard(t) || typeof d.tsumogiri !== 'boolean') fail();
      const currentDraw = context.phase === 'reach-discard' ? [...request.events].reverse().find(e => e.type === 'tsumo' && e.actor === seat) : last;
      if (d.tsumogiri && (currentDraw?.type !== 'tsumo' || fromMjai(currentDraw.pai) !== t || snapshot.selfDrawnTile !== t)) fail();
      if (!d.tsumogiri && t === snapshot.selfDrawnTile && snapshot.selfHand.filter(x => x === t).length === 1) fail();
      if (own.riichi === true && context.phase !== 'reach-discard' && (!d.tsumogiri || t !== snapshot.selfDrawnTile)) fail();
      return { type: 'dahai', actor: seat, pai: d.pai, tsumogiri: d.tsumogiri };
    };
    const have = ts => {
      const hand = snapshot.selfHand.slice();
      for (const t of ts) { const i = hand.indexOf(t); if (i < 0) fail(); hand.splice(i, 1); }
      return hand;
    };
    const canKan = () => own.riichi === false && snapshot.game.remaining > 0 && context.kanCount < 4 && context.doras === context.kanCount + 1 && (context.kanCount !== 3 || context.kanActors.every(actor => actor === seat));
    if (a.type === 'dahai') {
      action = discard(a); tile = fromMjai(a.pai);
      if (context.phase === 'reach-discard' && !efficiency.candidates.some(c => c.tile === tile && c.shanten === 0)) fail();
      reasons.push('专业引擎建议弃牌，已通过当前手牌与本地合法候选校验。');
    } else if (a.type === 'reach') {
      if (a.actor !== seat || !turn || last.type !== 'tsumo' || own.riichi !== false || own.melds.some(m => m.type !== 3) ||
          !(snapshot.game.scores[seat] >= 1000) || !(snapshot.game.remaining >= 4) ||
          !efficiency.candidates.some(c => c.shanten === 0 && legalDiscard(c.tile))) fail();
      action = { type: 'reach', actor: seat };
      if (raw.followUp !== undefined && raw.followUp !== null) {
        followUp = discard(raw.followUp); tile = fromMjai(followUp.pai);
        if (!efficiency.candidates.some(c => c.tile === tile && c.shanten === 0)) fail();
        reasons.push('专业引擎明确返回立直及配套弃牌，已验证门清、点数和弃牌听牌。');
      } else {
        reasons.push('专业引擎建议宣告立直；尚未返回可确定的立直弃牌，具体弃牌为空。');
        limitations.push('立直宣告与弃牌是两个动作，需用户确认具体弃牌。');
      }
    } else if (['chi', 'pon', 'daiminkan'].includes(a.type)) {
      if (a.actor !== seat || own.riichi !== false || context.phase !== 'response' || last?.type !== 'dahai' || last.actor === seat || a.target !== last.actor || a.pai !== last.pai || snapshot.game.remaining <= 0) fail();
      const count = a.type === 'daiminkan' ? 3 : 2;
      if (!Array.isArray(a.consumed) || a.consumed.length !== count) fail();
      const ts = a.consumed.map(fromMjai), called = fromMjai(a.pai);
      if (!called || ts.some(t => !t)) fail();
      const left = have(ts), all = [called, ...ts].map(canonical).sort(), blocked = [canonical(called)];
      if (a.type === 'chi') {
        if (a.target !== (seat + 3) % 4 || !all.every(t => /^[1-9][mps]$/.test(t) && t[1] === all[0][1]) || +all[1][0] !== +all[0][0] + 1 || +all[2][0] !== +all[1][0] + 1) fail();
        if (canonical(called) === all[0] && +all[2][0] < 9) blocked.push((+all[2][0] + 1) + all[0][1]);
        if (canonical(called) === all[2] && +all[0][0] > 1) blocked.push((+all[0][0] - 1) + all[0][1]);
      } else if (!all.every(t => t === all[0])) fail();
      if (a.type === 'daiminkan' ? !canKan() : !left.some(t => !blocked.includes(canonical(t)))) fail();
      action = { type: a.type, actor: seat, target: a.target, pai: a.pai, consumed: a.consumed.slice() };
      reasons.push('专业引擎建议鸣牌，已验证目标弃牌、实体手牌与鸣牌后弃牌限制。');
    } else if (['ankan', 'kakan'].includes(a.type)) {
      if (a.actor !== seat || context.phase !== 'draw' || last?.actor !== seat || !canKan() || !Array.isArray(a.consumed)) fail();
      const ts = a.consumed.map(fromMjai);
      if (ts.some(t => !t)) fail();
      if (a.type === 'ankan') {
        if (ts.length !== 4 || !ts.every(t => canonical(t) === canonical(ts[0]))) fail();
        have(ts); action = { type: 'ankan', actor: seat, consumed: a.consumed.slice() };
      } else {
        const added = fromMjai(a.pai), old = own.melds.find(m => m.type === 1 && m.tiles.every(t => canonical(t) === canonical(added)));
        if (!added || ts.length !== 3 || !old || JSON.stringify([...old.tiles].sort()) !== JSON.stringify([...ts].sort())) fail();
        have([added]); action = { type: 'kakan', actor: seat, pai: a.pai, consumed: a.consumed.slice() };
      }
      reasons.push('专业引擎建议杠牌，已核对实体牌、原副露和补牌阶段。');
      limitations.push('立直后杠的等待不变条件尚未实现，保守拒绝该特例。');
    } else if (a.type === 'hora') {
      const tsumo = context.phase === 'draw' && last?.actor === seat;
      const ron = context.phase === 'response' && last?.actor !== seat && last?.type === 'dahai';
      const facts = snapshot.availableActions;
      const allowed = snapshot.source === 'live' && facts?.seat === seat && Number.isInteger(snapshot.lastStep) && facts.lastStep === snapshot.lastStep && facts.types?.includes(tsumo ? 8 : 9);
      const winningTile = tsumo ? snapshot.selfDrawnTile : fromMjai(last?.pai);
      if (a.actor !== seat || (!tsumo && !ron) || a.target !== (tsumo ? seat : last.actor) || (a.pai !== undefined && fromMjai(a.pai) !== winningTile) || !allowed) fail();
      if (context.winningShape !== true || (ron && context.discardFuriten !== false)) fail();
      action = { type: 'hora', actor: seat, target: a.target, pai: last.pai };
      reasons.push('和牌形状已由本地验证，役与振听资格依据同一步游戏操作提示。');
    } else if (a.type === 'none') {
      if (a.actor !== undefined && a.actor !== seat) fail();
      if (!last || !['response', 'kan-response'].includes(context.phase) || !['dahai', 'kakan', 'ankan'].includes(last.type) || last.actor === seat) fail();
      action = { type: 'none', actor: seat };
      reasons.push('专业引擎建议跳过当前响应。');
    } else fail();
    // No implicit action-index mapping: different engines use different Q-vector layouts.
    if (a.meta?.q_values !== undefined || raw.meta?.q_values !== undefined) limitations.push('未提供可验证的动作索引映射，未展示 Q 值候选。');
    return {
      result: { task: 'combined', danger: [], efficiency: [], decision: { action: tile ? 'attack' : 'unknown', tile, reasons }, limitations },
      engine: { format: 'majsoul-engine-result-v1', phase: context.phase, action, followUp, candidates: [], limitations: limitations.slice() }
    };
  }
  const api = { validateResult, fromMjai };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MJEngineResult = api;
})(globalThis);
