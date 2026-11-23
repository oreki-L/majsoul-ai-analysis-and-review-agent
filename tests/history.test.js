const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const H = require('../extension/history.js'), S = require('../extension/state.js');
const P = require('../extension/protocol.js'), F = require('./fixtures.js');
const opening = more => ({ ...P.decodeEvent('ActionNewRound', F.liveRound(), 'live'), step: 0, ...more });
const event = (kind, more) => ({ source: 'live', kind, ...more });
const finish = (state, more) => S.apply(state, event('Hule', { step: 2, scores: [33000,17000,25000,25000],
  winners: [{ seat: 0, tile: '7m', tsumo: false, han: 3, fu: 40 }], ...more }));

test('history retains validated event progress but never reconstructs legacy turns from rivers', () => {
  const s = S.apply(S.initial(), opening());
  const saved = H.snapshot(s);
  assert.deepEqual(saved.turnProgress.bySeat, [1,1,1,1]);
  s.turnProgress.bySeat[0] = 9;
  assert.equal(saved.turnProgress.bySeat[0], 1);
  delete s.turnProgress;
  s.players[0].discards = Array(8).fill({ tile: '1p' });
  assert.equal(H.snapshot(s).turnProgress.reason, 'legacy');
  s.turnProgress = { status: 'known', source: 'events', bySeat: [1,-1,2,3], secret: 'PRIVATE' };
  assert.deepEqual(H.snapshot(s).turnProgress.bySeat, [null,null,null,null]);
  assert.doesNotMatch(JSON.stringify(H.snapshot(s)), /PRIVATE/);
});

test('win decoding retains multi-winner settlement fields but no names or raw hand metadata', () => {
  const winner = seat => F.b(1, F.cat(F.n(4, seat), F.t(3, '0p'), F.n(11, 3), F.n(13, 40), F.t(14, 'SECRET_NAME')));
  const e = P.decodeEvent('ActionHule', F.cat(winner(0), winner(2), F.packed(2,[25000,25000,25000,25000]),
    F.packed(3,[3900,-7800,3900,0]), F.b(6,F.packed(1,[28900,17200,28900,25000]))), 'live');
  assert.equal(e.gameEnded, true); assert.equal(e.winners.length, 2);
  assert.deepEqual(e.oldScores, [25000,25000,25000,25000]);
  assert.equal(JSON.stringify(e).includes('SECRET_NAME'), false);
  const state = S.apply(S.apply(S.initial(), opening()), { ...e, step: 1 });
  assert.deepEqual(state.result.scores, [28900,17200,28900,25000]);
});

test('exhaustive draw combines score transfers, preserves tenpai and detects match end', () => {
  const score = changes => F.b(3,F.cat(F.packed(2,[25000,25000,25000,25000]),F.packed(3,changes)));
  const e = P.decodeEvent('RecordNoTile', F.cat(score([3000,-1000,-1000,-1000]),score([-1000,3000,-1000,-1000]),
    F.b(2,F.n(3,1)),F.b(2,F.n(3,0)),F.n(1,1),F.n(4,1)), 'replay');
  assert.deepEqual(e.scores,[27000,27000,23000,23000]);
  assert.deepEqual(e.tenpai,[true,false]); assert.equal(e.gameEnded,true); assert.equal(e.nagashi,true);
});

test('abortive draw applies confirmed riichi payment and explicit final scores', () => {
  const e=P.decodeEvent('ActionLiuJu',F.cat(F.n(1,2),F.b(5,F.cat(F.n(1,1),F.n(2,24000),F.n(3,1)))), 'live');
  const s=S.apply(S.apply(S.initial(),opening()),{...e,step:1});
  assert.equal(s.result.kind,'LiuJu'); assert.equal(s.result.reason,2);
  assert.equal(s.result.scores[1],24000); assert.equal(s.result.deltas[1],-1000);
});

test('round net change includes riichi deposits; new round resets current result without mutating saved snapshot', () => {
  let s=S.apply(S.initial(),opening());
  s=S.apply(s,event('DealTile',{seat:2,tile:'?',step:1,riichiSuccess:{seat:1,score:24000,sticks:1}}));
  s=finish(s,{scores:[33000,16000,25000,25000]});
  assert.deepEqual(s.result.deltas,[8000,-9000,0,0]);
  const match=H.addRound(H.create('live','game-1'),s);
  s=S.apply(s,opening({round:1,scores:[33000,16000,25000,25000]}));
  assert.equal(s.result,null); assert.deepEqual(s.startScores,[33000,16000,25000,25000]);
  assert.equal(match.rounds[0].snapshot.result.kind,'Hule');
});

test('missing settlement stays unknown until next opening supplies scores', () => {
  let s=S.apply(S.apply(S.initial(),opening()),event('NoTile',{step:1}));
  assert.equal(s.result.scoresKnown,false); assert.deepEqual(s.result.scores,[]);
  let match=H.addRound(H.create('live','game-2'),s);
  match=H.reconcile(match,[26000,24000,26000,24000]);
  assert.equal(match.rounds[0].snapshot.result.scoresKnown,true);
  assert.deepEqual(match.rounds[0].snapshot.result.deltas,[1000,-1000,1000,-1000]);
});

test('round keys keep repeat dealer honba separate and duplicate result notifications update one entry', () => {
  const s=finish(S.apply(S.initial(),opening()));
  let match=H.addRound(H.create('live','game-3'),s);
  match=H.addRound(match,s);
  assert.equal(match.rounds.length,1);
  const next=finish(S.apply(s,opening({honba:1})));
  match=H.addRound(match,next);
  assert.equal(match.rounds.length,2); assert.equal(match.rounds[1].key,'0:0:1');
  const interrupted=H.addRound(match,S.apply(next,opening({round:1})),Date.now(),true);
  assert.equal(interrupted.rounds[2].snapshot.result.kind,'Interrupted');
  assert.equal(interrupted.rounds[2].snapshot.complete,false);
});

test('new match markers and round regression separate games while dealer repeats remain in the same game', () => {
  const s=finish(S.apply(S.initial(),opening({round:2})));
  const match=H.addRound(H.create('live','game-4'),s);
  assert.equal(H.isNewMatch(match,s,opening({round:2,honba:1})),false);
  assert.equal(H.isNewMatch(match,s,opening({round:3})),false);
  assert.equal(H.isNewMatch(match,s,opening({round:0})),true);
  assert.equal(H.isNewMatch(match,s,event('MJStart')),true);
  const reset=S.apply(s,event('MJStart',{step:0}));
  assert.equal(reset.selfSeat,s.selfSeat); assert.equal(reset.result,null); assert.equal(reset.round,null);
});

test('replay import collects all rounds without changing the active replay cursor and repeated imports deduplicate', () => {
  const first={...opening(),source:'replay',hand:undefined,hands:[F.hand,F.hand,F.hand,F.hand]};
  const events=[first,{kind:'Hule',source:'replay',scores:[33000,17000,25000,25000],winners:[]},
    {...first,round:1,scores:[33000,17000,25000,25000]}, {kind:'NoTile',source:'replay',scores:[34000,16000,26000,24000],gameEnded:true}];
  const match=H.fromReplay(events,S,'replay-1');
  assert.equal(match.rounds.length,2); assert.equal(match.closed,true);
  assert.equal(match.rounds[0].snapshot.source,'replay');
  assert.deepEqual(match.rounds[0].snapshot.players[2].hand,F.hand);
  assert.equal(H.merge(H.merge([],match),H.fromReplay(events,S,'replay-1')).length,1);
  assert.equal(events[0].round,0);
});

test('stored history is allowlisted and survives JSON reload, with bounded match retention', () => {
  const s=finish(S.apply(S.initial(),opening()));
  s.apiKey='SECRET'; s.account={token:'SECRET'}; s.players[0].name='SECRET';
  const match=H.addRound(H.create('live','game-5'),s);
  match.extra='SECRET'; match.rounds[0].raw='SECRET';
  const safe=H.sanitizeMatch(JSON.parse(JSON.stringify(match)));
  assert.equal(JSON.stringify(safe).includes('SECRET'),false);
  assert.deepEqual(safe.rounds[0].snapshot.result.scores,[33000,17000,25000,25000]);
  let all=[];
  for(let i=0;i<25;i++) all=H.merge(all,{...safe,id:'game-'+i,startedAt:Date.now()+i,updatedAt:Date.now()+i});
  assert.equal(all.length,20); assert.equal(all[0].id,'game-24');
});

test('worker serializes history updates, isolates model credentials and authenticates the sender', async () => {
  let listener; const stored={modelConfig:{apiKey:'SECRET'}};
  const chrome={runtime:{id:'test-extension',onMessage:{addListener(fn){listener=fn;}}},storage:{local:{
    async get(key){return {[key]:structuredClone(stored[key])};},
    async set(values){Object.assign(stored,structuredClone(values));}
  }}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/history-storage.js'),'utf8'),{chrome,MJHistory:H,URL,Promise});
  const sender={id:'test-extension',frameId:0,tab:{id:1},url:'https://game.maj-soul.com/1/'};
  const send=(message,from=sender)=>new Promise(resolve=>{const waiting=listener(message,from,resolve);if(!waiting)resolve(undefined);});
  const s=finish(S.apply(S.initial(),opening()));
  const a=H.addRound(H.create('live','game-a'),s), b=H.addRound(H.create('live','game-b'),s);
  const replies=await Promise.all([send({type:'history:save',match:a}),send({type:'history:save',match:b})]);
  assert.ok(replies.every(r=>r.ok)); assert.equal(stored.roundHistoryV1.length,2);
  const loaded=await send({type:'history:load'});
  assert.equal(loaded.matches.length,2); assert.equal(JSON.stringify(loaded).includes('SECRET'),false);
  assert.equal(stored.modelConfig.apiKey,'SECRET');
  assert.equal(await send({type:'history:save',match:a},{...sender,url:'https://evil.example/'}),undefined);
});

const historyKey = 'roundHistoryV1', inboxKey = 'matchCompletionInboxV1';
const day = 24 * 60 * 60 * 1000, start = 1700000000000;
const trusted = { id: 'extension', frameId: 0, tab: { id: 7 }, documentId: 'game-doc', url: 'https://game.maj-soul.com/1/' };
const workerSource = fs.readFileSync(require.resolve('../extension/history-storage.js'), 'utf8');
const inboxSource = fs.readFileSync(require.resolve('../extension/match-completion-inbox.js'), 'utf8');
const { randomUUID } = require('node:crypto');

function worker({ stored = {}, clock = () => start + 100, chat = true, get, set, uuid = randomUUID } = {}) {
  let listener;
  const writes = [], reads = [];
  const storage = {
    async get(key) {
      reads.push(key);
      await get?.(key);
      return { [key]: structuredClone(stored[key]) };
    },
    async set(values) {
      writes.push(structuredClone(values));
      if (await set?.(values, stored)) return;
      Object.assign(stored, structuredClone(values));
    }
  };
  const chrome = { runtime: { id: trusted.id, onMessage: { addListener(fn) { listener = fn; } } }, storage: { local: storage } };
  const context = vm.createContext({ chrome, MJHistory: H, URL, Date: { now: clock }, crypto: { randomUUID: uuid } });
  vm.runInContext(workerSource, context);
  if (chat) vm.runInContext(inboxSource, context);
  const inbox = chat && context.MJHistoryStorage.enableCompletionInbox(context.MJMatchCompletionInbox);
  const send = (message, sender = trusted) => new Promise(resolve => { if (!listener(message, sender, resolve)) resolve(undefined); });
  return { writes, reads, inbox, stored, send, save: (match, fields = {}, sender) =>
    send({ type: 'history:save', match, matchStart: match.startedAt, ...fields }, sender) };
}

function terminal(id, { count = 4, kind = 'Hule', updatedAt = start + 50 } = {}) {
  const scores = [33000,17000,25000,25000].slice(0, count);
  let state = S.initial(), match = H.create('live', `live-${id}`, start);
  for (let index = 0; index < count; index++) {
    state = S.apply(state, opening({ round: index, scores: Array(count).fill(25000) }));
    state = S.apply(state, event(kind, { step: 1, gameEnded: index === count - 1, scores, winners: [] }));
    match = H.addRound(match, state, updatedAt);
  }
  return match;
}

test('worker owns one joint commit, with minimal immutable-on-replay event and nonblocking post-commit listeners', { timeout: 3000 }, async () => {
  let release, setStarted;
  const started = new Promise(resolve => { setStarted = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const subject = worker({ set: async values => { if (values[inboxKey]) { setStarted(); await blocked; } } });
  let notices = 0;
  const unsubscribe = subject.inbox.subscribe(() => {
    notices++;
    assert.equal(subject.stored[inboxKey].length, 1);
    return new Promise(() => {});
  });
  subject.inbox.subscribe(() => { throw new Error('chat listener'); });
  subject.inbox.subscribe(async () => { throw new Error('chat initialization'); });
  const match = terminal('first');
  const first = subject.save(match, { sourceRef: { tabId: 911, documentId: 'spoofed' } });
  await started;
  assert.equal(notices, 0);
  const duplicate = subject.save(match);
  release();
  const replies = await Promise.all([first, duplicate]);
  assert.ok(replies.every(reply => reply.ok));
  assert.ok(replies.every(reply => !Object.hasOwn(reply.matches[0], 'completionEventId')));
  assert.equal(notices, 1);
  assert.equal(subject.writes.filter(write => write[inboxKey]).length, 1);
  assert.deepEqual(Object.keys(subject.writes[0]).sort(), [inboxKey, historyKey]);
  const [completed] = structuredClone(await subject.inbox.listCommitted());
  assert.deepEqual(completed, { version: 1, id: subject.stored[inboxKey][0].event.id, observedStartAt: start, committedAt: start + 100,
    sourceRef: { tabId: 7, documentId: 'game-doc' }, data: { playerCount: 4, roundCount: 4, endReason: 'win', finalScores: [33000,17000,25000,25000] } });
  completed.data.finalScores[0] = 0;
  assert.equal((await subject.inbox.listCommitted())[0].data.finalScores[0], 33000);
  unsubscribe();
  assert.ok((await subject.save(terminal('next'))).ok);
  assert.equal(notices, 1);
});

test('standard worker and ineligible saves never access the inbox', async () => {
  const standard = worker({ chat: false });
  assert.ok((await standard.save(terminal('standard'))).ok);
  assert.deepEqual(standard.reads, [historyKey]);
  assert.deepEqual(Object.keys(standard.writes[0]), [historyKey]);
  const subject = worker();
  const match = terminal('untrusted');
  for (const sender of [{ ...trusted, id: 'other-extension' }, { ...trusted, frameId: 1 }, { ...trusted, url: 'https://example.org' },
    { ...trusted, origin: 'null' }]) {
    assert.equal(await subject.save(match, {}, sender), undefined);
  }
  const noOpening = terminal('late');
  noOpening.rounds.shift();
  const gap = terminal('gap');
  gap.rounds[1].snapshot.turnProgress.status = 'unknown';
  const replay = { ...terminal('replay'), source: 'replay' };
  const ordinary = terminal('ordinary');
  ordinary.rounds.pop(); ordinary.closed = false;
  const closedWithoutEvidence = terminal('old');
  const cases = [subject.save(match, { documentId: 'game-doc' }, { ...trusted, documentId: undefined }),
    subject.save(terminal('missing-tab'), { sourceRef: { tabId: 7, documentId: 'game-doc' } }, { ...trusted, tab: {} }),
    subject.save(noOpening), subject.save(gap), subject.save(replay), subject.save(ordinary),
    subject.save({ ...terminal('dropped'), droppedRounds: 1 }),
    subject.save(terminal('wrong-start'), { matchStart: start - 1 }),
    subject.save(closedWithoutEvidence, { matchStart: undefined })];
  assert.ok((await Promise.all(cases)).every(reply => reply.ok));
  assert.ok((await subject.save(closedWithoutEvidence)).ok);
  assert.ok(subject.reads.every(key => key === historyKey));
  assert.ok(subject.writes.every(write => Object.keys(write).length === 1 && write[historyKey]));
});

test('three-player draw and unreliable settlement scores follow the local fact contract', async () => {
  const subject = worker();
  const draw = terminal('sanma', { count: 3, kind: 'NoTile' });
  const malformed = terminal('malformed');
  malformed.rounds.at(-1).snapshot.result.scores[0] = null;
  const unknown = terminal('unknown');
  unknown.rounds.at(-1).snapshot.result.scoresKnown = false;
  const abortive = terminal('abortive', { kind: 'LiuJu' });
  assert.ok((await Promise.all([draw, malformed, unknown, abortive].map(match => subject.save(match)))).every(reply => reply.ok));
  assert.deepEqual(structuredClone(await subject.inbox.listCommitted()).map(item => item.data), [
    { playerCount: 3, roundCount: 3, endReason: 'exhaustive_draw', finalScores: [33000,17000,25000] },
    { playerCount: 4, roundCount: 4, endReason: 'win' },
    { playerCount: 4, roundCount: 4, endReason: 'win' },
    { playerCount: 4, roundCount: 4, endReason: 'abortive_draw' }
  ]);
});

test('projection, storage read and corrupt inbox errors do not prevent history; discard repairs corruption', async () => {
  const cases = [
    { options: { uuid: () => { throw new Error('projection'); } }, reason: 'projectionFailed' },
    { options: { get: key => { if (key === inboxKey) throw new Error('inbox read'); } }, reason: 'unavailable' },
    { options: { stored: { [inboxKey]: { corrupt: true } } }, reason: 'unavailable' }
  ];
  for (const { options, reason } of cases) {
    const subject = worker(options);
    assert.ok((await subject.save(terminal(reason))).ok);
    assert.equal(subject.writes.length, 1);
    assert.deepEqual(Object.keys(subject.writes[0]), [historyKey]);
    assert.equal(subject.inbox.getStatus()[reason], 1);
    assert.ok((await subject.send({ type: 'history:load' })).ok);
  }
  const subject = worker({ stored: { [inboxKey]: [null] } });
  await assert.rejects(subject.inbox.listCommitted(), /Invalid match completion inbox/);
  await subject.inbox.discardPending();
  assert.equal((await subject.inbox.listCommitted()).length, 0);
  assert.ok((await subject.save(terminal('after-discard'))).ok);
  assert.equal((await subject.inbox.listCommitted()).length, 1);
});

test('a rejected joint attempt falls back to history only, even when it left either individual key behind', async () => {
  for (const partialKey of [null, inboxKey, historyKey]) {
    const subject = worker({ set(values, stored) {
      if (!values[inboxKey] || !values[historyKey]) return;
      if (partialKey) stored[partialKey] = structuredClone(values[partialKey]);
      throw new Error('joint set rejected');
    } });
    let notices = 0;
    subject.inbox.subscribe(() => { notices++; });
    assert.ok((await subject.save(terminal('fallback'))).ok);
    assert.equal(subject.inbox.getStatus().jointWriteFailed, 1);
    assert.deepEqual(Object.keys(subject.writes[1]), [historyKey]);
    assert.equal(notices, 0);
    assert.equal(subject.stored[historyKey][0].completionEventId, undefined);
    const restarted = worker({ stored: subject.stored });
    assert.equal((await restarted.inbox.listCommitted()).length, 0);
    const match = terminal('fallback');
    assert.ok((await restarted.save({ ...match, closed: false, rounds: match.rounds.slice(0, -1) })).matches[0].closed);
    assert.ok((await restarted.save(match)).ok);
    assert.equal((await restarted.inbox.listCommitted()).length, 0);
  }
});

test('worker reports history write failure and cannot claim an orphan on restart', async () => {
  const subject = worker({ set(values, stored) {
    if (values[inboxKey]) stored[inboxKey] = structuredClone(values[inboxKey]);
    throw new Error('set rejected');
  } });
  assert.equal((await subject.save(terminal('uncommitted'))).ok, false);
  assert.equal(subject.writes.length, 2);
  assert.equal(subject.stored[historyKey], undefined);
  const restarted = worker({ stored: subject.stored });
  assert.equal((await restarted.inbox.listCommitted()).length, 0);
  assert.ok((await restarted.save(terminal('after-failure'))).ok);
  assert.equal((await restarted.inbox.listCommitted()).length, 1);
});

test('a new append verifies old entries against prior history, not the history about to be written', async () => {
  const subject = worker({ set(values, stored) {
    if (values[inboxKey]) stored[inboxKey] = structuredClone(values[inboxKey]);
    throw new Error('set rejected');
  } });
  const match = terminal('orphan');
  assert.equal((await subject.save(match)).ok, false);
  const oldId = subject.stored[inboxKey][0].event.id;
  const restarted = worker({ stored: subject.stored });
  assert.ok((await restarted.save(match)).ok);
  const verified = await restarted.inbox.listCommitted();
  assert.equal(verified.length, 1);
  assert.notEqual(verified[0].id, oldId);
  assert.equal(restarted.stored[inboxKey].length, 1);
});

test('restarts preserve event identity and order until ack, with no resurrection from history', async () => {
  const first = worker();
  const match = terminal('restart-1');
  assert.ok((await first.save(match)).ok);
  assert.ok((await first.save(terminal('restart-2'))).ok);
  const persisted = structuredClone(await first.inbox.listCommitted());
  assert.equal(persisted.length, 2);
  const second = worker({ stored: first.stored, clock: () => start + 500 });
  assert.ok((await second.save({ ...match, closed: false, rounds: match.rounds.slice(0, -1) })).matches[0].closed);
  assert.deepEqual(structuredClone(await second.inbox.listCommitted()), persisted);
  await Promise.all([second.inbox.ack(persisted[0].id), second.save(match), second.inbox.ack('unknown')]);
  const third = worker({ stored: second.stored });
  assert.deepEqual(structuredClone(await third.inbox.listCommitted()), persisted.slice(1));
  await third.inbox.discardPending();
  assert.equal((await worker({ stored: third.stored }).inbox.listCommitted()).length, 0);
});

test('a full inbox skips the incoming event, with expiry from original commit time', async () => {
  let now = start + 100;
  const subject = worker({ clock: () => now });
  for (let index = 0; index < 20; index++) assert.ok((await subject.save(terminal(`pending-${index}`))).ok);
  const original = structuredClone(subject.stored[inboxKey]);
  assert.equal(original.length, 20);
  assert.ok((await subject.save(terminal('full', { updatedAt: start + 51 }))).ok);
  assert.equal(subject.inbox.getStatus().full, 1);
  assert.deepEqual(subject.stored[inboxKey], original);
  assert.ok(subject.stored[historyKey].some(match => match.id === 'live-full'));
  now += day;
  assert.equal((await subject.inbox.listCommitted()).length, 0);
  assert.deepEqual(subject.stored[inboxKey], []);
  assert.ok((await subject.save(terminal('after-expiry', { updatedAt: start + 52 }))).ok);
  assert.equal((await subject.inbox.listCommitted()).length, 1);
});


test('history snapshots and JSON reload preserve unknown discard methods and legacy boolean values', () => {
  const s = finish(S.apply(S.initial(), opening()));
  const values = [true, false, undefined, null, 0, 1, 'false'];
  s.players[0].discards = values.map(tsumogiri => ({ tile: '1m', tsumogiri }));
  const expected = [true, false, null, null, null, null, null];
  assert.deepEqual(H.snapshot(s).players[0].discards.map(d => d.tsumogiri), expected);
  // Sanitize raw saved records as well as newly captured snapshots.
  const raw = H.create('live', 'discard-semantics');
  raw.rounds = [{ snapshot: s, recordedAt: Date.now() }];
  const reloaded = H.sanitizeMatch(JSON.parse(JSON.stringify(raw)));
  const saved = H.addRound(reloaded, s);
  const exported = JSON.parse(JSON.stringify(H.sanitizeMatch(saved)));
  assert.deepEqual(exported.rounds[0].snapshot.players[0].discards.map(d => d.tsumogiri), expected);
});

test('river and event rendering distinguish unknown, tedashi and tsumogiri including saved history', () => {
  const context = {
    __MJ_OBSERVER_STATE_V1__: S, MJHistory: H, URL, location: { href: 'https://example.test/preview.html' },
    document: { getElementById: () => null, documentElement: null, addEventListener() {} },
    window: { addEventListener() {} }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/panel-theme.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../extension/overlay.js'), 'utf8');
  vm.runInNewContext(source, context);
  context.views = context.MJCollectorPanel.create({ controller: { subscribe() { return () => {}; } } }).renderers;
  const methods = [[true, '摸切'], [false, '手切'], [null, '切牌方式未知'], [undefined, '切牌方式未知']];
  for (const [tsumogiri, label] of methods) {
    const discard = { tile: '1m', tsumogiri };
    const html = context.views.riverHtml({ discards: [discard] }, 'saved river');
    assert.ok(html.includes('title="' + label + '"'));
    assert.ok(html.includes('<small>' + label + '</small>'));
    assert.ok(context.views.eventHtml({ ...discard, kind: 'DiscardTile' }).endsWith(' · ' + label));
  }
  const called = context.views.riverHtml({ discards: [{ tile: '1m', called: true, tsumogiri: null }] }, 'river');
  assert.ok(called.includes('已被鸣牌；切牌方式未知'));
  assert.ok(called.includes('<small>已鸣</small>'));
});
