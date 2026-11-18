const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { create, project } = require('../extension/chat/integrations.js');
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
  let beforeDispatch, sendHook;
  const listeners = {};
  const deps = {
    storage: {
      get: async key => structuredClone({ [key]: data[key] }),
      set: async value => {
        if (receiptError && value.chatIntegrationsV1?.draft?.submitted) throw new Error('write interrupted');
        const copy = structuredClone(value);
        writes.push(copy);
        Object.assign(data, copy);
      },
    },
    discussions: { list: async () => structuredClone(records) }, clock: () => now, uuid: () => `uuid-${++sequence}`,
    fetchRequest: async (targetUrl, config) => { network.push(targetUrl); return sendHook?.(config); },
    permissions: { contains: async ({ origins: values }) => { checks.push(values); return values.length === 1 && origins.has(values[0]); },
      onRemoved: { addListener: listener => { listeners.removed = listener; } } },
    runtime: { openOptionsPage: async () => { opened++; } },
    alarms: { get: async name => alarmEntries.get(name), create: async (name, config) => alarmEntries.set(name, config),
      clear: async name => alarmEntries.delete(name), onAlarm: { addListener: listener => { listeners.alarm = listener; } } },
    deliveryApi: { normalizeDestination, create({ resolveDestination, hasPermission, fetchRequest, authorizeDispatch, canPump }) {
      return {
        enqueue: async input => {
          if (queueError) return { ok: false, code: queueError };
          eventInputs.push(structuredClone(input));
          const { event, destinations: [target] } = input;
          if (!deliveries.has(event.id)) deliveries.set(event.id, { id: event.id, destinationId: target.id,
            destinationVersion: target.version, scope: target.scope, createdAt: now, status: 'pending' });
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
              }, row.scope);
              row.status = outcome.status;
            } catch (_) { row.status = 'failed'; }
          }
        },
        list: async () => [...deliveries.values()], nextDue: async () => [...deliveries.values()].some(row => row.status === 'pending') ? now : null,
        retry: async id => {
          const row = deliveries.get(id);
          if (row?.status !== 'failed') return { ok: false };
          row.status = 'pending';
          return { ok: true };
        },
        clear: async () => { deliveries.clear(); return { ok: true }; },
      };
    } },
  };
  let app = create(deps);
  const call = (type, payload, sender = options) => app.handle({ type: 'chat:' + type, ...payload }, sender);
  const status = () => call('status');
  const prepare = (extra = {}) => call('prepare-share', { groupKey, ...extra }, game);
  return { data, eventInputs, deliveries, network, checks, alarmEntries, origins, listeners, call, status, prepare, writes,
    clock: () => now, persist: (candidate, startedAt, sender = matchSender) => app.persistHistory([candidate], candidate, startedAt, sender),
    ready: () => app.ready(), restart: () => { app = create(deps); }, opened: () => opened,
    setRecords: value => { records = value; }, advance: millis => { now += millis; }, rejectQueue: value => { queueError = value; },
    rejectReceipt: value => { receiptError = value; }, beforeDispatch: hook => { beforeDispatch = hook; }, sendHook: hook => { sendHook = hook; } };
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

function completedMatch(startedAt, kind = 'Hule') {
  const startScores = [25000, 25000, 25000, 25000];
  const snapshot = { ...terminal, startScores, turnProgress: { status: 'known' }, selfHand: ['private-hand'],
    result: { kind, gameEnded: true, scoresKnown: true, scores: [36000, 28000, 22000, 14000], ranking: ['private-account'] } };
  return { ...match, startedAt, rounds: [
    { snapshot: { ...snapshot, round: { wind: 0, index: 0 }, result: { ...snapshot.result, kind: 'Hule', gameEnded: false } } },
    { snapshot },
  ] };
}

test('project requires persisted matching round evidence and the full live terminal marker', () => {
  assert.deepEqual(project([decision, decision], [match], groupKey), preview);
  assert.equal(project([decision], [], groupKey), null);
  assert.equal(project([decision], [{ ...match, closed: false }], groupKey), null);
  assert.equal(project([decision], [{ ...match, rounds: [{ snapshot: { ...terminal, result: { ...terminal.result, gameEnded: false } } }] }], groupKey), null);
  assert.equal(project([decision], [{ ...match, rounds: [{ snapshot: { ...terminal, result: { kind: 'Interrupted', gameEnded: true } } }] }], groupKey), null);
  const replayId = 'replay-' + 'a'.repeat(64);
  const replay = { id: replayId, source: 'replay', rounds: [{ snapshot: { ...terminal, source: 'replay', result: { kind: 'NoTile' } } }] };
  const imported = { ...decision, snapshot: { ...decision.snapshot, source: 'replay' }, context: { identity: { matchId: replayId } } };
  assert.deepEqual(project([imported], [replay], JSON.stringify(['match', replayId])), preview);
  assert.equal(project([imported], [replay], JSON.stringify(['match', 'replay:ephemeral:1'])), null);
  assert.equal(project([decision], [{ ...match, rounds: [{ snapshot: { ...terminal, honba: 1 } }] }], groupKey), null);
});

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
  const candidate = completedMatch(subject.clock());
  assert.equal((await subject.call('offer-match-source', {}, gameSource)).code, 'disabled');
  assert.equal(subject.opened(), 0);
  await subject.persist(candidate, candidate.startedAt);
  assert.deepEqual(subject.data[historyKey], [candidate]);
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
  const unconfirmed = completedMatch(subject.clock());
  await subject.persist(unconfirmed, unconfirmed.startedAt);
  await subject.ready();
  assert.deepEqual(subject.eventInputs, []);
  assert.deepEqual(subject.network, []);
  assert.equal((await subject.call('subscribe-match', input)).ok, true);
  assert.deepEqual((await subject.status()).matchPush, { offerId: null, destinationId: target.id, pending: 0, missed: 0 });
  assert.equal((await subject.call('subscribe-match', input)).code, 'changed');
});

test('match push accepts only a post-binding complete live match from the bound tab and document', async () => {
  const subject = fixture();
  const target = await enable(subject);
  const boundAt = subject.clock();
  const scope = await bindMatch(subject, target);
  subject.advance(2);
  const candidate = completedMatch(boundAt + 1);
  const last = candidate.rounds[1].snapshot;
  const withLast = snapshot => ({ ...candidate, rounds: [candidate.rounds[0], { snapshot }] });
  for (const [label, attempt, startedAt, sender] of [
    ['wrong tab', candidate, candidate.startedAt, { ...matchSender, tab: { id: 18 } }],
    ['wrong document', candidate, candidate.startedAt, { ...matchSender, documentId: 'new-document' }],
    ['missing document', candidate, candidate.startedAt, { tab: matchSender.tab }],
    ['before binding', completedMatch(boundAt - 1), boundAt - 1],
    ['at binding', completedMatch(boundAt), boundAt],
    ['future opening', completedMatch(boundAt + 3), boundAt + 3],
    ['no continuous opening', candidate, undefined],
    ['different opening', candidate, boundAt + 2],
    ['replay', { ...candidate, id: 'replay-' + 'a'.repeat(64), source: 'replay' }, candidate.startedAt],
    ['not closed', { ...candidate, closed: false }, candidate.startedAt],
    ['missing round history', { ...candidate, droppedRounds: 1 }, candidate.startedAt],
    ['only small-round settlement', withLast({ ...last, result: { ...last.result, gameEnded: false } }), candidate.startedAt],
    ['interruption', withLast({ ...last, result: { ...last.result, kind: 'Interrupted' } }), candidate.startedAt],
    ['unknown turn progress', withLast({ ...last, turnProgress: { status: 'unknown' } }), candidate.startedAt],
  ]) {
    await subject.persist(attempt, startedAt, sender);
    await subject.ready();
    assert.deepEqual(subject.data[historyKey], [attempt], label);
    assert.deepEqual(subject.eventInputs, [], label);
  }

  await subject.persist(candidate, candidate.startedAt);
  await subject.ready();
  assert.equal(subject.eventInputs.length, 1);
  const [queued] = subject.eventInputs;
  assert.deepEqual(queued.destinations, [{ id: target.id, version: target.version, scope }]);
  assert.ok(queued.event.id);
  assert.deepEqual(queued.event, { specversion: '1.0', id: queued.event.id,
    source: subject.data[settingsKey].source, type: 'app.majsoul.match.completed.v1', time: new Date(subject.clock()).toISOString(),
    datacontenttype: 'application/json', data: { playerCount: 4, roundCount: 2, endReason: 'win', finalScores: [36000, 28000, 22000, 14000] } });
  const atomicWrite = subject.writes.find(write => write[historyKey] && write[settingsKey]?.matchPending?.length);
  assert.deepEqual(atomicWrite?.[historyKey], [candidate]);
  assert.deepEqual(atomicWrite[settingsKey].matchPending[0].event, queued.event);
  assert.deepEqual(subject.network, [url]);

  subject.advance(1);
  const draw = { ...completedMatch(subject.clock(), 'LiuJu'), id: 'live-draw' };
  await subject.persist(draw, draw.startedAt);
  await subject.ready();
  assert.deepEqual(subject.eventInputs[1]?.event.data, { playerCount: 4, roundCount: 2, endReason: 'abortive_draw' });
});

test('a match queue failure preserves history and resumes the same event and destination after restart', async () => {
  const subject = fixture();
  const target = await enable(subject);
  const scope = await bindMatch(subject, target);
  subject.advance(1);
  const candidate = completedMatch(subject.clock());
  subject.rejectQueue('storage_unavailable');
  await subject.persist(candidate, candidate.startedAt);
  await subject.ready();
  assert.deepEqual(subject.data[historyKey], [candidate]);
  assert.equal((await subject.status()).matchPush.pending, 1);
  const [pending] = subject.data[settingsKey].matchPending;
  assert.deepEqual(pending.target, { id: target.id, version: target.version, scope });
  assert.deepEqual(subject.network, []);
  assert.equal(subject.deliveries.size, 0);

  subject.rejectQueue(null);
  subject.restart();
  await subject.ready();
  await subject.ready();
  assert.deepEqual(subject.eventInputs, [{ event: pending.event, destinations: [pending.target] }]);
  assert.equal((await subject.status()).matchPush.pending, 0);
  assert.deepEqual(subject.network, [url]);
});

for (const operation of ['unsubscribe', 'edit target', 'disable']) {
  test(`match push drops the failed-queue backlog on ${operation} without re-routing it`, async () => {
    const subject = fixture();
    const target = await enable(subject);
    await bindMatch(subject, target);
    subject.advance(1);
    const candidate = completedMatch(subject.clock());
    subject.rejectQueue('queue_full');
    await subject.persist(candidate, candidate.startedAt);
    await subject.ready();
    assert.equal((await subject.status()).matchPush.pending, 1);
    const changed = operation === 'unsubscribe' ? await subject.call('unsubscribe-match') : operation === 'edit target'
      ? await subject.call('save-target', { target: { ...target, name: 'Replacement', url: 'https://hooks.example.invalid/other', secret } })
      : await subject.call('configure', { enabled: false });
    assert.equal(changed.ok, true);
    subject.rejectQueue(null);
    subject.restart();
    await subject.ready();
    assert.deepEqual((await subject.status()).matchPush, { offerId: null, destinationId: null, pending: 0, missed: 0 });
    assert.deepEqual(subject.data[historyKey], [candidate]);
    subject.advance(1);
    const later = { ...completedMatch(subject.clock()), id: 'live-later' };
    await subject.persist(later, later.startedAt);
    await subject.ready();
    assert.deepEqual(subject.data[historyKey], [later]);
    assert.deepEqual(subject.eventInputs, []);
    assert.deepEqual(subject.network, []);
  });
}
