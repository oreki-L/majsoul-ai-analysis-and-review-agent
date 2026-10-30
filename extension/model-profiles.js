(function (root) {
  'use strict';
  const VERSION = 1, MAX_NAME_LENGTH = 40;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => Array.isArray(value) ? value.map(clone) : object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const chat = value => object(value) && value.provider !== 'mjai';
  const configOf = value => ({ ...clone(value), provider: 'chat' });
  function validateName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || Array.from(name).length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('配置名称须为 1–40 个字符，且不能包含控制字符。');
    return name;
  }
  function nextId(profiles) {
    let index = 1;
    while (profiles.some(profile => profile.id === 'profile-' + index)) index++;
    return 'profile-' + index;
  }
  function uniqueName(profiles, preferred = '默认配置') {
    let name = preferred, index = 2;
    while (profiles.some(profile => profile.name === name)) name = preferred.slice(0, 30) + ' ' + index++;
    return name;
  }
  function normalize(state) {
    const profiles = [];
    for (const item of Array.isArray(state?.profiles) ? state.profiles : []) {
      if (!object(item) || !chat(item.config)) continue;
      const id = typeof item.id === 'string' && item.id.trim() && !profiles.some(profile => profile.id === item.id) ? item.id : nextId(profiles);
      let name;
      try { name = validateName(item.name); } catch (_) { name = '默认配置'; }
      profiles.push({ id, name: uniqueName(profiles, name), config: configOf(item.config) });
    }
    if (!profiles.length) profiles.push({ id: 'profile-1', name: '默认配置', config: { provider: 'chat', enabled: false, endpoint: '', model: '', apiKey: '' } });
    return { version: VERSION, activeId: profiles.some(profile => profile.id === state?.activeId) ? state.activeId : profiles[0].id, profiles };
  }
  function sameConfig(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => sameConfig(item, b[index]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameConfig(a[key], b[key]));
  }
  function migrate(storage = {}) {
    const saved = storage.llmProfilesV1;
    if (Array.isArray(saved?.profiles) && saved.profiles.some(item => object(item) && chat(item.config))) return normalize(saved);
    const profiles = [];
    // Both legacy slots can contain independently edited chat settings. Retain
    // each distinct configuration; never inspect or copy the mjai provider.
    for (const candidate of [storage.modelConfig, storage.analysisProviders?.chat]) {
      if (!chat(candidate)) continue;
      const config = configOf(candidate);
      if (profiles.some(profile => sameConfig(profile.config, config))) continue;
      profiles.push({ id: nextId(profiles), name: uniqueName(profiles), config });
    }
    return normalize({ profiles, activeId: profiles[0]?.id });
  }
  function active(state) {
    const normalized = normalize(state);
    return normalized.profiles.find(profile => profile.id === normalized.activeId);
  }
  function upsert(state, item) {
    const result = normalize(state), name = validateName(item?.name);
    if (!chat(item?.config)) throw new Error('仅支持保存 chat 模型配置。');
    const existing = item.id === undefined ? null : result.profiles.find(profile => profile.id === item.id);
    if (item.id !== undefined && !existing) throw new Error('找不到所选配置。');
    if (result.profiles.some(profile => profile.id !== existing?.id && profile.name === name)) throw new Error('配置名称已存在。');
    const profile = { id: existing?.id || nextId(result.profiles), name, config: configOf(item.config) };
    if (existing) result.profiles[result.profiles.indexOf(existing)] = profile;
    else { result.profiles.push(profile); result.activeId = profile.id; }
    return result;
  }
  function select(state, id) {
    const result = normalize(state);
    if (!result.profiles.some(profile => profile.id === id)) throw new Error('找不到所选配置。');
    result.activeId = id;
    return result;
  }
  function remove(state, id) {
    const result = normalize(state);
    if (!result.profiles.some(profile => profile.id === id)) throw new Error('找不到所选配置。');
    if (result.profiles.length === 1) throw new Error('至少需要保留一份配置。');
    result.profiles = result.profiles.filter(profile => profile.id !== id);
    if (result.activeId === id) result.activeId = result.profiles[0].id;
    return result;
  }
  const api = { VERSION, MAX_NAME_LENGTH, validateName, normalize, migrate, active, upsert, select, remove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MJModelProfiles = api;
})(globalThis);
