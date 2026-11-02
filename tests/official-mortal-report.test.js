'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../extension/official-mortal-report.js');
const excerpt = fs.readFileSync(require.resolve('./fixtures/mortal-classic-1.5.3-excerpt.html'), 'utf8');
test('official entry only encodes a real share URL and never guesses a match ID or submits', () => {
  const share = 'https://game.maj-soul.com/1/?paipu=fixture_uuid_a1';
  assert.equal(R.officialUrl(share), 'https://mjai.ekyu.moe/zh-cn.html?url=' + encodeURIComponent(share));
  for (const url of ['fixture_uuid_a1', 'https://game.maj-soul.com/1/', 'javascript:alert(1)', 'https://evil.example/?paipu=abc', 'https://user:pass@game.maj-soul.com/1/?paipu=abc']) assert.throws(() => R.officialUrl(url));
});
test('real Classic 1.5.3 structural excerpt parses final action, actual action and red hand without evaluating HTML', () => {
  const report = R.parse(excerpt + '<script>throw Error("must never execute")</script><iframe src="https://evil.example/"></iframe>');
  assert.equal(report.player, 1); assert.equal(report.model, 'mortal3-b24c512-t22122709'); assert.equal(report.reviewerVersion, '1.5.3');
  assert.equal(report.entries.length, 2); assert.equal(report.entries[0].expectedTile, '4z'); assert.equal(report.entries[0].actualTile, '4z');
  assert.equal(report.entries[0].remaining, 68); assert.ok(report.entries[0].hand.includes('0m'));
  assert.doesNotMatch(JSON.stringify(report), /script|iframe|evil/);
  for (const html of [excerpt.replace('1.5.3', '4.1'), excerpt.replace('mortal3-', 'mortal4-'), '<html>KillerDucky</html>', '{"engine":"Mortal"}']) assert.throws(() => R.parse(html), /不支持/);
});
test('binding requires full round sequence, seat, remaining wall, exact red hand and actual action; ambiguous stays unbound', () => {
  const report = R.parse(excerpt), entry = report.entries[0];
  const snapshot = { source: 'replay', selfSeat: 1, selfHand: entry.hand, game: { remaining: 68 } };
  const local = { rounds: [{ id: 'round-0', log: structuredClone(report.rounds[0].log) }], candidates: [{ roundId: 'round-0', cursor: 4, snapshot, actualTile: '4z' }] };
  let aligned = R.align(report, local); assert.equal(aligned.entries[0].status, 'matched'); assert.equal(aligned.entries[0].cursor, 4);
  for (const change of [v => { v.rounds[0].log[5][0] = 99; }, v => { v.candidates[0].snapshot.selfSeat = 0; }, v => { v.candidates[0].snapshot.game.remaining = 67; }, v => { v.candidates[0].snapshot.selfHand[3] = '5m'; }, v => { v.candidates[0].actualTile = '1z'; }]) {
    const changed = structuredClone(local); change(changed); assert.notEqual(R.align(report, changed).entries[0].status, 'matched');
  }
  local.candidates.push(structuredClone(local.candidates[0])); aligned = R.align(report, local);
  assert.equal(aligned.entries[0].status, 'ambiguous'); assert.equal(aligned.entries[0].snapshot, undefined);
  assert.equal(Object.values(aligned.coverage).reduce((a,b) => a+b,0), report.entries.length);
});
test('unsupported calls and incomplete round JSON are explicit, candidate scores cannot replace final action', () => {
  const html = excerpt.replace('class=role>Mortal: </span>Discard', 'class=role>Mortal: </span>Riichi');
  assert.equal(R.parse(html).entries[0].status, 'unsupported');
  assert.throws(() => R.parse(excerpt.replace('<textarea>', '<textarea>bad')), /JSON/);
});
