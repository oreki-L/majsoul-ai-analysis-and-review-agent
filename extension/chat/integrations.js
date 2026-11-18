(function (root) {
  'use strict';
  const Review = typeof module !== 'undefined' && module.exports ? require('../postgame-review.js') : root.MJPostgameReview;
  const KEY = 'chatIntegrationsV1', HISTORY = 'roundHistoryV1';
  const DUE = 'chat-delivery-due', WATCH = 'chat-delivery-watch';
  const SHARE = 'app.majsoul.review.summary.shared.v1', TEST = 'app.majsoul.integration.test.v1';
  const COMPLETE = 'app.majsoul.match.completed.v1', MAX_PENDING = 20, SEND_TTL = 24 * 60 * 60 * 1000;
  const END_REASONS = { Hule: 'win', NoTile: 'exhaustive_draw', LiuJu: 'abortive_draw' };
  const TTL = 15 * 60 * 1000, MAX_TARGETS = 12;
  const initial = () => ({ enabled: false, destinations: [], source: null, draft: null });
  const settled = snapshot => snapshot?.phase === 'ended' && ['Hule', 'NoTile', 'LiuJu'].includes(snapshot.result?.kind);
  const roundKey = snapshot => JSON.stringify([snapshot?.round?.wind, snapshot?.round?.index, snapshot?.honba]);
  const permissionPattern = url => {
    const endpoint = new URL(url);
    return `https://${endpoint.hostname}/*`;
  };

  function matchResult(match) {
    const first = match.rounds[0]?.snapshot, last = match.rounds.at(-1)?.snapshot;
    const playerCount = first?.startScores?.length, result = last?.result;
    if (!match.id.startsWith('live-') || match.source !== 'live' || !match.closed || match.droppedRounds ||
        first?.round?.wind !== 0 || first.round.index !== 0 || first.honba !== 0 || ![3, 4].includes(playerCount) ||
        !settled(last) || result.gameEnded !== true || !match.rounds.every(({ snapshot }) => snapshot?.source === 'live' &&
          settled(snapshot) && snapshot.startScores?.length === playerCount && snapshot.turnProgress?.status === 'known')) return null;
    const scores = result.scores;
    const finalScores = result.kind !== 'LiuJu' && result.scoresKnown === true && Array.isArray(scores) && scores.length === playerCount &&
      scores.every(score => Number.isSafeInteger(score) && Math.abs(score) <= 1000000) ? scores : undefined;
    return { playerCount, roundCount: match.rounds.length, endReason: END_REASONS[result.kind], ...(finalScores ? { finalScores } : {}) };
  }

  function project(records, history, groupKey) {
    if (typeof groupKey !== 'string' || groupKey.length > 512) return null;
    const group = Review.groups(records).find(value => value.key === groupKey);
    if (!group?.matchId) return null;
    const match = history.find(value => value.id === group.matchId);
    if (!match || !['live', 'replay'].includes(match.source) || !Array.isArray(match.rounds)) return null;
    const last = match.rounds.at(-1)?.snapshot;
    if (match.source === 'live' && (!match.id.startsWith('live-') || match.closed !== true ||
      last?.source !== 'live' || !settled(last) || last.result.gameEnded !== true)) return null;
    if (match.source === 'replay' && !/^replay-[a-f0-9]{64}$/.test(match.id)) return null;
    const eligible = new Set(match.rounds.map(round => round.snapshot)
      .filter(snapshot => settled(snapshot) && snapshot.source === match.source).map(roundKey));
    const rounds = new Set(), decisions = new Set(), topics = new Set();
    for (const record of group.records) {
      const snapshot = record.snapshot, game = snapshot.game;
      if (decisions.has(record.id) || snapshot.source !== match.source || !game || !eligible.has(roundKey(game))) continue;
      decisions.add(record.id);
      rounds.add(roundKey(game));
      const result = record.analysis.result;
      if (['attack', 'defend', 'fold'].includes(result.decision?.action) || result.danger?.length) topics.add('strategy');
      if (result.efficiency?.length || record.analysis.localAnalysis?.efficiency) topics.add('efficiency');
      if (game.players?.some(player => player.riichi === true || player.melds?.length) ||
        snapshot.rivers?.some(river => river.discards?.some(discard => discard.riichi === true))) topics.add('calls');
      if (record.chat?.length) topics.add('questions');
    }
    return decisions.size ? { scope: 'retained-decisions', roundCount: rounds.size, decisionCount: decisions.size,
      topics: ['strategy', 'efficiency', 'calls', 'questions'].filter(topic => topics.has(topic)) } : null;
  }

  function create({ storage, discussions, deliveryApi, indexedDB, fetchRequest, permissions, alarms, runtime,
    storageReady, clock = Date.now, uuid = () => root.crypto.randomUUID() }) {
    let state, loading, commands = Promise.resolve(), pumping, paused = false, changingTarget, permissionRevision = 0, changingSubscription = false;
    const activeRequests = new Set();
    const load = () => state ? Promise.resolve(state) : (loading ||= Promise.resolve(storageReady)
      .then(() => storage.get(KEY)).then(values => (state = values[KEY] || initial())).finally(() => { loading = null; }));
    const save = async (update, companion = {}) => {
      const next = { ...state, ...update };
      await storage.set({ ...companion, [KEY]: next });
      state = next;
    };
    const serial = action => {
      const result = commands.then(load).then(action);
      commands = result.catch(() => {});
      return result;
    };
    const hasPermission = async url => (await permissions.contains({ origins: [permissionPattern(url)] })) === true;
    const canPump = () => state?.enabled === true && !paused;
    const currentTarget = id => canPump() && id !== changingTarget ? state.destinations.find(target => target.id === id) : null;
    const resolveDestination = async id => {
      await load();
      return currentTarget(id) || null;
    };
    const activeScope = (scope, id, version) => scope === undefined || (!changingSubscription && state.subscription?.id === scope &&
      state.subscription.target.id === id && state.subscription.target.version === version);
    async function authorizeDispatch(destination, timeout, send, scope) {
      const { id, version, url } = destination;
      let revision, allowed;
      do {
        if (timeout.aborted) return { status: 'failed', code: 'preflight_failed' };
        revision = permissionRevision;
        allowed = await hasPermission(url);
      } while (revision !== permissionRevision);
      const current = currentTarget(id);
      if (!current?.enabled || current.version !== version || current.url !== url || !activeScope(scope, id, version)) return { status: 'failed', code: 'destination_changed' };
      if (!allowed) return { status: 'failed', code: 'permission_denied' };
      const controller = new AbortController(), active = { id, url, scope, controller };
      const signal = AbortSignal.any([timeout, controller.signal]);
      activeRequests.add(active);
      try { return await send(signal); } finally { activeRequests.delete(active); }
    }
    const queue = deliveryApi.create({ indexedDB, clock, resolveDestination, hasPermission, fetchRequest, canPump, authorizeDispatch });
    const stop = id => {
      for (const active of activeRequests) if (id === undefined || active.id === id) active.controller.abort();
    };
    async function stopSubscription(update) {
      changingSubscription = true;
      for (const active of activeRequests) if (active.scope) active.controller.abort();
      try { await save({ subscription: null, matchPending: [], ...update }); } finally { changingSubscription = false; }
    }
    const pauseTransport = async action => {
      paused = true;
      stop();
      try { return await action(); } finally { paused = false; }
    };
    const updateTarget = async (id, action) => {
      changingTarget = id;
      stop(id);
      try { return await action(); } finally { changingTarget = undefined; }
    };
    async function schedule() {
      if (!alarms) return;
      await load();
      if (!state.enabled) {
        await Promise.all([alarms.clear(DUE), alarms.clear(WATCH)]);
        return;
      }
      if (!await alarms.get(WATCH)) await alarms.create(WATCH, { periodInMinutes: 1 });
      const due = await queue.nextDue();
      if (Number.isFinite(due)) await alarms.create(DUE, { when: Math.max(clock() + 1000, due) });
      else await alarms.clear(DUE);
    }
    function wake() {
      if (pumping) return pumping;
      pumping = (async () => {
        await serial(flushMatches);
        if (!canPump()) return;
        await queue.pump();
      })().catch(() => {}).finally(() => {
        pumping = null;
        schedule().catch(() => {});
      });
      return pumping;
    }
    async function ready() {
      await schedule();
      await wake();
    }
    const readSummary = async groupKey => {
      const [records, history] = await Promise.all([discussions.list(), storage.get(HISTORY)]);
      return project(records, history[HISTORY] || [], groupKey);
    };
    const fail = (code, error) => ({ ok: false, code, error });
    const disabled = () => fail('disabled', '请先在扩展设置开启聊天分享。');
    const unavailable = () => fail('unavailable', '没有可核实的赛后留存摘要。');
    const changed = () => fail('changed', '摘要或目标已变化，请刷新预览后再确认。');
    const expired = draft => !draft || draft.expiresAt <= clock();
    const newDraft = (groupKey, preview) => ({ id: uuid(), groupKey, preview, expiresAt: clock() + TTL });
    const queueResult = result => {
      if (result?.ok !== true) return fail(result?.code === 'queue_full' ? 'queue_full' : 'failed',
        result?.code === 'queue_full' ? '投递队列已满，请清理后重试。' : '未能写入投递队列，请稍后重试。');
      return { ok: true };
    };
    const usableTarget = target => target?.enabled === true && hasPermission(target.url);
    const event = (type, data, id = uuid()) => ({ specversion: '1.0', id, source: state.source, type,
      time: new Date(clock()).toISOString(), datacontenttype: 'application/json', data });
    const targetRef = ({ id, version }) => ({ id, version });
    const sourceRef = sender => Number.isInteger(sender?.tab?.id) && typeof sender.documentId === 'string' && sender.documentId
      ? { tabId: sender.tab.id, documentId: sender.documentId } : null;
    const sameSource = (left, right) => !!left && !!right && left.tabId === right.tabId && left.documentId === right.documentId;

    async function offerSource(sender) {
      const outcome = await serial(async () => {
        if (!state.enabled) return disabled();
        const source = sourceRef(sender);
        if (!source) return fail('unavailable', '无法识别游戏标签，请更新浏览器。');
        const id = uuid();
        await save({ sourceOffer: { id, source, expiresAt: clock() + TTL } });
        return { ok: true, id };
      });
      if (!outcome.ok) return outcome;
      try { await runtime.openOptionsPage(); } catch (_) {
        await serial(async () => { if (state.sourceOffer?.id === outcome.id) await save({ sourceOffer: null }); });
        return fail('options', '无法打开扩展设置页。');
      }
      return { ok: true };
    }

    async function persistHistory(matches, match, matchStart, sender) {
      const history = { [HISTORY]: matches };
      const queued = await serial(async () => {
        const subscription = state.subscription;
        const data = state.enabled && sameSource(sourceRef(sender), subscription?.source) &&
          matchStart === match.startedAt && matchStart > subscription.since && matchStart <= clock() && matchResult(match);
        if (!data) { await storage.set(history); return false; }
        const now = clock(), previous = state.matchPending || [], pending = previous.filter(item => item.expiresAt > now);
        const missed = (state.matchMissed || 0) + previous.length - pending.length;
        if (pending.length >= MAX_PENDING) {
          await save({ matchMissed: missed + 1 }, history);
          return false;
        }
        await save({ matchMissed: missed, matchPending: [...pending, { event: event(COMPLETE, data), expiresAt: now + SEND_TTL,
          target: { ...subscription.target, scope: subscription.id } }] }, history);
        return true;
      });
      if (queued) wake();
    }

    async function flushMatches() {
      if (!state.enabled || !state.matchPending?.length) return;
      const remaining = [];
      let missed = state.matchMissed || 0;
      for (const item of state.matchPending) {
        const { id, version, scope } = item.target;
        if (!activeScope(scope, id, version)) continue;
        if (item.expiresAt <= clock()) { missed++; continue; }
        if (!(await queue.enqueue({ event: item.event, destinations: [item.target] }))?.ok) remaining.push(item);
      }
      if (remaining.length !== state.matchPending.length) await save({ matchPending: remaining, matchMissed: missed });
    }

    async function prepare(message) {
      const outcome = await serial(async () => {
        if (!state.enabled) return disabled();
        const preview = await readSummary(message.groupKey);
        if (!preview) return unavailable();
        const draft = newDraft(message.groupKey, preview);
        await save({ draft });
        return { ok: true, draftId: draft.id };
      });
      if (!outcome.ok) return outcome;
      try { await runtime.openOptionsPage(); } catch (_) {
        await serial(async () => { if (state.draft?.id === outcome.draftId && !state.draft.binding) await save({ draft: null }); });
        return fail('options', '无法打开扩展设置页。');
      }
      return { ok: true };
    }

    async function options(message) {
      switch (message.type) {
        case 'chat:status': {
          const destinations = await Promise.all(state.destinations.map(async ({ id, version, kind, name, enabled, url }) =>
            ({ id, version, kind, name, enabled, origin: new URL(url).origin, hasPermission: await hasPermission(url) })));
          const draft = state.draft;
          const deliveries = (await queue.list()).map(({ scope, ...delivery }) => ({ ...delivery, retryable: state.enabled &&
            activeScope(scope, delivery.destinationId, delivery.destinationVersion) &&
            ['failed', 'unknown'].includes(delivery.status) && delivery.createdAt + 24 * 60 * 60 * 1000 > clock() &&
            destinations.some(target => target.id === delivery.destinationId && target.version === delivery.destinationVersion && target.hasPermission) }));
          const subscription = state.subscription;
          return { ok: true, enabled: state.enabled, destinations, deliveries,
            matchPush: { offerId: state.enabled && !expired(state.sourceOffer) ? state.sourceOffer.id : null,
              destinationId: subscription?.target.id ?? null, pending: state.matchPending?.length || 0, missed: state.matchMissed || 0 },
            share: state.enabled && !expired(draft) && !draft.submitted ? { draftId: draft.id, preview: draft.preview } : null };
        }
        case 'chat:configure': {
          if (typeof message.enabled !== 'boolean') return fail('invalid', '开关值无效。');
          if (message.enabled === state.enabled) return { ok: true };
          if (message.enabled) {
            await save({ enabled: true, source: state.source || `urn:majsoul-agent:installation:${uuid()}` });
          } else {
            await pauseTransport(async () => {
              await save({ enabled: false, draft: null, subscription: null, sourceOffer: null, matchPending: [], matchMissed: 0,
                destinations: state.destinations.map(target => ({ ...target, version: target.version + 1 })) });
              if (!(await queue.clear())?.ok) throw new Error('Chat queue not cleared');
            });
          }
          return { ok: true };
        }
        case 'chat:save-target': {
          const input = message.target;
          const existing = state.destinations.find(target => target.id === input?.id);
          if (!input || (input.id !== undefined && !existing) || (!existing && state.destinations.length >= MAX_TARGETS) ||
            !['webhook', 'feishu'].includes(input.kind) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) {
            return fail('invalid', '目标类型、名称或数量无效。');
          }
          const sameAddress = input.url === undefined || input.url === existing?.url;
          let target;
          try {
            target = deliveryApi.normalizeDestination({ id: existing?.id || uuid(), version: existing?.version || 1, kind: input.kind,
              name: input.name.trim(), url: input.url === undefined ? existing?.url : input.url,
              secret: input.secret === undefined ? (sameAddress && existing?.kind === input.kind ? existing.secret : '') : input.secret, enabled: true });
            if (!target || new URL(target.url).hostname.includes('*')) throw new Error('Invalid destination');
          } catch (_) { return fail('invalid', '请输入有效的 HTTPS 机器人地址及所需签名密钥。'); }
          if (!await hasPermission(target.url)) return fail('permission', '尚未授予该 HTTPS 主机权限。');
          if (existing && ['kind', 'name', 'url', 'secret'].every(key => existing[key] === target[key])) return { ok: true };
          if (existing) target.version++;
          const write = () => {
            const update = { destinations: [...state.destinations.filter(value => value.id !== target.id), target] };
            return state.subscription?.target.id === target.id ? stopSubscription(update) : save(update);
          };
          if (existing) await updateTarget(target.id, write); else await write();
          return { ok: true };
        }
        case 'chat:remove-target': {
          if (state.destinations.some(target => target.id === message.id)) {
            const update = { destinations: state.destinations.filter(target => target.id !== message.id) };
            await updateTarget(message.id, () => state.subscription?.target.id === message.id ? stopSubscription(update) : save(update));
          }
          return { ok: true };
        }
        case 'chat:discard-share': {
          if (state.draft?.id === message.draftId) await save({ draft: null });
          return { ok: true };
        }
        case 'chat:clear': {
          return pauseTransport(async () => {
            await save({ draft: null, matchPending: [], matchMissed: 0 });
            return queueResult(await queue.clear());
          });
        }
        case 'chat:test': {
          if (!state.enabled) return disabled();
          const target = state.destinations.find(value => value.id === message.id);
          if (!await usableTarget(target)) return fail('permission', '目标不存在或权限已撤销。');
          return queueResult(await queue.enqueue({ event: event(TEST, {}), destinations: [targetRef(target)] }));
        }
        case 'chat:retry': {
          if (!state.enabled) return disabled();
          if (typeof message.id !== 'string' || !message.id || message.id.length > 512) return fail('invalid', '无效的投递编号。');
          const delivery = (await queue.list()).find(value => value.id === message.id);
          const target = delivery && state.destinations.find(value => value.id === delivery.destinationId && value.version === delivery.destinationVersion);
          if (delivery && !activeScope(delivery.scope, delivery.destinationId, delivery.destinationVersion)) return changed();
          if (!await usableTarget(target)) return fail('permission', '目标已变化或权限已撤销。');
          const result = await queue.retry(message.id);
          if (result === false || result?.ok === false || result?.retried === false) return fail('unavailable', '该投递无法重试。');
          return { ok: true };
        }
        case 'chat:subscribe-match': {
          if (!state.enabled) return disabled();
          const offer = state.sourceOffer;
          if (expired(offer) || offer.id !== message.offerId) return changed();
          const target = state.destinations.find(value => value.id === message.destinationId && value.version === message.destinationVersion);
          if (!await usableTarget(target)) return fail('permission', '目标不存在或权限已撤销。');
          if (expired(offer)) return changed();
          await stopSubscription({ sourceOffer: null, subscription: { id: uuid(), source: offer.source, target: targetRef(target), since: clock() } });
          return { ok: true };
        }
        case 'chat:unsubscribe-match': {
          await stopSubscription({ sourceOffer: null });
          return { ok: true };
        }
        case 'chat:confirm-share': {
          if (!state.enabled) return disabled();
          const draft = state.draft;
          if (expired(draft) || draft.id !== message.draftId) return changed();
          const sameTarget = draft.binding?.target.id === message.destinationId && draft.binding?.target.version === message.destinationVersion;
          if (draft.submitted) return sameTarget ? { ok: true, duplicate: true } : changed();
          if (draft.binding && !sameTarget) return changed();
          const target = state.destinations.find(value => value.id === message.destinationId && value.version === message.destinationVersion);
          if (!target) return changed();
          if (!await usableTarget(target)) return fail('permission', '目标权限已撤销。');
          const preview = await readSummary(draft.groupKey);
          if (!preview || JSON.stringify(preview) !== JSON.stringify(draft.preview)) {
            await save({ draft: preview && !draft.binding ? newDraft(draft.groupKey, preview) : null });
            return changed();
          }
          if (expired(draft)) return changed();
          const binding = draft.binding || { event: event(SHARE, preview, draft.id), target: targetRef(target) };
          if (!draft.binding) await save({ draft: { ...draft, binding } });
          const queued = queueResult(await queue.enqueue({ event: binding.event, destinations: [binding.target] }));
          if (!queued.ok) return queued;
          await save({ draft: { ...draft, binding, submitted: true, groupKey: null } });
          return { ok: true };
        }
        default: return fail('unknown', '未知聊天分享操作。');
      }
    }

    async function handle(message, { game, optionsPage, sender }) {
      try {
        if (message.type === 'chat:prepare-share' && game) return await prepare(message);
        if (message.type === 'chat:offer-match-source' && game) return await offerSource(sender);
        if (!optionsPage || ['chat:prepare-share', 'chat:offer-match-source'].includes(message.type)) return fail('forbidden', '此操作只能在对应的可信扩展页面发起。');
        const result = await serial(() => options(message));
        if (message.type !== 'chat:status') {
          await schedule().catch(() => {});
          if (result.ok && ['chat:test', 'chat:retry', 'chat:confirm-share', 'chat:configure'].includes(message.type)) wake();
        }
        return result;
      } catch (_) { return fail('failed', '聊天分享操作失败，请稍后重试。'); }
    }

    alarms?.onAlarm.addListener(alarm => { if (alarm.name === DUE || alarm.name === WATCH) wake(); });
    runtime.onStartup?.addListener(() => { ready().catch(() => {}); });
    runtime.onInstalled?.addListener(() => { ready().catch(() => {}); });
    permissions.onRemoved?.addListener(({ origins }) => {
      if (!origins?.length) return;
      permissionRevision++;
      for (const { url, controller } of activeRequests) {
        hasPermission(url).then(allowed => { if (!allowed) controller.abort(); }).catch(() => {});
      }
    });
    return { handle, ready, persistHistory };
  }

  const api = { create, project, permissionPattern };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJChatIntegrations = api;
})(globalThis);
