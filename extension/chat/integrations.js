(function (root) {
  'use strict';
  const KEY = 'chatIntegrationsV1';
  const DUE = 'chat-delivery-due', WATCH = 'chat-delivery-watch';
  const SHARE = 'app.majsoul.review.summary.shared.v1', TEST = 'app.majsoul.integration.test.v1';
  const COMPLETE = 'app.majsoul.match.completed.v1', SEND_TTL = 24 * 60 * 60 * 1000;
  const TTL = 15 * 60 * 1000, MAX_TARGETS = 12;
  const initial = () => ({ enabled: false, destinations: [], source: null, draft: null });
  const permissionPattern = url => {
    const endpoint = new URL(url);
    return `https://${endpoint.hostname}/*`;
  };

  function create({ storage, completionInbox, readReviewSummary, deliveryApi, indexedDB, fetchRequest, permissions, alarms, runtime,
    storageReady, clock = Date.now, uuid = () => root.crypto.randomUUID() }) {
    let state, loading, commands = Promise.resolve(), pumping, wakeRequested = false, paused = false;
    let changingTarget, permissionRevision = 0, changingSubscription = false, revokedScope;
    let alarmWrites = Promise.resolve();
    const activeRequests = new Set();
    const load = () => state ? Promise.resolve(state) : (loading ||= Promise.resolve(storageReady)
      .then(() => storage.get(KEY)).then(values => (state = values[KEY] || initial())).finally(() => { loading = null; }));
    const save = async update => {
      const next = { ...state, ...update };
      await storage.set({ [KEY]: next });
      state = next;
    };
    const serial = action => {
      const result = commands.then(load).then(action);
      commands = result.catch(() => {});
      return result;
    };
    const hasPermission = async url => (await permissions.contains({ origins: [permissionPattern(url)] })) === true;
    const canPump = () => state?.enabled === true && !paused && !state.clearPending;
    const currentTarget = id => canPump() && id !== changingTarget ? state.destinations.find(target => target.id === id) : null;
    const resolveDestination = async id => {
      await load();
      return currentTarget(id) || null;
    };
    const activeScope = (scope, id, version) => scope === undefined || (!changingSubscription && scope !== revokedScope && state.subscription?.id === scope &&
      state.subscription.target.id === id && state.subscription.target.version === version);
    async function authorizeDispatch(destination, timeout, send, scope, expiresAt = Infinity) {
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
      if (expiresAt <= clock()) return { status: 'expired', code: 'delivery_expired' };
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
    const updateAlarms = action => {
      const result = alarmWrites.then(action);
      alarmWrites = result.catch(() => {});
      return alarmWrites;
    };
    const watch = () => !alarms ? Promise.resolve() : updateAlarms(async () => {
      if (state.enabled || state.clearPending) {
        if (!await alarms.get(WATCH)) await alarms.create(WATCH, { periodInMinutes: 1 });
      } else await Promise.all([alarms.clear(DUE), alarms.clear(WATCH)]);
    });
    async function scheduleDue() {
      if (!alarms || !canPump()) return;
      const due = await queue.nextDue();
      await updateAlarms(() => canPump() && Number.isFinite(due)
        ? alarms.create(DUE, { when: Math.max(clock() + 1000, due) }) : alarms.clear(DUE));
    }
    function wake() {
      wakeRequested = true;
      if (pumping) return pumping;
      pumping = (async () => {
        do {
          wakeRequested = false;
          await load();
          await watch();
          await serial(flushMatches).catch(() => {});
          if (canPump()) await queue.pump();
        } while (wakeRequested);
      })().catch(() => {}).finally(() => {
        pumping = null;
        if (wakeRequested) return wake();
        scheduleDue().catch(() => {});
      });
      return pumping;
    }
    async function ready() {
      await wake();
    }
    const readSummary = async groupKey => {
      const summary = await readReviewSummary(groupKey);
      if (summary?.version !== 1) return null;
      const { scope, roundCount, decisionCount, topics } = summary;
      return { scope, roundCount, decisionCount, topics };
    };
    const fail = (code, error) => ({ ok: false, code, error });
    const listCommitted = () => completionInbox?.listCommitted() ?? Promise.resolve([]);
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
    const event = (type, data, id = uuid(), time = clock()) => ({ specversion: '1.0', id, source: state.source, type,
      time: new Date(time).toISOString(), datacontenttype: 'application/json', data });
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

    function matchesSubscription(record) {
      const subscription = state.subscription;
      return record?.version === 1 && sameSource(record.sourceRef, subscription?.source) &&
        Number.isSafeInteger(record.observedStartAt) && Number.isSafeInteger(record.committedAt) &&
        subscription.since < record.observedStartAt && record.observedStartAt <= record.committedAt && record.committedAt <= clock();
    }

    async function enqueueMatch(outgoing, target, expiresAt) {
      const { id, version, scope } = target || {};
      if (!canPump() || !scope || !activeScope(scope, id, version) || outgoing?.type !== COMPLETE ||
          outgoing.source !== state.source || !Number.isFinite(expiresAt) || expiresAt <= clock()) return true;
      const destination = currentTarget(id);
      if (destination?.version !== version || !await usableTarget(destination) || !activeScope(scope, id, version)) return true;
      if (expiresAt <= clock()) return true;
      const result = await queue.enqueue({ event: outgoing, destinations: [target], expiresAt });
      return result?.ok === true || ['invalid_event', 'invalid_destination', 'event_conflict', 'delivery_expired'].includes(result?.code);
    }

    async function flushLegacyMatches() {
      if (!state.matchPending?.length) return;
      const remaining = [];
      let missed = state.matchMissed || 0;
      for (const item of state.matchPending) {
        if (item?.expiresAt <= clock()) { missed++; continue; }
        if (!await enqueueMatch(item?.event, item?.target, item?.expiresAt).catch(() => false)) remaining.push(item);
      }
      if (remaining.length !== state.matchPending.length) await save({ matchPending: remaining, matchMissed: missed });
    }

    async function flushCommittedMatches() {
      for (const record of await listCommitted()) {
        const expiresAt = record?.committedAt + SEND_TTL;
        if (canPump() && matchesSubscription(record) && expiresAt > clock() && typeof record.id === 'string' && record.data) {
          const { playerCount, roundCount, endReason, finalScores } = record.data;
          const outgoing = event(COMPLETE, { playerCount, roundCount, endReason,
            ...(finalScores === undefined ? {} : { finalScores }) }, record.id, record.committedAt);
          const subscription = state.subscription;
          if (!await enqueueMatch(outgoing, { ...subscription.target, scope: subscription.id }, expiresAt).catch(() => false)) continue;
        }
        if (typeof record?.id === 'string') await completionInbox.ack(record.id);
      }
    }

    async function finishClear() {
      if (state.clearPending === 'inbox') {
        if (!state.clearInboxIds) {
          // Without a readable snapshot, each successful fallback discard clears everything present at that point.
          if ((await completionInbox?.discardPending())?.ok === false) throw new Error('Chat inbox not cleared');
        } else {
          for (const id of state.clearInboxIds) await completionInbox.ack(id);
        }
        await save({ clearPending: 'queue', clearInboxIds: null });
      }
      if (state.clearPending) {
        const result = await queue.clear();
        if (!result?.ok) return result;
        await save({ clearPending: null });
      }
      return { ok: true };
    }

    async function clearDelivery(update = {}) {
      return pauseTransport(async () => {
        const clearInboxIds = await listCommitted().then(records => records.map(record => record.id)).catch(() => null);
        await save({ draft: null, matchPending: [], matchMissed: 0, ...update, clearPending: 'inbox', clearInboxIds });
        await watch();
        return finishClear();
      });
    }

    async function flushMatches() {
      if (state.clearPending) {
        if (!(await finishClear())?.ok) return;
        await watch();
      }
      const bound = state.subscription;
      if (bound) {
        const target = currentTarget(bound.target.id);
        if (bound.id === revokedScope || target?.version !== bound.target.version || !await usableTarget(target)) {
          revokedScope = bound.id;
          await stopSubscription({ sourceOffer: null });
        }
      }
      await flushLegacyMatches().catch(() => {});
      await flushCommittedMatches();
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
          const deliveries = (await queue.list({ includeDeadline: true })).map(({ scope, expiresAt, ...delivery }) => ({ ...delivery, retryable: canPump() &&
            activeScope(scope, delivery.destinationId, delivery.destinationVersion) &&
            ['failed', 'unknown'].includes(delivery.status) && expiresAt > clock() &&
            destinations.some(target => target.id === delivery.destinationId && target.version === delivery.destinationVersion && target.hasPermission && target.enabled) }));
          const subscription = state.subscription;
          const committed = await listCommitted().catch(() => []);
          const pending = canPump() && subscription && activeScope(subscription.id, subscription.target.id, subscription.target.version)
            ? committed.filter(record => matchesSubscription(record) && record.committedAt + SEND_TTL > clock()).length : 0;
          return { ok: true, enabled: state.enabled, destinations, deliveries,
            matchPush: { offerId: state.enabled && !expired(state.sourceOffer) ? state.sourceOffer.id : null,
              destinationId: subscription?.target.id ?? null, pending: pending + (state.matchPending?.length || 0), missed: state.matchMissed || 0 },
            share: state.enabled && !expired(draft) && !draft.submitted ? { draftId: draft.id, preview: draft.preview } : null };
        }
        case 'chat:configure': {
          if (typeof message.enabled !== 'boolean') return fail('invalid', '开关值无效。');
          if (message.enabled === state.enabled) return { ok: true };
          if (message.enabled) {
            await save({ enabled: true, source: state.source || `urn:majsoul-agent:installation:${uuid()}` });
          } else {
            const cleared = await clearDelivery({ enabled: false, subscription: null, sourceOffer: null,
              destinations: state.destinations.map(target => ({ ...target, version: target.version + 1 })) });
            if (!cleared?.ok) return queueResult(cleared);
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
          return queueResult(await clearDelivery());
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
        const result = await serial(async () => {
          if (message.type !== 'chat:status' && state.clearPending && !(await finishClear())?.ok) return queueResult(null);
          return options(message);
        });
        if (message.type !== 'chat:status') {
          await watch();
          wake();
        }
        return result;
      } catch (_) {
        if (state?.clearPending) wake();
        return fail('failed', '聊天分享操作失败，请稍后重试。');
      }
    }

    completionInbox?.subscribe(wake);
    alarms?.onAlarm.addListener(alarm => { if (alarm.name === DUE || alarm.name === WATCH) wake(); });
    runtime.onStartup?.addListener(() => { ready().catch(() => {}); });
    runtime.onInstalled?.addListener(() => { ready().catch(() => {}); });
    permissions.onRemoved?.addListener(({ origins }) => {
      if (!origins?.length) return;
      permissionRevision++;
      const subscription = state?.subscription;
      const target = state?.destinations.find(destination => destination.id === subscription?.target.id);
      if (target && origins.includes(permissionPattern(target.url))) revokedScope = subscription.id;
      for (const { url, scope, controller } of activeRequests) {
        if ((scope && scope === revokedScope) || origins.includes(permissionPattern(url))) controller.abort();
        else hasPermission(url).then(allowed => { if (!allowed) controller.abort(); }).catch(() => {});
      }
      serial(async () => {
        const bound = state.subscription;
        const destination = state.destinations.find(value => value.id === bound?.target.id);
        if (destination && (origins.includes(permissionPattern(destination.url)) || !await hasPermission(destination.url))) {
          revokedScope = bound.id;
          await stopSubscription({ sourceOffer: null });
        }
      }).catch(() => {}).finally(wake);
    });
    return { handle, ready };
  }

  const api = { create, permissionPattern };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJChatIntegrations = api;
})(globalThis);
