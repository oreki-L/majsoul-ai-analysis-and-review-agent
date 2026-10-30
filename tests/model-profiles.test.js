'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Profiles = require('../extension/model-profiles.js');

test('legacy chat migration preserves credentials, extensions, and both distinct legacy slots', () => {
  const source = { modelConfig: { enabled: true, endpoint: 'https://current.example/v1', model: 'current', apiKey: 'SECRET', custom: { headers: ['a'], retries: 2 } },
    analysisProviders: { chat: { provider: 'chat', enabled: false, model: 'draft', apiKey: 'DRAFT' }, mjai: { enabled: true, apiKey: 'ENGINE' } } };
  const before = structuredClone(source), state = Profiles.migrate(source);
  assert.equal(state.version, 1);
  assert.equal(state.profiles.length, 2);
  assert.deepEqual(Profiles.active(state).config, { ...source.modelConfig, provider: 'chat' });
  assert.equal(state.profiles[1].config.apiKey, 'DRAFT');
  state.profiles[0].config.custom.headers.push('b');
  assert.deepEqual(source, before);
  assert.equal(JSON.stringify(state).includes('ENGINE'), false);
});

test('migration never turns a provider draft into an enabled runtime model', () => {
  const source = { modelConfig: { provider: 'mjai', enabled: false, apiKey: 'ENGINE' }, analysisProviders: { chat: { enabled: true, model: 'saved' } } };
  const before = structuredClone(source), state = Profiles.migrate(source);
  assert.equal(state.profiles.length, 1);
  assert.equal(Profiles.active(state).config.model, 'saved');
  assert.deepEqual(source, before);
  assert.equal(source.modelConfig.enabled, false);
  assert.equal(Profiles.active(Profiles.migrate({})).config.enabled, false);
});

test('equivalent legacy slots deduplicate regardless of object property order', () => {
  const state = Profiles.migrate({ modelConfig: { model: 'a', custom: { a: 1, b: 2 } },
    analysisProviders: { chat: { custom: { b: 2, a: 1 }, model: 'a', provider: 'chat' } } });
  assert.equal(state.profiles.length, 1);
  assert.deepEqual(Profiles.migrate({ llmProfilesV1: state }), state);
});

test('existing profiles take precedence over legacy provider slots', () => {
  const state = Profiles.migrate({ modelConfig: { model: 'stale' }, llmProfilesV1: { activeId: 'b', profiles: [
    { id: 'a', name: 'A', config: { model: 'first' } }, { id: 'b', name: 'B', config: { model: 'second', extension: { enabled: true } } }
  ] } });
  assert.equal(state.profiles.length, 2);
  assert.equal(Profiles.active(state).config.model, 'second');
});

test('normalization repairs malformed entries, duplicate IDs and names, and invalid selection', () => {
  const state = Profiles.normalize({ activeId: 'missing', profiles: [null, { config: [] }, { config: { provider: 'mjai' } },
    { id: 'same', name: ' A ', config: { model: 'a' } }, { id: 'same', name: 'A', config: { model: 'b' } }, { config: {} }
  ] });
  assert.equal(state.profiles.length, 3);
  assert.equal(new Set(state.profiles.map(profile => profile.id)).size, 3);
  assert.equal(new Set(state.profiles.map(profile => profile.name)).size, 3);
  assert.equal(state.activeId, 'same');
  assert.deepEqual(Profiles.normalize(state), state);
});

test('profile create, rename, select, and delete preserve independent configurations', () => {
  const first = Profiles.migrate({ modelConfig: { model: 'one', apiKey: 'ONE', pricing: { input: 1 } } });
  const second = Profiles.upsert(first, { name: 'Two', config: { model: 'two', apiKey: 'TWO', enabled: true } });
  const secondId = second.activeId;
  assert.equal(first.profiles.length, 1);
  assert.equal(Profiles.active(second).config.apiKey, 'TWO');
  const selected = Profiles.select(second, first.activeId);
  assert.equal(Profiles.active(selected).config.apiKey, 'ONE');
  const renamed = Profiles.upsert(selected, { id: secondId, name: 'Renamed', config: { model: 'two', apiKey: 'TWO' } });
  assert.equal(renamed.activeId, first.activeId);
  assert.equal(renamed.profiles[1].name, 'Renamed');
  const remaining = Profiles.remove(Profiles.select(renamed, secondId), secondId);
  assert.equal(remaining.activeId, first.activeId);
  assert.equal(remaining.profiles[0].config.pricing.input, 1);
  assert.throws(() => Profiles.remove(remaining, remaining.activeId), /至少/);
  assert.throws(() => Profiles.select(remaining, 'missing'), /找不到/);
  assert.throws(() => Profiles.remove(remaining, 'missing'), /找不到/);
});

test('names are trimmed, length limited by Unicode characters, and unique', () => {
  const state = Profiles.normalize();
  assert.equal(Profiles.validateName('  工作  '), '工作');
  assert.equal(Profiles.validateName('😀'.repeat(40)), '😀'.repeat(40));
  for (const name of ['', '   ', 'a'.repeat(41), 'bad\nname', null]) assert.throws(() => Profiles.validateName(name));
  assert.throws(() => Profiles.upsert(state, { name: state.profiles[0].name, config: {} }), /已存在/);
  assert.throws(() => Profiles.upsert(state, { id: 'unknown', name: 'new', config: {} }), /找不到/);
  assert.throws(() => Profiles.upsert(state, { name: 'engine', config: { provider: 'mjai' } }), /chat/);
});
