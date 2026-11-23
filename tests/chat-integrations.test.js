const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { create } = require('../extension/chat/integrations.js');
const { create: createReviewSummary } = require('../extension/review-summary.js');
const { normalizeDestination } = require('../extension/chat/delivery.js');

const historyKey = 'roundHistoryV1';
const matchId = 'live-test';
const groupKey = JSON.stringify(['match', matchId]);
const preview = { scope: 'retained-decisions', roundCount: 1, decisionCount: 1, topics: ['strategy', 'calls', 'questions'] };
const secret = 'signing-secret-fixture';
const url = 'https://hooks.example.invalid/path?token=hidden';
const originPattern = 'https://hooks.example.invalid/*';
const decision = { id: 'internal-decision', context: { identity: { matchId, roundStartId: 'internal-round' } },
  snapshot: { source: 'live', selfHand: ['4m'], game: { round: { wind: 0, index: 1 }, honba: 0, players: [{ riichi: true }] } },
  analysis: { result: { decision: { action: 'attack', reasons: ['private reasoning'] } } }, chat: [{ question: 'private question' }] };
const terminal = { source: 'live', round: { wind: 0, index: 1 }, honba: 0, phase: 'ended', result: { kind: 'Hule', gameEnded: true } };
const match = { id: matchId, source: 'live', closed: true, rounds: [{ snapshot: terminal }] };
const options = { optionsPage: true };
const game = { game: true };
const matchSender = { tab: { id: 17 }, documentId: 'game-document' };
const gameSource = { ...game, sender: matchSender };
const settingsKey = 'chatIntegrationsV1';

test('an options tab can load chat status without sender.frameId; subframes and other URLs cannot', async () => {
  const handlers = [], extensionId = 'fixture-extension';
  const origin = 'chrome-extension://' + extensionId;
  const context = vm.createContext({ URL, TextEncoder, TextDecoder, AbortController, structuredClone, setTimeout, clearTimeout, performance,
    chrome: {
      storage: { local: { setAccessLevel() {}, get: async () => ({}) }, onChanged: { addListener() {} } },
      alarms: { onAlarm: { addListener() {} }, clear: async () => {} },
      permissions: { contains: async () => false },
      runtime: { id: extensionId, getURL: file => origin + '/' + file, onMessage: { addListener: fn => handlers.push(fn) } },
    } });
  context.importScripts = (...files) => {
    for (const file of files) vm.runInContext(readFileSync(require.resolve('../extension/' + file), 'utf8'), context);
    if (files.includes('chat/delivery.js')) context.MJChatDelivery = { create: () => ({ list: async () => [] }) };
  };
  vm.runInContext(readFileSync(require.resolve('../extension/background-chat.js'), 'utf8'), context);
  const sender = { id: extensionId, origin, tab: { id: 4 }, url: origin + '/options.html' };
  const status = from => new Promise(resolve => {
    const keep = handlers.some(listener => listener({ type: 'chat:status' }, from, resolve) === true);
    if (!keep) resolve(undefined);
  });
  assert.equal((await status(sender)).ok, true);
  assert.equal((await status({ ...sender, frameId: 0 })).ok, true);
  assert.equal((await status({ ...sender, frameId: 2 })).code, 'forbidden');
  assert.equal((await status({ ...sender, url: origin + '/other.html' })).code, 'forbidden');
  assert.equal((await status({ ...sender, origin: 'null' })).code, 'forbidden');
  assert.equal(await status({ ...sender, id: 'other' }), undefined);
});

function fixture() {
  const data = { [historyKey]: [match] }, deliveries = new Map(), origins = new Set();
  const alarmEntries = new Map(), eventInputs = [], network = [], checks = [], writes = [];
  let records = [decision], sequence = 0, now = 1700000000000, opened = 0, queueError = null, receiptError = false;
  let beforeDispatch, sendHook, afterSnapshot, afterMarker, afterAck, afterDiscard;
  let ackError = false, clearError = false, phaseError = false;
  const completions = new Map();
  const listeners = {};
  const deps = {
    storage: {
      get: async key => structuredClone({ [key]: data[key] }),
      set: async value => {
        if (receiptError && value.chatIntegrationsV1?.draft?.submitted) throw new Error('write interrupted');
        if (phaseError && value.chatIntegrationsV1?.clearPending === 'queue') throw new Error('phase interrupted');
        const copy = structuredClone(value);
        writes.push(copy);
        Object.assign(data, copy);
        if (copy[settingsKey]?.clearPending === 'inbox') await afterMarker?.(copy[settingsKey].clearInboxIds);
      },
    },
    readReviewSummary: createReviewSummary({ listDiscussions: async () => structuredClone(records), readHistory: async () => data[historyKey] }),
    completionInbox: {
      listCommitted: async () => { const result = structuredClone([...completions.values()]); await afterSnapshot?.(); return result; },
      ack: async id => { if (ackError) throw new Error('ack interrupted'); completions.delete(id); await afterAck?.(id); },
      discardPending: async () => { completions.clear(); await afterDiscard?.(); },
      subscribe: listener => { listeners.completion = listener; },
    },
    clock: () => now, uuid: () => `uuid-${++sequence}`,
    fetchRequest: async (targetUrl, config) => { network.push(targetUrl); return sendHook?.(config); },
    permissions: { contains: async ({ origins: values }) => { checks.push(values); return values.length === 1 && origins.has(values[0]); },
      onRemoved: { addListener: listener => { listeners.removed = listener; } } },
    runtime: { openOptionsPage: async () => { opened++; }, onStartup: { addListener: listener => { listeners.startup = listener; } } },
    alarms: { get: async name => alarmEntries.get(name), create: async (name, config) => alarmEntries.set(name, config),
      clear: async name => alarmEntries.delete(name), onAlarm: { addListener: listener => { listeners.alarm = listener; } } },
    deliveryApi: { normalizeDestination, create({ resolveDestination, hasPermission, fetchRequest, authorizeDispatch, canPump }) {
      return {
        enqueue: async ({ expiresAt, ...input }) => {
          if (queueError) return { ok: false, code: queueError };
          eventInputs.push(structuredClone(input));
          const { event, destinations: [target] } = input;
          if (!deliveries.has(event.id)) deliveries.set(event.id, { id: event.id, destinationId: target.id,
            destinationVersion: target.version, scope: target.scope, createdAt: now, expiresAt: expiresAt ?? now + sendTtl, status: 'pending' });
          return { ok: true };
        },
        pump: async () => {
          for (const row of deliveries.values()) {
            if (!canPump()) break;
            if (row.status !== 'pending') continue;
            const target = await resolveDestination(row.destinationId);
            if (target?.version !== row.destinationVersion || !await hasPermission(target.url)) { row.status = 'failed'; continue; }
            await beforeDispatch?.();
            try {
              const outcome = await authorizeDispatch(target, new AbortController().signal, async signal => {
                await fetchRequest(target.url, { signal });
                return { status: 'accepted' };
              }, row.scope, row.expiresAt);
              row.status = outcome.status;
            } catch (_) { row.status = 'failed'; }
          }
        },
        list: async ({ includeDeadline = false } = {}) => [...deliveries.values()]
          .map(({ expiresAt, ...row }) => includeDeadline ? { ...row, expiresAt } : row),
        nextDue: async () => [...deliveries.values()].some(row => row.status === 'pending') ? now : null,
        retry: async id => {
          const row = deliveries.get(id);
          if (!row || !['failed', 'unknown'].includes(row.status) || row.expiresAt <= now) return { ok: false };
          row.status = 'pending';
          return { ok: true };
        },
        clear: async () => { if (clearError) return { ok: false }; deliveries.clear(); return { ok: true }; },
      };
    } },
  };
  let app = create(deps);
  const call = (type, payload, sender = options) => app.handle({ type: 'chat:' + type, ...payload }, sender);
  const status = () => call('status');
  const prepare = (extra = {}) => call('prepare-share', { groupKey, ...extra }, game);
  const publish = (record, notify = true) => { completions.set(record.id, record); if (notify) listeners.completion(); };
  return { data, eventInputs, deliveries, network, checks, alarmEntries, origins, listeners, call, status, prepare, writes, completions, publish,
    clock: () => now,
    ready: () => app.ready(), restart: () => { app = create(deps); }, opened: () => opened,
    setRecords: value => { records = value; }, advance: millis => { now += millis; }, rejectQueue: value => { queueError = value; },
    rejectReceipt: value => { receiptError = value; }, beforeDispatch: hook => { beforeDispatch = hook; }, sendHook: hook => { sendHook = hook; },
    afterSnapshot: hook => { afterSnapshot = hook; }, afterMarker: hook => { afterMarker = hook; },
    afterAck: hook => { afterAck = hook; }, afterDiscard: hook => { afterDiscard = hook; },
    rejectAck: value => { ackError = value; }, rejectClear: value => { clearError = value; }, rejectClearPhase: value => { phaseError = value; } };
}

async function enable(fixture, target = {}) {
  fixture.origins.add(originPattern);
  assert.equal((await fixture.call('configure', { enabled: true })).ok, true);
  assert.equal((await fixture.call('save-target', { target: { kind: 'webhook', name: 'Example', url, secret, ...target } })).ok, true);
  return (await fixture.status()).destinations[0];
}
const ref = (draft, target) => ({ draftId: draft.draftId, destinationId: target.id, destinationVersion: target.version });

const matchRef = (offerId, target) => ({ offerId, destinationId: target.id, destinationVersion: target.version });

async function bindMatch(subject, target) {
  assert.deepEqual(await subject.call('offer-match-source', {}, gameSource), { ok: true });
  const { offerId } = (await subject.status()).matchPush;
  assert.ok(offerId);
  assert.equal((await subject.call('subscribe-match', matchRef(offerId, target))).ok, true);
  return subject.data[settingsKey].subscription.id;
}

const matchData = { playerCount: 4, roundCount: 2, endReason: 'win', finalScores: [36000, 28000, 22000, 14000] };
const sendTtl = 24 * 60 * 60 * 1000;
const completeType = 'app.majsoul.match.completed.v1';
const completion = (subject, overrides = {}) => ({ version: 1, id: 'completion-1', observedStartAt: subject.clock(),
  committedAt: subject.clock(), sourceRef: { tabId: matchSender.tab.id, documentId: matchSender.documentId }, data: matchData, ...overrides });
const envelope = (subject, record) => ({ specversion: '1.0', id: record.id, source: subject.data[settingsKey].source,
  type: completeType, time: new Date(record.committedAt).toISOString(), datacontenttype: 'application/json', data: matchData });

test('trusted options selects the target; game sees no preview, and confirmation is idempotent', async () => {
  const subject = fixture();
  assert.equal((await subject.status()).enabled, false);
  assert.equal((await subject.prepare()).code, 'disabled');
  assert.equal((await subject.call('status', {}, game)).code, 'forbidden');
  assert.equal((await subject.call('prepare-share', { groupKey })).code, 'forbidden');
  assert.equal((await subject.call('configure', { enabled: true }, game)).code, 'forbidden');
  const target = await enable(subject);
  assert.deepEqual(await subject.prepare({ destinationId: 'attacker', preview: { account: 'private' }, url: 'https://attacker.invalid/' }), { ok: true });
  assert.equal(subject.opened(), 1);
  const status = await subject.status();
  assert.deepEqual(status.share.preview, preview);
  assert.deepEqual(target, { id: target.id, version: 1, name: 'Example', kind: 'webhook', origin: 'https://hooks.example.invalid', enabled: true, hasPermission: true });
  assert.doesNotMatch(JSON.stringify(status), /internal-|signing-secret|\/path|hidden|private|live-test/);
  assert.equal(subject.eventInputs.length, 0);
  const input = ref(status.share, target);
  assert.equal((await subject.call('confirm-share', input, game)).code, 'forbidden');
  const results = await Promise.all([subject.call('confirm-share', { ...input, event: 'injected', url: 'https://attacker.invalid/' }), subject.call('confirm-share', input)]);
  assert.deepEqual(results, [{ ok: true }, { ok: true, duplicate: true }]);
  assert.deepEqual(subject.eventInputs[0].destinations, [{ id: target.id, version: 1 }]);
  assert.deepEqual(subject.eventInputs[0].event.data, preview);
  assert.equal(subject.eventInputs[0].event.type, 'app.majsoul.review.summary.shared.v1');
  assert.equal(subject.eventInputs.length, 1);
  await subject.ready();
  assert.deepEqual(subject.network, [url]);
  assert.equal((await subject.status()).share, null);
});

test('changed summaries and destination versions require a new confirmation; cancelled or expired drafts cannot enqueue', async () => {
  const subject = fixture();
  const target = await enable(subject);
  await subject.prepare();
  const original = (await subject.status()).share;
  subject.setRecords([decision, { ...decision, id: 'added' }]);
  assert.equal((await subject.call('confirm-share', ref(original, target))).code, 'changed');
  const updated = (await subject.status()).share;
  assert.notEqual(updated.draftId, original.draftId);
  assert.equal(updated.preview.decisionCount, 2);
  await subject.call('save-target', { target: { ...target, name: 'Renamed' } });
  assert.equal((await subject.call('confirm-share', ref(updated, target))).code, 'changed');
  const renamed = (await subject.status()).destinations[0];
  assert.equal(renamed.version, 2);
  await subject.call('discard-share', { draftId: updated.draftId });
  assert.equal((await subject.call('confirm-share', ref(updated, renamed))).code, 'changed');
  await subject.prepare();
  const latest = (await subject.status()).share;
  subject.advance(15 * 60 * 1000);
  assert.equal((await subject.call('confirm-share', ref(latest, renamed))).code, 'changed');
  assert.equal(subject.eventInputs.length, 0);
});

test('a queue error is not success and restart resumes only the same bound delivery', async () => {
  const subject = fixture();
  const target = await enable(subject);
  await subject.prepare();
  const input = ref((await subject.status()).share, target);
  subject.rejectQueue('queue_full');
  assert.equal((await subject.call('confirm-share', input)).code, 'queue_full');
  assert.equal(subject.deliveries.size, 0);
  subject.rejectQueue(null);
  subject.rejectReceipt(true);
  assert.equal((await subject.call('confirm-share', input)).code, 'failed');
  assert.equal(subject.deliveries.size, 1);
  subject.rejectReceipt(false);
  subject.restart();
  assert.equal((await subject.call('confirm-share', { ...input, destinationVersion: 2 })).code, 'changed');
  assert.equal((await subject.call('confirm-share', input)).ok, true);
  assert.deepEqual(subject.eventInputs[0], subject.eventInputs[1]);
  assert.equal(subject.deliveries.size, 1);
  await subject.ready();
});

test('permission checked both at save and confirm; revoke or disable blocks a pending dispatch', async () => {
  const subject = fixture();
  assert.equal((await subject.call('save-target', { target: { kind: 'webhook', name: 'Example', url, secret } })).code, 'permission');
  const target = await enable(subject);
  assert.ok(subject.alarmEntries.has('chat-delivery-watch'));
  assert.equal((await subject.call('save-target', { target: { kind: 'webhook', name: 'Wildcard', url: 'https://*.example.invalid/', secret } })).code, 'invalid');
  await subject.prepare();
  const input = ref((await subject.status()).share, target);
  subject.origins.delete(originPattern);
  assert.equal((await subject.call('confirm-share', input)).code, 'permission');
  subject.origins.add(originPattern);
  let release, entered;
  const dispatched = new Promise(resolve => { entered = resolve; });
  subject.beforeDispatch(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  assert.equal((await subject.call('confirm-share', input)).ok, true);
  await dispatched;
  subject.origins.delete(originPattern);
  subject.listeners.removed({ origins: [originPattern] });
  assert.equal((await subject.call('configure', { enabled: false })).ok, true);
  release();
  await subject.ready();
  subject.listeners.alarm({ name: 'chat-delivery-watch' });
  assert.equal(subject.network.length, 0);
  assert.equal(subject.deliveries.size, 0);
  assert.equal((await subject.status()).share, null);
  assert.equal(subject.alarmEntries.size, 0);
  assert.ok(subject.checks.every(value => value.length === 1 && value[0] === originPattern));
});

test('automatic match push is off by default and a game source offer requires trusted settings confirmation', async () => {
  const subject = fixture();
  assert.equal((await subject.call('offer-match-source', {}, gameSource)).code, 'disabled');
  assert.equal(subject.opened(), 0);
  subject.publish(completion(subject));
  await subject.ready();
  assert.equal(subject.completions.size, 0);
  const target = await enable(subject);
  assert.equal((await subject.call('offer-match-source', {}, options)).code, 'forbidden');
  assert.equal((await subject.call('offer-match-source', {}, game)).code, 'unavailable');
  assert.equal((await subject.call('subscribe-match', matchRef('missing-offer', target))).code, 'changed');
  assert.deepEqual(await subject.call('offer-match-source', { destinationId: target.id }, gameSource), { ok: true });
  assert.equal(subject.opened(), 1);
  const { offerId, destinationId } = (await subject.status()).matchPush;
  assert.ok(offerId);
  assert.equal(destinationId, null);
  const input = matchRef(offerId, target);
  assert.equal((await subject.call('subscribe-match', input, gameSource)).code, 'forbidden');
  assert.equal((await subject.call('subscribe-match', { ...input, destinationVersion: target.version + 1 })).code, 'permission');
  subject.origins.delete(originPattern);
  assert.equal((await subject.call('subscribe-match', input)).code, 'permission');
  subject.origins.add(originPattern);
  subject.advance(1);
  subject.publish(completion(subject));
  await subject.ready();
  assert.deepEqual(subject.eventInputs, []);
  assert.deepEqual(subject.network, []);
  assert.equal((await subject.call('subscribe-match', input)).ok, true);
  assert.deepEqual((await subject.status()).matchPush, { offerId: null, destinationId: target.id, pending: 0, missed: 0 });
  assert.equal((await subject.call('subscribe-match', input)).code, 'changed');
});

test('match push consumes only fresh committed events from the bound tab and document', async () => {
  const subject = fixture();
  const target = await enable(subject);
  const boundAt = subject.clock();
  const scope = await bindMatch(subject, target);
  subject.advance(2);
  const candidate = completion(subject, { observedStartAt: boundAt + 1 });
  for (const [label, overrides] of [
    ['wrong tab', { sourceRef: { ...candidate.sourceRef, tabId: 18 } }],
    ['wrong document', { sourceRef: { ...candidate.sourceRef, documentId: 'new-document' } }],
    ['missing document', { sourceRef: { tabId: 17 } }],
    ['before binding', { observedStartAt: boundAt - 1 }],
    ['at binding', { observedStartAt: boundAt }],
    ['opening after commit', { observedStartAt: boundAt + 3 }],
    ['unrecognized version', { version: 2 }],
  ]) {
    subject.publish({ ...candidate, ...overrides });
    await subject.ready();
    assert.equal(subject.completions.size, 0, label);
    assert.deepEqual(subject.eventInputs, [], label);
  }

  subject.publish({ ...candidate, data: { ...candidate.data, internal: 'private-account' } });
  await subject.ready();
  assert.deepEqual(subject.eventInputs, [{ event: envelope(subject, candidate), destinations: [{ id: target.id, version: target.version, scope }] }]);
  assert.equal(subject.completions.size, 0);
  assert.ok(subject.writes.every(write => !Object.hasOwn(write, historyKey) && !write[settingsKey].matchPending?.length));
  assert.deepEqual(subject.network, [url]);

  subject.advance(1);
  const draw = completion(subject, { id: 'completion-draw', data: { playerCount: 3, roundCount: 2, endReason: 'abortive_draw' } });
  subject.publish(draw);
  await subject.ready();
  assert.deepEqual(subject.eventInputs[1]?.event.data, draw.data);
});

test('a match queue failure and an interrupted acknowledgement recover with the same event and no duplicate delivery', async () => {
  const subject = fixture();
  const target = await enable(subject);
  const scope = await bindMatch(subject, target);
  subject.advance(1);
  const candidate = completion(subject);
  subject.rejectQueue('storage_unavailable');
  subject.publish(candidate);
  await subject.ready();
  assert.equal((await subject.status()).matchPush.pending, 1);
  assert.deepEqual(subject.network, []);
  assert.equal(subject.deliveries.size, 0);

  subject.rejectQueue(null);
  subject.rejectAck(true);
  subject.advance(100);
  subject.restart();
  await subject.ready();
  assert.equal(subject.completions.size, 1);
  assert.equal(subject.deliveries.size, 1);
  subject.rejectAck(false);
  subject.advance(100);
  subject.restart();
  await subject.ready();
  const expected = { event: envelope(subject, candidate), destinations: [{ id: target.id, version: target.version, scope }] };
  assert.deepEqual(subject.eventInputs, [expected, expected]);
  assert.equal(subject.deliveries.get(candidate.id).expiresAt, candidate.committedAt + sendTtl);
  assert.equal(subject.completions.size, 0);
  assert.equal((await subject.status()).matchPush.pending, 0);
  assert.deepEqual(subject.network, [url]);
});

for (const operation of ['unsubscribe', 'edit target', 'disable', 'rebind', 'revoke']) {
  test(`match push drops the failed-queue backlog on ${operation} without re-routing it`, async () => {
    const subject = fixture();
    const target = await enable(subject);
    await bindMatch(subject, target);
    subject.advance(1);
    const candidate = completion(subject);
    subject.rejectQueue('queue_full');
    subject.publish(candidate);
    await subject.ready();
    assert.equal((await subject.status()).matchPush.pending, 1);
    if (operation === 'rebind') await bindMatch(subject, target);
    else if (operation === 'revoke') {
      subject.origins.delete(originPattern);
      subject.listeners.removed({ origins: [originPattern] });
      subject.origins.add(originPattern);
    } else {
      const changed = operation === 'unsubscribe' ? await subject.call('unsubscribe-match') : operation === 'edit target'
        ? await subject.call('save-target', { target: { ...target, name: 'Replacement', url: 'https://hooks.example.invalid/other', secret } })
        : await subject.call('configure', { enabled: false });
      assert.equal(changed.ok, true);
    }
    await subject.ready();
    subject.rejectQueue(null);
    subject.restart();
    await subject.ready();
    assert.deepEqual((await subject.status()).matchPush, { offerId: null, destinationId: operation === 'rebind' ? target.id : null, pending: 0, missed: 0 });
    assert.equal(subject.completions.size, 0);
    assert.deepEqual(subject.eventInputs, []);
    assert.deepEqual(subject.network, []);
  });
}

test('legacy migration consumes the original body, expiry and route without converting or sending stale entries', async () => {
  const subject = fixture();
  const target = await enable(subject);
  const scope = await bindMatch(subject, target);
  await subject.ready();
  const record = completion(subject, { id: 'legacy-event' });
  const event = envelope(subject, record);
  const route = { id: target.id, version: target.version, scope };
  subject.data[settingsKey].matchPending = [
    { event, target: route, expiresAt: subject.clock() + sendTtl },
    { event: { ...event, id: 'stale-version' }, target: { ...route, version: 2 }, expiresAt: subject.clock() + sendTtl },
    { event: { ...event, id: 'expired' }, target: route, expiresAt: subject.clock() },
  ];
  subject.restart();
  subject.rejectQueue('storage_unavailable');
  await subject.ready();
  assert.equal(subject.data[settingsKey].matchPending.length, 1);
  subject.rejectQueue(null);
  subject.listeners.alarm({ name: 'chat-delivery-watch' });
  await subject.ready();
  assert.deepEqual(subject.eventInputs, [{ event, destinations: [route] }]);
  assert.equal(subject.data[settingsKey].matchPending.length, 0);
  assert.equal(subject.completions.size, 0);
  assert.deepEqual(subject.network, [url]);
});

test('completion notification during a drain schedules another read; expired entries are not queued', async () => {
  const subject = fixture();
  const target = await enable(subject);
  await bindMatch(subject, target);
  await subject.ready();
  subject.advance(1);
  subject.publish(completion(subject, { id: 'expired' }), false);
  subject.advance(sendTtl);
  const fresh = completion(subject);
  subject.afterSnapshot(() => { subject.afterSnapshot(null); subject.publish(fresh); });
  await subject.ready();
  assert.equal(subject.completions.size, 0);
  assert.deepEqual(subject.eventInputs.map(input => input.event.id), [fresh.id]);
});

test('startup recovers a committed event, but a dispatch delayed past its deadline cannot send', async () => {
  const subject = fixture();
  const target = await enable(subject);
  await bindMatch(subject, target);
  await subject.ready();
  subject.advance(1);
  const record = completion(subject);
  subject.publish(record, false);
  subject.advance(sendTtl - 1);
  subject.beforeDispatch(() => { subject.advance(1); });
  subject.restart();
  subject.listeners.startup();
  await subject.ready();
  assert.equal(subject.completions.size, 0);
  assert.equal(subject.deliveries.get(record.id).status, 'expired');
  assert.deepEqual(subject.network, []);
});

test('status and retry honor the stored deadline without exposing deadline or subscription scope', async () => {
  const subject = fixture();
  const target = await enable(subject);
  await bindMatch(subject, target);
  await subject.ready();
  subject.advance(1);
  const record = completion(subject);
  subject.publish(record, false);
  subject.advance(sendTtl - 1);
  await subject.ready();
  await subject.call('test', { id: target.id });
  await subject.ready();
  const manual = [...subject.deliveries.values()].find(row => row.id !== record.id);
  const automatic = subject.deliveries.get(record.id);
  automatic.status = 'unknown';
  manual.status = 'failed';
  const statusRows = async () => (await subject.status()).deliveries;
  assert.ok((await statusRows()).every(row => row.retryable));
  subject.advance(1);
  const rows = await statusRows();
  const expired = rows.find(row => row.id === record.id);
  assert.equal(expired.retryable, false);
  assert.equal(expired.status, 'unknown');
  assert.equal(expired.createdAt, automatic.createdAt);
  assert.ok(rows.every(row => !Object.hasOwn(row, 'expiresAt') && !Object.hasOwn(row, 'scope')));
  assert.equal(rows.find(row => row.id === manual.id).retryable, true);
  assert.equal((await subject.call('retry', { id: record.id })).code, 'unavailable');
});

for (const failure of ['none', 'ack', 'phase write', 'IDB clear']) {
  test(`clear preserves completions after the snapshot and never resends old rows (failure: ${failure})`, async () => {
    const subject = fixture();
    const target = await enable(subject);
    await bindMatch(subject, target);
    subject.advance(1);
    subject.rejectAck(true);
    subject.publish(completion(subject, { id: 'old-queued' }));
    await subject.ready();
    const inputsBeforeClear = subject.eventInputs.length;
    subject.network.length = 0;
    subject.deliveries.get('old-queued').status = 'pending';
    subject.rejectAck(false);
    subject.publish(completion(subject, { id: 'old-not-queued' }), false);
    const append = id => subject.publish(completion(subject, { id }));
    subject.afterSnapshot(() => { subject.afterSnapshot(null); append('after-snapshot'); });
    subject.afterMarker(ids => { assert.deepEqual(ids, ['old-queued', 'old-not-queued']); append('after-marker'); });
    subject.afterAck(id => {
      assert.equal(id, 'old-queued');
      subject.afterAck(null);
      append('after-ack');
      if (failure === 'ack') subject.rejectAck(true);
    });
    if (failure === 'IDB clear') subject.rejectClear(true);
    if (failure === 'phase write') subject.rejectClearPhase(true);
    assert.equal((await subject.call('clear')).ok, failure === 'none');
    await subject.ready();
    if (failure !== 'none') {
      assert.deepEqual(subject.network, []);
      assert.ok(['inbox', 'queue'].includes(subject.data[settingsKey].clearPending));
      subject.rejectAck(false);
      subject.rejectClear(false);
      subject.rejectClearPhase(false);
      subject.restart();
      await subject.ready();
    }
    assert.equal(subject.completions.size, 0);
    assert.deepEqual([...subject.deliveries.keys()], ['after-snapshot', 'after-marker', 'after-ack']);
    assert.deepEqual(subject.eventInputs.slice(inputsBeforeClear).map(input => input.event.id), ['after-snapshot', 'after-marker', 'after-ack']);
    assert.deepEqual(subject.network, [url, url, url]);
  });
}

test('an unreadable snapshot falls back to the discard boundary and preserves commits after it', async () => {
  const subject = fixture();
  const target = await enable(subject);
  await bindMatch(subject, target);
  await subject.ready();
  subject.advance(1);
  subject.publish(completion(subject, { id: 'old' }), false);
  subject.afterSnapshot(() => { subject.afterSnapshot(null); throw new Error('inbox unreadable'); });
  subject.afterMarker(ids => {
    assert.equal(ids, null);
    subject.publish(completion(subject, { id: 'before-discard' }));
  });
  subject.afterDiscard(() => subject.publish(completion(subject, { id: 'after-discard' })));
  assert.equal((await subject.call('clear')).ok, true);
  await subject.ready();
  assert.equal(subject.completions.size, 0);
  assert.deepEqual(subject.eventInputs.map(input => input.event.id), ['after-discard']);
  assert.deepEqual(subject.network, [url]);
});
