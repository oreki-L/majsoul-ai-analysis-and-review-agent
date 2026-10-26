(function () {
  'use strict';
  const available = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  const selection = { game: true, rivers: 'all', hand: true };
  const defaults = () => ({ danger: true, efficiency: true, strategy: true, automatic: false, useModel: false, modelFromTurn: 1, interval: 8, limit: 20 });
  let previousDiscards = 0;
  let discussionRecords = [], currentDiscussionId = null, discussionLoaded = false, discussionBusy = null, discussionError = '';
  let historyOpen = false, historyFilter = '', historyAsked = false, selectedDecisionId = null;
  let reviewOpen = false, reviewKey = '', reviewError = '';
  let reviewLimits = {}, reviewPlan = null;
  let reviewWasEnded = false;
  const discussionDrafts = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  function mergeDiscussion(record) {
    if (!record?.id) return;
    const index = discussionRecords.findIndex(r => r.id === record.id);
    if (index < 0) discussionRecords.push(record); else if ((record.revision || 0) >= (discussionRecords[index].revision || 0)) discussionRecords[index] = record;
  }
  async function discussionCall(message) {
    if (!available) throw new Error('离线演示不保存讨论；请在扩展中使用。');
    const generation = lifecycle;
    const response = await send(message);
    if (!response?.ok) throw new Error(response?.error || '讨论历史保存失败。');
    if (response.record && generation === lifecycle) mergeDiscussion(response.record);
    return response;
  }
  async function loadDiscussions() {
    if (discussionLoaded || !available) return;
    discussionLoaded = true;
    const generation = lifecycle;
    try {
      const response = await discussionCall({ type: 'discussion:list' });
      if (generation !== lifecycle) return;
      for (const record of response.records || []) mergeDiscussion(record);
      // Loaded records restore retained panels; only a new result can become current.
      // A previous game's last analysis must not masquerade as this game's latest decision.
    } catch (e) { if (generation === lifecycle) { discussionLoaded = false; discussionError = e.message; } }
    if (generation === lifecycle) repaint?.();
  }
  async function saveDecision(data, capturedContext, type, analysis, id, generation) {
    if (!available) return;
    try {
      const response = await discussionCall({ type: 'discussion:save', record: { snapshot: data, context: capturedContext || {}, type, analysis } });
      if (id === requestId && generation === lifecycle) currentDiscussionId = response.record?.id || currentDiscussionId;
    } catch (e) { discussionError = e.message; }
  }
  async function askDiscussion(record) {
    const question = (discussionDrafts.get(record.id) || '').trim();
    if (!question || discussionBusy) return;
    if (busy && pendingAutomatic) cancelWork();
    if (busy) { discussionError = '请先完成或取消当前手动分析。'; repaint?.(); return; }
    const generation = lifecycle, token = `${Date.now()}-${Math.random()}`;
    discussionBusy = record.id; busy = true; pendingAutomatic = false; pendingFingerprint = ''; discussionError = '';
    repaint?.();
    try {
      await discussionCall({ type: 'discussion:ask', id: record.id, question, token });
      discussionDrafts.delete(record.id); repaint?.();
      const response = await send({ type: 'model:analyze', provider: 'chat', discussionId: record.id, discussionToken: token, question, selection: { ...selection } });
      if (generation !== lifecycle) return;
      // The worker commits the answer even when this card was removed or the live position advanced.
      const loaded = await discussionCall({ type: 'discussion:list' });
      for (const saved of loaded.records || []) mergeDiscussion(saved);
      if (!response?.ok) discussionError = response?.error || '追问失败，请重试。';
    } catch (e) { if (generation === lifecycle) discussionError = e.message; }
    finally { if (generation === lifecycle) { discussionBusy = null; busy = false; repaint?.(); } }
  }
  function discussionLabel(record, full = false) {
    const snap = record.snapshot, round = snap.game?.round, identity = record.context?.identity;
    return [full ? identity?.matchId || '未命名对局' : '', round ? `${['东','南','西','北'][round.wind] || '东'}${round.index + 1}局 ${snap.game?.honba || 0}本场` : '',
      `巡目 ${turnNumber(snap) ?? '未知'}`, `事件 ${record.context?.position ?? snap.lastStep ?? '未知'}`, full ? record.type : ''].filter(Boolean).join(' · ');
  }
  const matchKey = record => JSON.stringify(record.context?.identity?.matchId || 'unknown');
  const roundGroup = record => JSON.stringify([record.context?.identity?.roundStartId, record.snapshot.game?.round, record.snapshot.game?.honba]);
  function navigatorRecords() {
    if (context?.mode !== 'live' || current?.matchEnded === true) return discussionRecords;
    const identity = context.contextIdentity || {};
    return discussionRecords.filter(r => identity.roundStartId
      ? r.context?.identity?.roundStartId === identity.roundStartId && r.context?.identity?.matchId === identity.matchId
      : JSON.stringify(r.snapshot.game?.round) === JSON.stringify(current.round));
  }
  function navigationGroups(latest) {
    const records = navigatorRecords();
    const selected = records.includes(latest) ? latest : records.at(-1);
    const matches = [...new Set(records.map(matchKey))];
    const inMatch = records.filter(r => matchKey(r) === matchKey(selected));
    const rounds = [...new Set(inMatch.map(roundGroup))];
    const decisions = inMatch.filter(r => roundGroup(r) === roundGroup(selected));
    return { selected, matches, inMatch, rounds, decisions };
  }
  function decisionNavigatorHtml(latest) {
    if (!navigatorRecords().length) return '<p class="muted">本小局暂无已记录分析决策点。</p>';
    const { selected, matches, inMatch, rounds, decisions } = navigationGroups(latest);
    const options = (values, label, chosen) => values.map((value, i) => `<option value="${i}" ${value === chosen ? 'selected' : ''}>${escape(label(value, i))}</option>`).join('');
    return `<div class="decision-navigator" aria-label="巡目复盘选择器"><strong>切换已记录分析</strong>
      ${context?.mode === 'live' && current?.matchEnded !== true ? '' : `<label>对局<select id="decision-match">${options(matches, (_,i) => `对局 ${i + 1}`, matchKey(selected))}</select></label>
      <label>小局<select id="decision-round">${options(rounds, key => discussionLabel(inMatch.find(r => roundGroup(r) === key)).split(' · ')[0], roundGroup(selected))}</select></label>`}
      <label>巡目 / 决策点<select id="decision-position">${options(decisions, r => `巡目 ${turnNumber(r.snapshot) ?? '未知'} · 事件 ${r.context.position ?? r.snapshot.lastStep ?? '未知'} · ${r.type}`, selected)}</select></label>
      <button id="decision-current">回到当前</button><p class="muted">可回看所有已生成分析的决策点，包括未提问的分析；未分析巡目不在此列。</p></div>`;
  }
  function wireDecisionNavigator($, render, latest) {
    if (!navigatorRecords().length) return;
    const { matches, inMatch, rounds, decisions } = navigationGroups(latest);
    const select = record => { selectedDecisionId = record?.id || null; render(); };
    if (context?.mode !== 'live' || current?.matchEnded === true) {
    $('decision-match').onchange = e => select(discussionRecords.filter(r => matchKey(r) === matches[Number(e.target.value)]).at(-1));
    $('decision-round').onchange = e => select(inMatch.filter(r => roundGroup(r) === rounds[Number(e.target.value)]).at(-1));
    }
    $('decision-position').onchange = e => select(decisions[Number(e.target.value)]);
    $('decision-current').onclick = () => { selectedDecisionId = null; render(); };
  }
  function discussionHtml() {
    const latest = discussionRecords.find(r => r.id === (selectedDecisionId || currentDiscussionId));
    const cards = [...(latest ? [latest] : []), ...discussionRecords.filter(r => r.panel && r.id !== latest?.id).reverse()];
    const cardHtml = (record, index) => {
      const a = record.analysis;
      return `<article class="decision-discussion" aria-label="${index === 0 && record === latest ? '最新决策讨论' : '保留的决策讨论'}"><header><strong>${record === latest ? selectedDecisionId ? '历史决策 · ' : '最新分析 · ' : '保留讨论 · '}${escape(discussionLabel(record))}</strong></header>
        <div class="analysis-actions"><button id="discussion-collapse-${index}">${record.collapsed ? '展开讨论' : '折叠讨论'}</button>${record.panel ? `<button id="discussion-remove-${index}">移出面板（保留历史）</button>` : ''}</div>
        ${record.collapsed ? '' : `<p class="analysis-meta muted">${escape(a.model)} · ${escape(a.time || '')} · 固定在该决策时点</p>
        ${selectedDecisionId === record.id ? `<p class="warn">正在复盘该历史决策；实时采集继续，牌面提示暂停。</p><div class="analysis-global-hand" aria-label="所选决策手牌">${(record.snapshot.selfHand || []).map(face).join('')}</div>` : ''}<div class="analysis-decision"><span>${decisionHeading(a)}</span>${a.result.decision.tile ? face(a.result.decision.tile) : ''}<p>${reasons(a.result.decision.reasons)}</p></div>
        <details><summary>原分析与当时局面</summary><p class="muted">${escape(discussionLabel(record, true))}</p>${resultHtml(a)}<pre>${escape(JSON.stringify(record.snapshot, null, 2))}</pre></details>
        <div class="discussion-chat">${record.chat.map(t => `<div class="discussion-turn"><p><strong>你：</strong>${escape(t.question)}</p>${t.status === 'completed' ? resultHtml(t.response) : `<p class="muted">${escape(t.status === 'pending' ? '正在回答…' : t.error)}</p>`}</div>`).join('')}</div>
        <label for="discussion-question-${index}">追问该决策</label><textarea id="discussion-question-${index}" maxlength="4000" rows="2" placeholder="仅讨论该决策当时的局面">${escape(discussionDrafts.get(record.id) || '')}</textarea>
        <button id="discussion-send-${index}" ${discussionBusy || !enabled || provider !== 'chat' ? 'disabled' : ''}>${discussionBusy === record.id ? '正在追问…' : '发送追问并保留讨论'}</button>${!enabled || provider !== 'chat' ? '<p class="muted">追问需在模型设置中开启 LLM 接口。</p>' : ''}`}</article>`;
    };
    const matches = discussionRecords.filter(r => (!historyAsked || r.chat.length) && discussionLabel(r, true).toLowerCase().includes(historyFilter.toLowerCase())).slice().reverse();
    return `<section class="decision-discussions" aria-label="决策讨论">${reviewHtml()}${decisionNavigatorHtml(latest)}${cards.map(cardHtml).join('')}${discussionError ? `<p class="warn">${escape(discussionError)}</p>` : ''}
      <button id="discussion-history">${historyOpen ? '收起决策历史' : '查询决策历史'}</button>
      ${historyOpen ? `<label>筛选对局 / 小局 / 巡目 / 事件<input id="discussion-filter" value="${escape(historyFilter)}" placeholder="例如：东1局 或 巡目 7"></label><label><input id="discussion-asked" type="checkbox" ${historyAsked ? 'checked' : ''}>仅有追问</label><p class="muted">共 ${matches.length} 条。折叠和移出面板均保留历史；空间不足时优先淘汰未提问的旧分析。</p>${matches.map((r,i) => `<p>${escape(discussionLabel(r, true))} · ${r.chat.length} 次追问 <button id="discussion-open-${i}">重新打开讨论</button></p>`).join('')}` : ''}</section>`;
  }
  function wireDiscussions($, render) {
    wireReview($, render);
    const latest = discussionRecords.find(r => r.id === (selectedDecisionId || currentDiscussionId));
    const cards = [...(latest ? [latest] : []), ...discussionRecords.filter(r => r.panel && r.id !== latest?.id).reverse()];
    const patch = async (r, value) => { try { await discussionCall({ type: 'discussion:patch', id: r.id, patch: value }); } catch (e) { discussionError = e.message; } render(); };
    cards.forEach((record, i) => {
      $('discussion-collapse-' + i).onclick = () => patch(record, { collapsed: !record.collapsed });
      if (record.panel) $('discussion-remove-' + i).onclick = () => { if (record.id === currentDiscussionId) currentDiscussionId = null; if (record.id === selectedDecisionId) selectedDecisionId = null; return patch(record, { panel: false }); };
      if (!record.collapsed) {
        $('discussion-question-' + i).oninput = e => discussionDrafts.set(record.id, String(e.target.value || '').slice(0,4000));
        $('discussion-send-' + i).onclick = e => { if (e.isTrusted) return askDiscussion(record); };
      }
    });
    wireDecisionNavigator($, render, latest);
    $('discussion-history').onclick = () => { historyOpen = !historyOpen; render(); };
    if (historyOpen) {
      $('discussion-filter').onchange = e => { historyFilter = e.target.value; render(); };
      $('discussion-asked').onchange = e => { historyAsked = e.target.checked; render(); };
      discussionRecords.filter(r => (!historyAsked || r.chat.length) && discussionLabel(r, true).toLowerCase().includes(historyFilter.toLowerCase())).slice().reverse().forEach((r,i) => { $('discussion-open-' + i).onclick = () => patch(r, { panel: true, collapsed: false }); });
    }
  }
  function reviewGroups() { return typeof MJPostgameReview === 'undefined' ? [] : MJPostgameReview.groups(discussionRecords); }
  function reviewAvailable() { return context?.mode !== 'live' || current?.matchEnded === true || historyOpen || !!selectedDecisionId; }
  function chosenReview(groups) {
    return groups.find(group => group.key === reviewKey) || groups.find(group => group.matchId && group.matchId === context?.contextIdentity?.matchId)
      || groups.find(group => group.records.some(record => record.id === (selectedDecisionId || currentDiscussionId))) || groups.at(-1);
  }
  function reviewHtml() {
    if (!reviewAvailable()) { reviewOpen = false; reviewLimits = {}; reviewPlan = null; return ''; }
    const toggle = `<button id="review-toggle" aria-expanded="${reviewOpen}">${reviewOpen ? '收起整盘整理' : '打开整盘整理'}</button>`;
    if (!reviewOpen) { reviewPlan = null; return `<section class="postgame-review" aria-label="整盘整理">${toggle}</section>`; }
    const groups = reviewGroups(), group = chosenReview(groups);
    const summary = group && MJPostgameReview.summarize(discussionRecords, group.key);
    reviewPlan = { groups, group, summary, references: [] };
    const records = new Map(discussionRecords.map(record => [record.id, record]));
    let referenceIndex = 0;
    return `<section class="postgame-review" aria-label="整盘整理">${toggle}
      <p class="muted">仅整理留存分析，不新增模型调用。</p><button id="review-refresh">刷新留存记录</button>
      ${summary ? `<label>整理范围<select id="review-match">${groups.map((item, index) => `<option value="${index}" ${item.key === group.key ? 'selected' : ''}>${escape(item.matchId ? '对局 · ' + item.matchId : '归属未确认 · ' + (index + 1))}</option>`).join('')}</select></label>
        ${summary.verified ? '' : '<p class="warn">归属未确认：这些记录可能不属于同一盘对局。</p>'}
        <p class="review-overview">采样概览：${summary.roundCount} 个有记录小局 · ${summary.decisionCount} 个分析决策 · ${summary.questionCount} 次追问</p>
        <p class="muted">未记录实际出牌，以下为原建议与问答。</p>
        <details data-section="review-scope"><summary>整理范围说明</summary><p class="muted">仅覆盖留存的分析采样，未分析或已淘汰记录不在此列。实际动作未知；主题依据原分析、快照与问题整理，不用于判断失误率、整盘表现或用户偏好。归属未确认时，记录可能仅来自同一次查看，也可能只包含单个决策。</p></details>
        ${summary.topics.map(topic => `<div class="review-topic"><h4>${escape(topic.label)} · ${topic.references.length} 条来源</h4>${topic.references.length ? topic.references.slice(0, reviewLimits[topic.id] || 5).map(ref => {
          const index = referenceIndex++, record = records.get(ref.decisionId);
          reviewPlan.references.push(ref);
          return `<article><p><strong>${escape(ref.source)}</strong> · ${escape(ref.content.slice(0, 480))}${ref.content.length > 480 ? '…（完整内容见原决策）' : ''}</p>${record ? `<button id="review-reference-${index}" data-decision-id="${escape(ref.decisionId)}">回看并追问 · ${escape(discussionLabel(record))}</button>` : '<p class="muted">原决策已不在留存历史中，请刷新留存记录。</p>'}</article>`;
        }).join('') : '<p class="muted">暂无该主题的留存依据。</p>'}${topic.references.length > (reviewLimits[topic.id] || 5) ? `<button id="review-more-${topic.id}">再显示 5 条来源</button>` : ''}</div>`).join('')}` : '<p class="muted">暂无已保存的分析决策，生成分析后可在此整理。</p>'}
        ${reviewError ? `<p class="warn">${escape(reviewError)}</p>` : ''}</section>`;
  }
  function wireReview($, render) {
    if (!reviewAvailable() || !$('review-toggle')) return;
    $('review-toggle').onclick = () => { reviewOpen = !reviewOpen; reviewError = ''; render(); };
    if (!reviewOpen) return;
    $('review-refresh').onclick = async () => {
      const generation = lifecycle;
      try {
        const response = await discussionCall({ type: 'discussion:list' });
        if (generation !== lifecycle) return;
        discussionRecords = response.records || [];
        if (selectedDecisionId && !discussionRecords.some(record => record.id === selectedDecisionId)) selectedDecisionId = null;
        reviewError = ''; render();
      } catch (error) { if (generation === lifecycle) { reviewError = error.message; render(); } }
    };
    const { groups, group, summary, references } = reviewPlan || {};
    if (!group) return;
    $('review-match').onchange = event => { reviewKey = groups[Number(event.target.value)]?.key || ''; reviewError = ''; reviewLimits = {}; render(); };
    summary.topics.forEach(topic => {
      if (topic.references.length > (reviewLimits[topic.id] || 5)) $('review-more-' + topic.id).onclick = () => { reviewLimits[topic.id] = (reviewLimits[topic.id] || 5) + 5; render(); };
    });
    references.forEach((ref, index) => {
      const button = $('review-reference-' + index);
      if (!button) return;
      button.onclick = async () => {
        const generation = lifecycle;
        const record = discussionRecords.find(record => record.id === ref.decisionId);
        if (!record) { reviewError = '原决策已不在留存历史中。'; render(); return; }
        try {
          await discussionCall({ type: 'discussion:patch', id: record.id, patch: { panel: true, collapsed: false } });
          if (generation !== lifecycle) return;
          selectedDecisionId = record.id; reviewError = ''; render();
          $('discussion-question-0')?.focus?.({ preventScroll: false });
        } catch (error) { if (generation === lifecycle) { reviewError = error.message + ' 可点击“刷新留存记录”更新整理。'; render(); } }
      };
    });
  }
  let preferences = defaults(), preferencesLoaded = false, autoTimer = null, lastPosition = '', pendingFingerprint = '', lastAutoKey = '', roundKey = '', autoCalls = 0, lastModelAt = 0;
  function selectedTask() { return preferences.strategy || (preferences.danger && preferences.efficiency) ? 'combined' : preferences.danger ? 'danger' : 'efficiency'; }
  function hasFeatures() { return preferences.danger || preferences.efficiency || preferences.strategy; }
  function turnNumber(data) { return data?.game?.turnProgress?.status === 'known' && Number.isInteger(data.selfSeat) ? data.game.turnProgress.bySeat[data.selfSeat] ?? null : null; }
  function usesModel(data) { return preferences.useModel && (preferences.modelFromTurn === 1 || (turnNumber(data) !== null && turnNumber(data) >= preferences.modelFromTurn)); }
  function cancelWork() {
    if (autoTimer !== null) clearTimeout(autoTimer); autoTimer = null;
    requestId++;
    if (busy && available) send({ type: 'model:cancel' }).catch(() => {});
    busy = false; pendingFingerprint = '';
  }
  function savePreferences() {
    if (available) send({ type: 'model:preferences', preferences: { ...preferences } }).then(response => {
      if (!response?.ok) { failure = '偏好未保存，请重试。'; repaint?.(); }
    }).catch(() => { failure = '偏好未保存，请刷新扩展。'; repaint?.(); });
  }
  function changePreferences(patch) {
    if (!busy || pendingAutomatic || patch.useModel === false) cancelWork();
    preferences = { ...preferences, ...patch }; task = selectedTask(); result = null; failure = ''; lastAutoKey = ''; preparationKey = ''; preparation = null;
    savePreferences(); repaint?.();
  }
  function localResponse(data, requestedTask = task) {
    const local = MJAnalysis.prepare(data, requestedTask).data.localAnalysis;
    const candidates = [...(local.efficiency?.candidates || [])].sort((a, b) => a.shanten - b.shanten || b.totalUnseenUpperBound - a.totalUnseenUpperBound);
    const best = local.efficiency?.shanten === -1 ? null : candidates[0];
    return { ok: true, model: '本地分析 · 未调用模型', localAnalysis: local,
      result: { task: requestedTask, danger: (local.danger?.candidates || []).map(c => ({ tile: c.tile, opponents: c.opponents.map(o => ({ seat: o.seat, level: o.genbutsu ? 'safe' : 'unknown', reasons: [o.genbutsu ? '该对手牌河已有此牌（现物）' : '无法仅凭本地规则确定危险等级', ...(o.sujiReferences.length ? ['筋参考：' + o.sujiReferences.map(MJSnapshotContract.label).join('、')] : []), ...(o.kabeReferences.length ? ['壁参考：' + o.kabeReferences.map(MJSnapshotContract.label).join('、')] : [])] })) })),
      efficiency: candidates.map(c => ({ tile: c.tile, reasons: [`${c.shanten} 向听，有效牌未见合计上界 ${c.totalUnseenUpperBound} 枚`] })), decision: { action: 'unknown', tile: data.phase === 'playing' && best ? best.tile : null, reasons: [best ? `仅按牌效率比较：打出${MJSnapshotContract.label(best.tile)}后 ${best.shanten} 向听，有效牌未见合计 ≤${best.totalUnseenUpperBound} 枚；未综合放铳风险。` : local.efficiency?.shanten === -1 ? '当前手牌已成和牌形；是否可以和牌还需确认役种与规则。' : '本地分析提供确定性依据，不生成综合攻守结论。'] },
      limitations: local.danger?.limitations || [] } };
  }
  async function runAnalysis(automatic = false) {
    if (busy || discussionBusy || (automatic && !hasFeatures())) return;
    const id = ++requestId;
    try {
      const data = snapshot(), external = automatic ? usesModel(data) : preferences.useModel;
      if (external && (!available || !enabled)) throw new Error('请先在模型设置中接入并开启模型。');
      const actualProvider = external ? provider : 'local', requestedTask = automatic ? task : 'combined';
      const extra = external && provider === 'mjai' ? { engineRequest: engineRequest(requestedTask) }
        : external ? { lane: automatic ? 'live' : 'manual-review', question: automatic ? '' : questionDraft,
          context: typeof current.analysisContext === 'function' ? current.analysisContext() : undefined } : {};
      const capturedContext = external && extra.context ? clone(extra.context) : (typeof current.analysisContext === 'function' ? clone(current.analysisContext()) : { identity: context?.contextIdentity, position: context?.cursor ?? data.lastStep });
      const captured = fingerprint(), seatLabels = current.seatLabels.slice();
      const capturedPosition = { round: data.game?.round, source: context?.mode, cursor: context?.cursor, selfSeat: data.selfSeat, hand: data.selfHand?.slice() || [] };
      pendingFingerprint = automatic ? captured : ''; pendingAutomatic = automatic; busy = true;
      if (automatic) failure = ''; else globalFailure = '';
      modelFailureExpanded[automatic ? 'automatic' : 'global'] = false;
      delete modelFailures[automatic ? 'automatic' : 'global'];
      if (automatic && external) { autoCalls++; lastModelAt = Date.now(); }
      repaint?.();
      const response = external ? await send({ type: 'model:analyze', provider, task: requestedTask, snapshot: data, ...extra }) : localResponse(data, requestedTask);
      if (id !== requestId || (automatic && captured !== fingerprint())) return;
      if (!response?.ok) {
        if (typeof response?.rawModelResult?.content === 'string') {
          modelFailures[automatic ? 'automatic' : 'global'] = { ...response.rawModelResult, error: response.error, validation: response.validation };
        }
        throw new Error(response?.error || '分析失败，请重试。');
      }
      // A combined backend request may supply extra sections; display only enabled help.
      if (automatic) {
        if (!preferences.danger) response.result.danger = [];
        if (!preferences.efficiency) { response.result.efficiency = []; if (response.localAnalysis) delete response.localAnalysis.efficiency; }
        if (!preferences.strategy && task === 'combined') response.result.decision = localResponse(data).result.decision;
        if (actualProvider === 'local' && !preferences.efficiency) response.result.decision = { action: 'unknown', tile: null, reasons: [preferences.strategy ? '综合攻守解释需要模型；本地仅提供已开启的确定性依据。' : '本地仅提供危险牌依据，不生成弃牌建议。'] };
        focusTile = null; focusExpanded = false;
      }
      const completed = { ...response, actualProvider, seatLabels, positionPhase: data.phase, fingerprint: captured, time: new Date().toLocaleTimeString('zh-CN'), position: capturedPosition };
      if (automatic) result = completed; else globalResult = completed;
      await saveDecision(data, capturedContext, requestedTask, completed, id, lifecycle);
    } catch (e) { if (id === requestId) { if (automatic) failure = e.message; else globalFailure = e.message; } }
    finally { if (id === requestId) { busy = false; pendingFingerprint = ''; repaint?.(); } }
  }
  function scheduleAnalysis(data) {
    if (autoTimer !== null) clearTimeout(autoTimer); autoTimer = null;
    if (!preferencesLoaded || !preferences.automatic || busy || !hasFeatures() || context?.mode !== 'live' || current.phase !== 'playing' || !data) return;
    const local = MJAnalysis.prepare(data, 'combined').data.localAnalysis.efficiency;
    if (!Number.isInteger(data.selfSeat) || data.game?.recentActor !== data.selfSeat || !local?.canDiscard) return;
    const key = fingerprint(); if (lastAutoKey === key) return;
    const external = usesModel(data);
    if (external && (!enabled || !available || autoCalls >= preferences.limit)) return;
    const delay = external ? Math.max(350, preferences.interval * 1000 - (Date.now() - lastModelAt)) : 100;
    autoTimer = setTimeout(() => { autoTimer = null; if (key !== fingerprint()) return; lastAutoKey = key; runAnalysis(true); }, delay);
  }
  let task = 'combined', enabled = false, busy = false, result = null, failure = '', preview = false, provider = 'chat';
  let pendingAutomatic = false, globalResult = null, globalFailure = '', questionDraft = '';
  let modelFailures = {}, modelFailureExpanded = {};
  let focusTile = null, hooks = {}, detailsState = {}, current, context, repaint, requestId = 0, lifecycle = 0, statusRequestId = 0, connected = false;
  let focusExpanded = false, focusResizeObserver = null;
  const send = message => chrome.runtime.sendMessage(message);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function failureHtml(message, scope) {
    if (!message) return '';
    const diagnostic = modelFailures[scope];
    const inspectable = diagnostic?.error === message;
    const expanded = inspectable && modelFailureExpanded[scope];
    return `<p class="warn" role="status">${escape(message)}${inspectable ? ` <button id="model-failure-${scope}" aria-expanded="${!!expanded}" aria-controls="model-raw-${scope}">${expanded ? '收起' : '查看'}</button>` : ''}</p>${expanded ? `<div id="model-raw-${scope}"><p class="analysis-meta muted">${escape(diagnostic.model)} · ${escape(diagnostic.capturedAt)}${diagnostic.validation ? ` · ${escape(diagnostic.validation.path)} · ${escape(diagnostic.validation.code)}` : ''}${diagnostic.finishReason ? ` · ${escape(diagnostic.finishReason)}` : ''}</p>${diagnostic.truncated ? '<p class="muted">仅保留原文前 32000 字符。</p>' : ''}<pre tabindex="0" aria-label="模型失败原始结果">${escape(diagnostic.content)}</pre></div>` : ''}`;
  }
  const tileBase = available ? chrome.runtime.getURL('tiles/') : new URL('tiles/', document.currentScript?.src || new URL('../extension/analysis-panel.js', location.href)).href;
  const styleUrl = available ? chrome.runtime.getURL('analysis-panel.css') : new URL('analysis-panel.css', document.currentScript?.src || new URL('../extension/analysis-panel.js', location.href)).href;
  const rendered = new WeakMap();
  const face = t => /^(?:[0-9][mps]|[1-7]z)$/.test(t) ? `<img class="analysis-tile" src="${escape(tileBase + t + '.svg')}" alt="${escape(MJSnapshotContract.label(t))}" title="${escape(MJSnapshotContract.label(t))}">` : escape(t);
  const joinReasons = values => (values || []).map(value => String(value ?? '').trim().replace(/[；;]+$/u, '')).filter(Boolean)
    .reduce((text, value) => text ? text + (/[。！？!?.…][”’」』）)]?$/u.test(text) ? ' ' : '；') + value : value, '');
  const reasons = values => escape(joinReasons(values));
  const actionNames = { attack: '进攻', defend: '防守', fold: '弃和', unknown: '暂无法判断' };
  const riskNames = { safe: '对该家现物', low: '较低', medium: '中等', high: '较高', unknown: '未知' };
  const decisionLabel = response => response?.actualProvider === 'local' ? '本地分析' : ({ reach: '立直意向', none: '跳过响应' })[response?.engine?.action?.type] || actionNames[response?.result?.decision?.action] || '暂无法判断';
  const decisionHeading = response => escape(decisionLabel(response)) + (response?.result?.decision?.tile ? ' · 建议打' : '');
  function resultHtml(response) {
    const r = response.result;
    if (!r) return '';
    return `${r.danger.length ? '<h4>逐对手危险牌</h4>' + r.danger.map(d => `<div class="analysis-card">${face(d.tile)}${d.opponents.map(o => `<p>${escape(response.seatLabels?.[o.seat] || ('座位 ' + o.seat))} · ${escape(riskNames[o.level])}：${reasons(o.reasons)}</p>`).join('')}</div>`).join('') : ''}
      ${r.efficiency.length ? '<h4>牌效率解释</h4>' + r.efficiency.map(e => `<div class="analysis-card">${face(e.tile)} ${reasons(e.reasons)}</div>`).join('') : ''}
      <h4>建议</h4><p>${decisionHeading(response)} ${r.decision.tile ? face(r.decision.tile) : ''} ${reasons(r.decision.reasons)}</p>
      ${r.limitations.length ? `<p class="warn">${reasons(r.limitations)}</p>` : ''}
      ${response.trace ? `<details data-section="trace"><summary>Agent 运行记录</summary><ol>${response.trace.events.map(event => `<li>${escape(event.tool)} · ${escape(event.status)} · ${escape(event.elapsedMs)} ms</li>`).join('')}</ol>${response.runtime ? `<p>${escape(response.runtime.name)} · ${escape(response.runtime.turns)} 次模型请求 · ${escape(response.runtime.toolCalls)} 次工具调用</p>` : ''}</details>` : ''}
      ${response.usage ? usageHtml(response) : ''}`;
  }
  function usageHtml(response) {
    const u = response.usage, show = v => Number.isFinite(v) ? escape(v) : '未知';
    return `<details data-section="usage"><summary>用量与费用</summary><p class="muted">${response.contextMode === 'round' ? '小局上下文' : '当前快照'} · ${show(response.calls)} 次请求 · ${show(response.elapsedMs)} ms</p><p>输入 ${show(u.inputTokens)} · 缓存读取 ${show(u.cacheReadTokens)} · 缓存写入 ${show(u.cacheWriteTokens)} · 输出 ${show(u.outputTokens)} · 思考 ${show(u.reasoningTokens)}</p><p>估算费用：${Number.isFinite(response.cost?.totalCost) ? `${escape(response.cost.currency)} ${escape(response.cost.totalCost.toFixed(6))}` : '未知（需接口返回用量并配置价格）'}</p></details>`;
  }
  function localHtml(local, phase) {
    const e = local?.efficiency;
    if (!e) return '';
    if (e.status !== 'available') return `<h4>本地牌效率</h4><p class="muted">${reasons(e.reasons)}</p>`;
    const entry = c => `<tr><td>${c.tile ? face(c.tile) : '当前手牌'}</td><td>${escape(c.shanten)}</td><td>${c.effectiveTiles.map(t => `${face(t.tile)} ${t.unseenUpperBound === 0 ? '已见耗尽' : '≤' + escape(t.unseenUpperBound)}`).join(' ') || '无'}</td><td>≤${escape(c.totalUnseenUpperBound)}</td></tr>`;
    return `<h4>本地牌效率计算</h4><p>${phase !== 'playing' ? '结算或历史局面的数学比较，不是当前出牌建议' : e.canDiscard ? '各候选弃牌后的比较' : '当前不提供弃牌建议；等待摸牌或确认立直摸牌。'} · ${e.shanten === -1 ? '和牌型' : escape(e.shanten) + ' 向听'}</p>
      ${e.reasons?.length ? `<p>${reasons(e.reasons)}</p>` : ''}
      <table><thead><tr><th>弃牌</th><th>向听</th><th>有效牌 / 未见上界</th><th>合计上界</th></tr></thead><tbody>${e.candidates.map(entry).join('')}${e.current ? entry(e.current) : ''}</tbody></table><p class="muted">未见枚数为上界，不代表牌山剩余枚数。${e.visibleTiles.partial ? '已见牌范围不完整。' : ''}</p>`;
  }
  function snapshot() { return current.snapshot(selection); }
  function engineRequest(requestedTask = task) {
    if (!selection.game || selection.rivers !== 'all' || !selection.hand) throw new Error('专业引擎需要授权对局信息、全部公开牌河及自家手牌。');
    if (typeof current.engineRequest !== 'function') throw new Error('当前输入不支持专业引擎事件，请重新加载扩展。');
    if (requestedTask !== 'combined') throw new Error('本地 mjai 仅支持综合决策，请开启攻守建议。');
    return current.engineRequest(selection);
  }
  let preparationKey = '', preparation = null, preparationError = '', preparationBusy = false;
  function requestPreparation(data) {
    const generation = lifecycle, taskAtRequest = 'combined', external = preferences.useModel, extra = { provider: external ? provider : 'local', ...(external && provider === 'mjai' ? { engineRequest: engineRequest(taskAtRequest) } : {}) }, key = JSON.stringify([taskAtRequest, data, extra]);
    if (key === preparationKey) return;
    preparationKey = key; preparation = null; preparationError = ''; preparationBusy = true;
    const pending = available && external ? send({ type: 'model:prepare', task: taskAtRequest, snapshot: data, ...extra }) : new Promise(resolve => setTimeout(() => {
      try { resolve({ ok: true, data: MJAnalysis.prepare(data, taskAtRequest).data }); } catch (e) { resolve({ ok: false, error: e.message }); }
    }, 0));
    pending.then(response => { if (key !== preparationKey || generation !== lifecycle) return;
      if (!response?.ok) preparationError = response?.error || '无法整理局面数据。'; else preparation = response.data;
    }).catch(e => { if (key === preparationKey && generation === lifecycle) preparationError = e.message; }).finally(() => { if (key === preparationKey && generation === lifecycle) { preparationBusy = false; repaint?.(); } });
  }
  function fingerprint() { try { return JSON.stringify({ provider, preferences, task, context, round: current.round, phase: current.phase, hand: current.selfHand, drawnTile: current.drawnTile, snapshot: snapshot() }); } catch (_) { return ''; } }
  async function refresh() {
    if (!available) return;
    const generation = lifecycle, id = ++statusRequestId;
    try { const status = await send({ type: 'model:status' });
      if (generation !== lifecycle || id !== statusRequestId) return;
      const nextProvider = status?.provider === 'mjai' ? 'mjai' : 'chat';
      if (enabled !== !!status?.enabled || provider !== nextProvider) { result = null; preparationKey = ''; preparation = null; }
      if (!preferencesLoaded) { preferences = { ...defaults(), ...status?.preferences }; preferencesLoaded = true; task = selectedTask(); }
      provider = nextProvider;
      enabled = !!status?.enabled; }
    catch (_) { if (generation !== lifecycle || id !== statusRequestId) return; enabled = false; preferencesLoaded = true; }
    repaint?.();
  }
  function configChanged(message, sender) {
    if (message?.type !== 'model:config-changed' || sender?.id !== chrome.runtime.id || sender.tab) return;
    cancelWork(); result = null; failure = ''; lastAutoKey = ''; preparationKey = ''; preparation = null; preparationError = ''; preparationBusy = false;
    hooks.onHints?.(null);
    // Block requests using the previous configuration while status is refreshed.
    enabled = false;
    refresh(); repaint?.();
  }
  function connect() {
    if (!available) { preferencesLoaded = true; return; }
    if (connected) return;
    connected = true;
    chrome.runtime.onMessage.addListener(configChanged);
    window.addEventListener('focus', refresh);
    refresh(); loadDiscussions();
  }
  function destroy() {
    cancelWork(); preferences = defaults(); preferencesLoaded = false; lastPosition = ''; lastAutoKey = ''; roundKey = ''; previousDiscards = 0; autoCalls = 0; lastModelAt = 0;
    hooks.onHints?.(null); hooks = {}; detailsState = {}; focusTile = null;
    focusExpanded = false; focusResizeObserver?.disconnect(); focusResizeObserver = null;
    lifecycle++; requestId++;
    if (available && connected) {
      chrome.runtime.onMessage.removeListener(configChanged);
      window.removeEventListener('focus', refresh);
      if (busy) send({ type: 'model:cancel' }).catch(() => {});
    }
    connected = false; enabled = false; busy = false; result = null; failure = ''; preview = false; provider = 'chat';
    globalResult = null; globalFailure = ''; pendingAutomatic = false; questionDraft = '';
    discussionRecords = []; currentDiscussionId = null; discussionLoaded = false; discussionBusy = null; discussionError = ''; discussionDrafts.clear(); historyOpen = false; selectedDecisionId = null;
    reviewOpen = false; reviewKey = ''; reviewError = '';
    reviewLimits = {}; reviewPlan = null;
    reviewWasEnded = false;
    modelFailures = {}; modelFailureExpanded = {};
    current = null; context = null; repaint = null;
    preparationKey = ''; preparation = null; preparationError = ''; preparationBusy = false;
    selection.game = true; selection.rivers = 'all'; selection.hand = true; task = 'combined';
  }
  function mount(container, analysisView, position, render, nextHooks = {}) {
    let content = container.querySelector('[data-analysis-content]');
    if (!content) {
      container.innerHTML = `<link rel="stylesheet" href="${escape(styleUrl)}"><div data-analysis-content></div>`;
      content = container.querySelector('[data-analysis-content]');
    }
    container = content;
    const activeInput = container.getRootNode?.().activeElement || document.activeElement;
    const inputState = activeInput?.id?.startsWith('discussion-question-') ? { id: activeInput.id, start: activeInput.selectionStart, end: activeInput.selectionEnd } : null;
    const oldScroll = container.querySelector?.('.analysis')?.scrollTop || 0;
    for (const detail of container.querySelectorAll?.('details[data-section]') || []) detailsState[detail.dataset.section] = detail.open;
    if (hooks.onHints && hooks.onHints !== nextHooks.onHints) hooks.onHints(null);
    hooks = nextHooks;
    const sourceChanged = context && (context.mode !== position?.mode || context.replayRevision !== position?.replayRevision || JSON.stringify(context.historyView) !== JSON.stringify(position?.historyView));
    const cursorChanged = context && context.cursor !== position?.cursor;
    if (sourceChanged || cursorChanged) {
      if (!busy || pendingAutomatic) cancelWork();
      failure = ''; preparationKey = ''; preparation = null; preparationError = ''; preparationBusy = false;
      if (sourceChanged) { result = null; focusTile = null; focusExpanded = false; }
    }
    if (position?.mode === 'live') {
      if (reviewWasEnded && analysisView.matchEnded !== true) {
        reviewOpen = false; reviewKey = ''; reviewLimits = {}; reviewPlan = null;
        historyOpen = false; selectedDecisionId = null;
      }
      reviewWasEnded = analysisView.matchEnded === true;
    }
    current = analysisView; context = { ...position }; repaint = render;
    connect();
    const positionKey = fingerprint();
    if (pendingFingerprint && pendingFingerprint !== positionKey) cancelWork();
    if (lastPosition !== positionKey) { lastPosition = positionKey; if (autoTimer !== null) clearTimeout(autoTimer); autoTimer = null; }
    const stale = !!result && result.fingerprint !== fingerprint();
    const live = context?.mode === 'live' && current.phase === 'playing';
    let selectedSnapshot = null;
    try { selectedSnapshot = snapshot(); } catch (_) {}
    const hintHand = current.selfHand || selectedSnapshot?.selfHand;
    hooks.onHints?.(live && !selectedDecisionId && !stale && result?.result && Array.isArray(hintHand) && hintHand.length ? {
      hand: hintHand.slice(), drawnTile: current.drawnTile ?? selectedSnapshot?.selfDrawnTile ?? null, decision: result.result.decision,
      danger: result.result.danger, seatLabels: result.seatLabels.slice()
    } : null);
    let payload = '', error = '';
    try { const raw = snapshot(); if (preview) requestPreparation(raw); payload = preparation ? JSON.stringify(preparation, null, 2) : '正在整理当前局面数据…'; } catch (e) { error = e.message; }
    if (preview && preparationError) error = preparationError;
    const disclosure = (key, label, content) => `<details data-section="${key}" ${detailsState[key] ? 'open' : ''}><summary>${label}</summary>${content}</details>`;
    const savedAutomatic = !!result && discussionRecords.some(record => record.analysis.fingerprint === result.fingerprint);
    const savedGlobal = !!globalResult && discussionRecords.some(record => record.analysis.fingerprint === globalResult.fingerprint);
    const r = savedAutomatic ? null : result?.result;
    const candidateTiles = [...new Set([...(r?.efficiency || []).map(e => e.tile), ...(r?.danger || []).map(d => d.tile)])].filter(t => t && t !== r?.decision?.tile).slice(0, 3);
    const hand = Array.isArray(current.selfHand) ? current.selfHand : [];
    const activeResult = (live || context?.mode === 'replay') && !stale ? r : null;
    const kind = tile => String(tile).replace(/^0([mps])$/, '5$1');
    const drawnIndex = current.drawnTile ? hand.lastIndexOf(current.drawnTile) : -1;
    const handFace = (tile, index) => {
      const suggested = !!activeResult?.decision.tile && activeResult.decision.tile === tile;
      const dangerous = !!activeResult?.danger.some(d => kind(d.tile) === kind(tile) && d.opponents.some(o => o.level === 'high'));
      const label = [MJSnapshotContract.label(tile), index === drawnIndex ? '摸牌' : '', suggested ? '建议' : '', dangerous ? '高危' : ''].filter(Boolean).join(' · ');
      return `<span class="analysis-hand-tile${suggested ? ' is-suggested' : ''}${dangerous ? ' is-dangerous' : ''}" aria-label="${escape(label)}" title="${escape(label)}">${face(tile)}</span>`;
    };
    const handHtml = `<div class="analysis-hand-tiles" style="--hand-count:${Math.max(hand.length, 1)};--concealed-count:${Math.max(hand.length - (drawnIndex >= 0 ? 1 : 0), 1)}"><div class="analysis-hand-concealed">${hand.map((tile, i) => i !== drawnIndex ? handFace(tile, i) : '').join('')}</div>${drawnIndex >= 0 ? `<div class="analysis-hand-drawn">${handFace(hand[drawnIndex], drawnIndex)}</div>` : ''}</div>`;
    const handSection = hand.length ? `<div class="analysis-hand" aria-label="当前自家手牌"><small class="muted">当前自家手牌</small>${handHtml}</div>` : '';
    const focusTiles = [...new Set([r?.decision.tile, ...candidateTiles])].filter(Boolean);
    if (!focusTiles.includes(focusTile)) { focusTile = r?.decision.tile || focusTiles[0] || null; focusExpanded = false; }
    const focusedDanger = (r?.danger || []).filter(d => kind(d.tile) === kind(focusTile)).flatMap(d => d.opponents.map(o => `${result.seatLabels?.[o.seat] || ('座位 ' + o.seat)} · ${riskNames[o.level] || '未知'}：${joinReasons(o.reasons)}`));
    const focusedEfficiency = (r?.efficiency || []).filter(e => e.tile === focusTile).flatMap(e => e.reasons || []);
    const focusSummary = focusTile ? `<div class="analysis-focus${focusExpanded ? ' is-expanded' : ''}" aria-label="候选牌解释"><small>${escape(MJSnapshotContract.label(focusTile))} · ${focusTile === r?.decision.tile ? '首选建议' : '候选解释'}</small><p id="model-focus-text">${escape(joinReasons([...focusedDanger, ...focusedEfficiency]) || '暂无该牌的额外解释，请展开详细分析查看完整依据。')}</p><button id="model-focus-toggle" aria-expanded="${focusExpanded}" aria-controls="model-focus-text" ${focusExpanded ? '' : 'hidden'}>${focusExpanded ? '收起' : '展开'}</button></div>` : '';
    const candidateHtml = focusTiles.length ? `<div class="analysis-candidates"><span class="muted">比较</span>${focusTiles.map((tile, index) => `<button id="model-candidate-${index}" data-candidate-tile="${escape(tile)}" aria-pressed="${tile === focusTile}" aria-label="查看${escape(MJSnapshotContract.label(tile))}的风险和效率理由">${face(tile)}</button>`).join('')}</div>${focusSummary}` : '';
    const roundLabel = current.round ? `${['东', '南', '西', '北'][current.round.wind] || '东'}${Number(current.round.index) + 1}局` : '等待开局';
    const selfLabel = Number.isInteger(current.selfSeat) ? current.seatLabels[current.selfSeat] : '';
    const replay = context?.mode === 'replay', recordCount = current.recordCount || 0, cursor = context?.cursor || 0;
    const modeControls = typeof current.onMode === 'function' ? `<div class="analysis-modes" role="group" aria-label="分析模式"><button id="analysis-mode-live" aria-pressed="${context?.mode === 'live'}">实时对局</button><button id="analysis-mode-replay" aria-pressed="${replay}">牌谱复盘</button></div>` : '';
    const replayControls = replay ? `<div class="analysis-replay">
      ${recordCount ? `<div class="analysis-replay-heading"><label>复盘视角 <select id="analysis-replay-seat" aria-label="复盘视角"><option value="">请选择</option>${current.seatLabels.map((label, i) => `<option value="${i}">${escape(label)}</option>`).join('')}</select></label><span class="muted">事件 ${cursor} / ${recordCount}</span></div>
      <input id="analysis-replay-cursor" aria-label="复盘事件游标" type="range" min="0" max="${recordCount}" value="${cursor}">
      <div class="controls"><button id="analysis-replay-start">本局开局</button><button id="analysis-replay-prev" ${cursor <= 0 ? 'disabled' : ''}>上一事件</button><button id="analysis-replay-next" ${cursor >= recordCount ? 'disabled' : ''}>下一事件</button></div>
      <p class="muted">按所选事件分析，游标需手动与游戏画面对齐。</p>` : '<p class="muted">请在雀魂中打开牌谱，载入后可选择视角和分析位置。</p>'}
      </div>` : '';

    const settings = `<div class="controls"><button id="model-settings" ${!available ? 'disabled' : ''}>模型设置</button><button id="model-refresh" ${!available ? 'disabled' : ''}>刷新状态</button></div>
      ${preferences.useModel && provider === 'mjai' ? '<p class="muted">本地 mjai：使用公开牌局、自家手牌和动作记录；仅支持无副露四麻。</p>' : ''}
      <label title="按自家出牌次数计巡，补牌不加巡；复盘仅手动分析。">调用时机 <select id="model-from-turn"><option value="1">每巡</option><option value="7">第 N 巡起</option></select></label>
      ${preferences.modelFromTurn > 1 ? `<label>开始巡数 <input id="model-turn-number" type="number" min="2" max="18" value="${preferences.modelFromTurn}"></label>` : ''}
      ${preferences.modelFromTurn > 1 ? '<p class="muted">未达指定巡数或巡目未知时，仅本地分析。</p>' : ''}
      <label>调用间隔（秒） <input id="model-interval" type="number" min="1" max="60" value="${preferences.interval}"></label>
      <label title="仅限制自动调用，手动分析不受限。">每局调用上限 <input id="model-limit" type="number" min="1" max="100" value="${preferences.limit}"> <span class="muted">已用 ${autoCalls} 次</span></label>
      ${!preferences.useModel ? '<p class="muted">本地计算，不发送数据。</p>' : ''}
      <div class="analysis-calibration"><button title="${current.hintsReady ? '首次使用需校准手牌位置，可随时重校。' : '进入游戏牌桌后可校准手牌提示。'}" id="analysis-calibrate" ${current.hintsReady ? '' : 'disabled'}>${current.hintsCalibrated ? '重新校准手牌提示' : '校准手牌提示'}</button></div><button id="model-preview">${preview ? '收起' : '查看'}分析数据</button>${preview ? `<pre>${escape(payload || error)}</pre>` : ''}${error ? `<p class="warn">${escape(error)}</p>` : ''}`;
    const globalBusy = busy && !pendingAutomatic && !discussionBusy;
    const savedRound = globalResult?.position.round;
    const savedPosition = globalResult ? [globalResult.position.source === 'replay' ? '牌谱' : globalResult.position.source === 'live' ? '实时' : '历史',
      savedRound ? `${['东', '南', '西', '北'][savedRound.wind] || '东'}${savedRound.index + 1}局` : '',
      globalResult.seatLabels[globalResult.position.selfSeat] || '',
      globalResult.position.source === 'replay' ? `事件 ${globalResult.position.cursor}` : '', globalResult.time].filter(Boolean).join(' · ') : '';
    const globalHtml = `<section class="analysis-global" aria-label="全局分析">
      <h3>全局分析</h3>
      ${provider === 'chat' && preferences.useModel ? `<label for="model-question">追问（可选）</label><textarea id="model-question" maxlength="4000" rows="2" placeholder="例如：为什么刚才建议打这张牌？">${escape(questionDraft)}</textarea>` : ''}
      <div class="analysis-actions"><button id="model-run" ${busy || !!error || !preferencesLoaded ? 'disabled' : ''}>${replay ? '分析所选局面' : '分析当前局面'}</button>${globalBusy ? '<button id="model-cancel">取消</button>' : ''}</div>
      ${globalResult && !savedGlobal ? `<p class="analysis-meta muted">${escape(savedPosition)} · ${escape(globalResult.model)}</p><div class="analysis-global-result">
        <div class="analysis-decision"><span>${decisionHeading(globalResult)}</span>${globalResult.result.decision.tile ? face(globalResult.result.decision.tile) : ''}<p>${escape(globalResult.result.decision.reasons?.[0] || '请展开分析依据。')}</p></div>
        ${disclosure('global-details', '分析依据', `${resultHtml(globalResult)}${globalResult.position.hand.length ? `<div class="analysis-global-hand" aria-label="分析时手牌">${globalResult.position.hand.map(face).join('')}</div>` : ''}${localHtml(globalResult.localAnalysis, globalResult.positionPhase)}`)}</div>` : savedGlobal ? '' : '<p class="muted">尚未分析</p>'}
      ${failureHtml(globalFailure, 'global')}
      </section>`;
    const markup = `<section class="analysis" aria-label="模型分析">
      ${modeControls}${replayControls}${discussionHtml()}
      <div class="analysis-switches" role="group" aria-label="辅助功能">
      <label><input id="model-auto" type="checkbox" ${preferences.automatic ? 'checked' : ''}> 自动分析</label>
      <label><input id="model-use" type="checkbox" ${preferences.useModel ? 'checked' : ''}> 调用模型</label>
      ${[['danger', '危险牌提示'], ['efficiency', '手牌建议'], ['strategy', '攻守建议']].map(([key, label]) => `<label><input id="feature-${key}" type="checkbox" ${preferences[key] ? 'checked' : ''}> ${label}</label>`).join('')}
      <button id="model-preset">综合辅助</button></div>
      <header class="analysis-heading"><strong>${escape(roundLabel)}${selfLabel ? ` · ${escape(selfLabel)}${replay ? '视角' : ''}` : ''}</strong><span class="analysis-state">${!preferences.useModel ? '仅本地分析' : preferences.automatic ? '自动分析' : '手动分析'}</span></header>
      ${busy ? `<p class="${live ? 'warn' : 'muted'}" role="status" aria-live="polite">${discussionBusy ? '正在回答该决策的追问，可继续对局。' : live ? '正在分析，请先不要出牌。' : '正在分析中…'}</p>` : ''}
      ${(current.riichiLabels || []).length ? `<p class="analysis-riichi">${replay ? '已立直' : '立直警戒'} · ${(current.riichiLabels || []).map(escape).join(' · ')}</p>` : ''}
      <div class="analysis-main" role="status" aria-live="polite">
      ${stale && !busy ? '<p class="warn analysis-stale">局面或分析功能已变化，以下为旧结果，请重新分析。</p>' : ''}
      ${r ? `<div class="analysis-decision"><span>${decisionHeading(result)}</span>${r.decision.tile ? face(r.decision.tile) : ''}<p>${escape(r.decision.reasons?.[0] || '请结合当前局面判断。')}</p></div>${candidateHtml}` : busy || savedAutomatic ? '' : `<div class="analysis-empty"><strong>${!current.round ? '等待开局数据' : preferences.automatic ? '等待轮到你出牌' : '自动提示未开启'}</strong>${!hasFeatures() ? '<p class="muted">请至少开启一项辅助功能。</p>' : preferences.useModel && !enabled ? '<p class="muted">请在模型设置中接入并开启模型。</p>' : ''}</div>`}
      ${!replay && (current.phase === 'ended' || context?.mode === 'history') ? '<p class="muted">历史或结算局面 · 仅作复盘</p>' : ''}
      ${failureHtml(failure, 'automatic')}
      </div>
      ${disclosure('reasons', '详细分析', `${handSection}${r ? `${resultHtml(result)}${localHtml(result.localAnalysis, result.positionPhase)}<p class="analysis-meta muted">${escape(result.model)} · ${escape(result.time)}${stale ? ' · 旧结果' : ' · 对应分析时快照'}</p>` : savedAutomatic ? '' : '<p class="muted">尚未生成分析结果。</p>'}`)}
      ${globalHtml}
      ${disclosure('controls', '分析设置', settings)}
      <footer class="analysis-footer"><button id="analysis-collector">牌局获取器</button><button id="analysis-history">整场记录</button></footer>
      </section>`;
    // Native disclosure toggles already update the DOM; do not rebuild the form
    // on the next status update just to reflect the same open attribute.
    const renderKey = markup.replace(/(<details data-section="[^"]+")\s*(?:open)?\s*>/g, '$1>');
    if (rendered.get(container) !== renderKey) { container.innerHTML = markup; rendered.set(container, renderKey); }
    const $ = id => container.querySelector('#' + id);
    wireDiscussions($, render);
    if (inputState) { const input = $(inputState.id); input?.focus?.({ preventScroll: true }); input?.setSelectionRange?.(inputState.start, inputState.end); }
    for (const [scope, message] of [['automatic', failure], ['global', globalFailure]]) {
      if (message && modelFailures[scope]?.error === message) $('model-failure-' + scope).onclick = () => {
        modelFailureExpanded[scope] = !modelFailureExpanded[scope]; render();
      };
    }
    if (modeControls) {
      $('analysis-mode-live').onclick = () => current.onMode('live');
      $('analysis-mode-replay').onclick = () => current.onMode('replay');
    }
    if (replay && recordCount) {
      $('analysis-replay-seat').value = Number.isInteger(current.selfSeat) ? String(current.selfSeat) : '';
      $('analysis-replay-seat').onchange = e => current.onSelfSeat?.(e.target.value === '' ? null : Number(e.target.value));
      $('analysis-replay-cursor').onchange = e => current.onCursor?.(Number(e.target.value));
      $('analysis-replay-start').onclick = () => current.onRoundStart?.();
      $('analysis-replay-prev').onclick = () => { if (cursor > 0) current.onCursor?.(cursor - 1); };
      $('analysis-replay-next').onclick = () => { if (cursor < recordCount) current.onCursor?.(cursor + 1); };
    }
    const section = container.querySelector('.analysis'); if (section) section.scrollTop = oldScroll;
    for (const detail of container.querySelectorAll?.('details[data-section]') || []) { detail.open = !!detailsState[detail.dataset.section]; detail.ontoggle = () => { detailsState[detail.dataset.section] = detail.open; }; }
    focusTiles.forEach((tile, index) => { $('model-candidate-' + index).onclick = () => { focusTile = tile; focusExpanded = false; render(); }; });
    focusResizeObserver?.disconnect(); focusResizeObserver = null;
    if (focusTile) {
      const text = $('model-focus-text'), toggle = $('model-focus-toggle');
      const updateOverflow = () => { toggle.hidden = !focusExpanded && !(text.scrollHeight > text.clientHeight + 1); };
      toggle.onclick = () => { focusExpanded = !focusExpanded; render(); };
      updateOverflow();
      if (typeof ResizeObserver === 'function') { focusResizeObserver = new ResizeObserver(updateOverflow); focusResizeObserver.observe(text); }
    }
    $('analysis-calibrate').onclick = () => { if (current?.hintsReady) current.onCalibrateHints?.(); };
    $('analysis-collector').onclick = () => current?.onCollector?.();
    $('analysis-history').onclick = () => current?.onHistory?.();
    $('model-settings').onclick = event => { if (event.isTrusted) send({ type: 'model:settings' }).catch(() => { failure = '扩展连接失效，请刷新游戏。'; render(); }); };
    $('model-refresh').onclick = refresh;
    for (const key of ['danger', 'efficiency', 'strategy']) $('feature-' + key).onchange = e => { if (e.isTrusted) changePreferences({ [key]: e.target.checked }); };
    $('model-auto').onchange = e => { if (e.isTrusted) changePreferences({ automatic: e.target.checked }); };
    $('model-use').onchange = e => { if (e.isTrusted) changePreferences({ useModel: e.target.checked }); };
    $('model-preset').onclick = e => { if (e.isTrusted) changePreferences({ danger: true, efficiency: true, strategy: true }); };
    $('model-from-turn').value = preferences.modelFromTurn === 1 ? '1' : '7';
    $('model-from-turn').onchange = e => { if (e.isTrusted) changePreferences({ modelFromTurn: Number(e.target.value) === 1 ? 1 : 7 }); };
    for (const [id, key, min, max] of [['model-turn-number', 'modelFromTurn', 2, 18], ['model-interval', 'interval', 1, 60], ['model-limit', 'limit', 1, 100]]) {
      if (key === 'modelFromTurn' && preferences.modelFromTurn === 1) continue;
      $(id).onchange = e => { if (e.isTrusted) changePreferences({ [key]: Math.min(max, Math.max(min, Math.trunc(Number(e.target.value)) || min)) }); };
    }
    $('model-preview').onclick = () => { preview = !preview; render(); };
    if (provider === 'chat' && preferences.useModel) $('model-question').oninput = event => { questionDraft = String(event.target.value || '').slice(0, 4000); };
    if (globalBusy) $('model-cancel').onclick = event => { if (event.isTrusted) { cancelWork(); globalFailure = '已取消分析。'; render(); } };
    $('model-run').onclick = event => { if (event.isTrusted && preferencesLoaded) return runAnalysis(); };
    if (selectedSnapshot && context?.mode === 'live') {
      const nextRound = JSON.stringify([context?.contextIdentity, selectedSnapshot.game?.round, selectedSnapshot.game?.honba]);
      if (nextRound !== roundKey || (selectedSnapshot.rivers?.find(r => r.seat === selectedSnapshot.selfSeat)?.discards.length || 0) < previousDiscards) { roundKey = nextRound; autoCalls = 0; lastAutoKey = ''; }
      previousDiscards = selectedSnapshot.rivers?.find(r => r.seat === selectedSnapshot.selfSeat)?.discards.length || 0;
    }
    try { scheduleAnalysis(selectedSnapshot); } catch (_) { /* Missing or invalid hands wait for a valid decision. */ }
  }
  globalThis.MJAnalysisPanel = { mount, destroy };
})();
