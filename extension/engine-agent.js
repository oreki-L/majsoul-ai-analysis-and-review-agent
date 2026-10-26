/* Bounded professional-engine workflow. Only sanitized DTOs cross the boundary. */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const H = node ? require('./harness.js') : root.MJHarness;
  const S = node ? require('./contracts/snapshot.js') : root.MJSnapshotContract;
  const R = node ? require('./contracts/engine-result.js') : root.MJEngineResult;
  const L = node ? require('./mahjong-analysis.js') : root.MJMahjongAnalysis;
  function validateSnapshot(snapshot, request) {
    if (!snapshot.complete || snapshot.phase !== 'playing' || snapshot.playerCount !== 4 ||
        !snapshot.selfHand?.length || snapshot.selfHand.some(t => !/^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(t)) ||
        snapshot.selfSeat !== request.seat || !snapshot.game) throw new Error('专业引擎需要完整四人对局、自家手牌和一致座位。');
    let localAnalysis = L.analyze(snapshot);
    if (localAnalysis.efficiency.status !== 'available') throw new Error('当前自家手牌无法通过本地合法性校验。');
    // Opponent concealed tiles are counts only; never inspect their identities.
    const start = request.events[1], scores = start.scores.slice(), doras = [R.fromMjai(start.dora_marker)];
    let sticks = start.kyotaku;
    const rivers = Array.from({ length: 4 }, (_, seat) => ({ seat, discards: [] }));
    const melds = Array.from({ length: 4 }, () => []), sizes = [13, 13, 13, 13];
    let hand = null, drawn = null, nextActor = start.oya, pendingDiscard = null, lastDiscardActor = null;
    let lastDiscard = null, replacement = null, kanCount = 0, drawCount = 0, forbidden = [], phase = 'waiting', trigger = null;
    const kanActors = new Set();
    const reached = new Set(), accepted = new Set();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), canon = L.canonical;
    const stop = message => { throw new Error(message); };
    const remove = pai => { const tile = R.fromMjai(pai), index = hand.indexOf(tile); if (index < 0) stop('引擎事件与自家手牌不一致。'); hand.splice(index, 1); };
    const kuikae = e => {
      const called = canon(R.fromMjai(e.pai)), blocked = [called];
      if (e.type === 'chi') {
        const values = [e.pai, ...e.consumed].map(t => canon(R.fromMjai(t))).sort();
        const low = +values[0][0], high = +values[2][0], n = +called[0], suit = called[1];
        if (n === low && high < 9) blocked.push((high + 1) + suit);
        if (n === high && low > 1) blocked.push((low - 1) + suit);
      }
      return blocked;
    };
    for (const event of request.events) {
      const actor = event.actor;
      if (['end_kyoku', 'end_game'].includes(event.type)) stop('不支持已结束的本局决策。');
      if (event.type === 'start_kyoku') { hand = event.tehais[request.seat].map(R.fromMjai); continue; }
      if (event.type === 'tsumo') {
        if (pendingDiscard !== null || actor !== (replacement ?? nextActor) || reached.size !== accepted.size) stop('引擎事件动作顺序或立直成立信息不连续。');
        pendingDiscard = actor; replacement = null; lastDiscard = null; lastDiscardActor = null;
        sizes[actor]++; drawCount++; forbidden = []; phase = 'draw'; trigger = event;
        if (actor === request.seat) { drawn = R.fromMjai(event.pai); hand.push(drawn); }
      } else if (event.type === 'reach') {
        if (actor !== pendingDiscard || phase !== 'draw' || reached.has(actor) || melds[actor].some(m => m.type !== 3) || scores[actor] < 1000) stop('立直事件顺序或门清状态无效。');
        reached.add(actor); phase = 'reach-discard'; trigger = event;
      } else if (event.type === 'reach_accepted') {
        if (!reached.has(actor) || accepted.has(actor) || lastDiscardActor !== actor || pendingDiscard !== null) stop('立直成立事件顺序无效。');
        accepted.add(actor); scores[actor] -= 1000; sticks++;
      } else if (event.type === 'dora') {
        if (doras.length >= 1 + kanCount || doras.length >= 5) stop('宝牌翻开缺少对应杠。');
        doras.push(R.fromMjai(event.dora_marker));
      } else if (event.type === 'dahai') {
        if (actor !== pendingDiscard || replacement !== null || (accepted.has(actor) && !event.tsumogiri) || (phase === 'post-call-discard' && event.tsumogiri) || forbidden.includes(canon(R.fromMjai(event.pai)))) stop('引擎事件缺少对应摸牌、违反立直或鸣后弃牌限制。');
        if (actor === request.seat) {
          if (event.tsumogiri && R.fromMjai(event.pai) !== drawn) stop('摸切事件与摸牌不一致。');
          if (!event.tsumogiri && R.fromMjai(event.pai) === drawn && hand.filter(t => t === drawn).length === 1) stop('手切标记与唯一摸牌不一致。');
          remove(event.pai); drawn = null;
          if (reached.has(actor) && !accepted.has(actor) && L.shanten(hand, melds[actor].length, 4, melds[actor].flatMap(m => m.tiles)) !== 0) stop('立直宣言弃牌后未听牌。');
        }
        sizes[actor]--; pendingDiscard = null; nextActor = (actor + 1) % 4; lastDiscardActor = actor;
        lastDiscard = event; forbidden = []; phase = 'response'; trigger = event;
        rivers[actor].discards.push({ tile: R.fromMjai(event.pai), tsumogiri: event.tsumogiri, riichi: reached.has(actor) && !accepted.has(actor), called: false });
      } else if (['chi', 'pon', 'daiminkan'].includes(event.type)) {
        if (pendingDiscard !== null || replacement !== null || !lastDiscard || lastDiscard.actor !== event.target || lastDiscard.pai !== event.pai || reached.has(actor) || reached.size !== accepted.size) stop('副露缺少对应弃牌、违反立直或动作顺序。');
        const consumed = event.consumed.map(R.fromMjai);
        if (actor === request.seat) { event.consumed.forEach(remove); drawn = null; }
        sizes[actor] -= consumed.length; rivers[event.target].discards.at(-1).called = true;
        melds[actor].push({ type: { chi: 0, pon: 1, daiminkan: 2 }[event.type], tiles: [...consumed, R.fromMjai(event.pai)], froms: [...consumed.map(() => actor), event.target] });
        lastDiscard = null; lastDiscardActor = null; trigger = event;
        if (event.type === 'daiminkan') { if (doras.length !== kanCount + 1) stop('前次杠宝牌信息缺失。'); replacement = actor; pendingDiscard = null; phase = 'kan-response'; kanCount++; kanActors.add(actor); }
        else { pendingDiscard = actor; forbidden = kuikae(event); phase = 'post-call-discard'; }
      } else if (['ankan', 'kakan'].includes(event.type)) {
        if (pendingDiscard !== actor || phase !== 'draw' || (reached.has(actor) && (actor === request.seat || event.type === 'kakan')) || doras.length !== kanCount + 1) stop('杠缺少当前摸牌、宝牌或自家立直后杠形无法验证。');
        if (event.type === 'ankan') {
          if (actor === request.seat) event.consumed.forEach(remove);
          sizes[actor] -= 4; melds[actor].push({ type: 3, tiles: event.consumed.map(R.fromMjai), froms: [] });
        } else {
          const old = melds[actor].find(m => m.type === 1 && m.tiles.every(t => canon(t) === canon(R.fromMjai(event.pai))));
          if (!old || !same([...old.tiles].sort(), event.consumed.map(R.fromMjai).sort())) stop('加杠缺少一致的原碰牌。');
          if (actor === request.seat) remove(event.pai);
          sizes[actor]--; old.type = 2; old.tiles.push(R.fromMjai(event.pai));
        }
        if (actor === request.seat) drawn = null;
        pendingDiscard = null; replacement = actor; lastDiscard = null; lastDiscardActor = null; forbidden = []; phase = 'kan-response'; trigger = event; kanCount++; kanActors.add(actor);
      }
      if (kanCount > 4 || melds.some(ms => ms.length > 4) || sizes.some((n, seat) => n !== 13 - 3 * melds[seat].length + Number(pendingDiscard === seat))) stop('副露后手牌数量或杠数量不合法。');
      if (kanCount === 4 && kanActors.size > 1) stop('多人四杠后的流局时序尚不支持。');
    }
    if (!Number.isInteger(snapshot.game.remaining) || snapshot.game.remaining < 0 || snapshot.game.remaining > 70 - drawCount) stop('当前剩余牌山与摸牌次数不一致。');
    if (!hand || JSON.stringify([...hand].sort()) !== JSON.stringify([...snapshot.selfHand].sort())) throw new Error('引擎事件与当前自家手牌不一致。');
    const normalizeMeld = m => ({ type: m.type, tiles: m.tiles.map((tile, i) => [tile, m.froms[i] ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
    if (snapshot.game.players.some(p => p.riichi === null || p.riichi !== reached.has(p.seat) || p.norths !== 0 || !same(p.melds.map(normalizeMeld), melds[p.seat].map(normalizeMeld)))) throw new Error('引擎事件与当前副露或立直状态不一致。');
    if (drawn !== snapshot.selfDrawnTile) throw new Error('引擎事件与当前摸牌不一致。');
    if (snapshot.game.round.wind !== ['E', 'S', 'W', 'N'].indexOf(start.bakaze) || snapshot.game.round.index !== start.kyoku - 1 ||
        snapshot.game.honba !== start.honba || snapshot.game.sticks !== sticks || !same(snapshot.game.scores, scores) || !same(snapshot.game.doras, doras)) {
      throw new Error('引擎事件与当前局数、点数或宝牌不一致。');
    }
    if (!Array.isArray(snapshot.rivers) || snapshot.rivers.length !== 4 || rivers.some(r => {
      const actual = snapshot.rivers.find(x => x.seat === r.seat);
      return !actual || !same(actual.discards, r.discards);
    })) throw new Error('引擎事件与当前公开有序牌河不一致。');
    if (phase === 'reach-discard' && trigger.actor === request.seat) localAnalysis = L.analyze({ ...snapshot, game: { ...snapshot.game, players: snapshot.game.players.map(p => p.seat === request.seat ? { ...p, riichi: false } : p) } });
    // Rule calculations stay in the agent; contracts consume verified DTO facts only.
    const ownMelds = melds[request.seat], ownMeldTiles = ownMelds.flatMap(m => m.tiles);
    const tsumo = phase === 'draw' && trigger.actor === request.seat;
    const ron = phase === 'response' && trigger.actor !== request.seat;
    const winningTile = tsumo ? drawn : ron ? R.fromMjai(trigger.pai) : null;
    const winningShape = !!winningTile && L.shanten(tsumo ? hand : [...hand, winningTile], ownMelds.length, 4, ownMeldTiles) === -1;
    const waits = [];
    if (ron) for (const suit of ['m', 'p', 's', 'z']) for (let n = 1; n <= (suit === 'z' ? 7 : 9); n++) {
      const t = n + suit;
      if (L.shanten([...hand, t], ownMelds.length, 4, ownMeldTiles) === -1) waits.push(t);
    }
    const discardFuriten = ron && rivers[request.seat].discards.some(d => waits.includes(canon(d.tile)));
    return { ...localAnalysis, engineContext: { phase, trigger, forbidden, replacement, kanCount, kanActors: [...kanActors], doras: doras.length, winningShape, discardFuriten } };
  }
  async function run({ snapshot, request, infer, signal, timeoutMs, onEvent }) {
    if (typeof infer !== 'function') throw new Error('缺少专业引擎传输。');
    const adapter = node ? require('./adapters/mjai.js') : root.MJMjaiAdapter;
    if (!adapter) throw new Error('专业引擎协议适配器未加载。');
    // Snapshot synchronously so edits during an asynchronous inference cannot change validation.
    const input = { snapshot: S.cleanSnapshot(snapshot), request: adapter.validateRequest(request) };
    const tools = {
      'request.validate': value => ({ ...value, localAnalysis: validateSnapshot(value.snapshot, value.request) }),
      'engine.infer': async (value, context) => {
        const payload = JSON.parse(JSON.stringify(value.request));
        return { ...value, response: await infer(payload, context) };
      },
      'engine.validate': value => ({ ...R.validateResult(value.response, value), localAnalysis: value.localAnalysis })
    };
    const { output, trace } = await H.run({ steps: ['request.validate', 'engine.infer', 'engine.validate'], tools, input, signal, timeoutMs, onEvent });
    return { ...output, trace };
  }
  const api = { run };
  if (node) module.exports = api;
  else root.MJEngineAgent = api;
})(globalThis);
