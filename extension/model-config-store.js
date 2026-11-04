(function (root) {
  'use strict';
  const Profiles = typeof module !== 'undefined' && module.exports ? require('./model-profiles.js') : root.MJModelProfiles;
  const providerOf = c => c?.provider === 'mjai' ? 'mjai' : 'chat';
  const defaults = provider => ({ provider, enabled: false, endpoint: provider === 'mjai' ? 'http://127.0.0.1:17341/analyze' : '', model: provider === 'mjai' ? 'mjai' : '', apiKey: '' });
  const keys = ['modelConfig', 'analysisProviders', 'llmProfilesV1', 'mjaiEngineProfilesV1'];
  function engineProfiles(stored = {}) {
    const saved = stored.mjaiEngineProfilesV1;
    const old = stored.modelConfig?.provider === 'mjai' ? stored.modelConfig : stored.analysisProviders?.mjai;
    const profiles = [
      { id: 'voidshine-298k', name: 'VoidShine Mortal v4 · 298k · 四麻半庄', config: { ...defaults('mjai'), endpoint: 'http://127.0.0.1:17342/analyze', engineProfile: 'voidshine-298k' } },
      { id: 'akagi-v2', name: 'Akagi v2 Mortal · 弱示例', config: { ...defaults('mjai'), engineProfile: 'akagi-v2' } },
      { id: 'yuchen-582500', name: 'Yuchen1457 Mortal v4 · 582500 · 社区模型', config: { ...defaults('mjai'), endpoint: 'http://127.0.0.1:17344/analyze', engineProfile: 'yuchen-582500' } },
      { id: 'akagi-v3-native', name: 'Akagi v3 Native · 四人半庄 · 实验接入', config: { ...defaults('mjai'), endpoint: 'http://127.0.0.1:17345/analyze', engineProfile: 'akagi-v3-native' } },
      { id: 'custom', name: '自定义 mjai 服务', config: { ...defaults('mjai'), engineProfile: 'custom' } }
    ];
    if (saved?.version === 1 && Array.isArray(saved.profiles) && saved.profiles.length && saved.profiles.some(p => p.id === saved.activeId)) {
      const migrated = structuredClone(saved);
      for (const profile of profiles) if (!migrated.profiles.some(p => p.id === profile.id)) migrated.profiles.push(profile);
      return migrated;
    }
    if (old) profiles.push({ id: 'legacy', name: '原本地引擎（身份未确认）', config: { ...old, engineProfile: 'legacy' } });
    return { version: 1, activeId: old ? 'legacy' : 'custom', profiles };
  }
  function create({ storage, clearAgentData = async () => {} }) {
    // One settings-page instance owns this queue; this is not a cross-window transaction.
    let generation = 0, queue = Promise.resolve();
    function enqueue(operation) {
      const pending = queue.then(operation); queue = pending.catch(() => {}); return pending;
    }
    async function load() {
      const stored = await storage.get(keys), c = stored.modelConfig;
      const profiles = Profiles.migrate(stored), drafts = {};
      for (const provider of ['chat', 'mjai']) {
        const item = stored.analysisProviders?.[provider];
        if (item && typeof item === 'object') drafts[provider] = { ...defaults(provider), ...item, provider };
      }
      if (c) drafts[providerOf(c)] = { ...defaults(providerOf(c)), ...c, provider: providerOf(c) };
      drafts.chat = { ...defaults('chat'), ...Profiles.active(profiles).config, enabled: providerOf(c) === 'chat' && c?.enabled === true };
      return { profiles, drafts, engineProfiles: engineProfiles(stored), provider: providerOf(c) };
    }
    function save({ config, profiles, drafts, engineProfiles: engines }, token = generation) {
      const captured = structuredClone({ config, profiles, drafts, engines });
      return enqueue(async () => {
        if (token !== generation) return null;
        const stored = await storage.get(keys);
        if (token !== generation) return null;
        const c = captured.config, providers = { ...stored.analysisProviders };
        for (const [provider, draft] of Object.entries(captured.drafts)) providers[provider] = { ...providers[provider], ...draft };
        providers[c.provider] = { ...providers[c.provider], ...c };
        const current = providers[c.provider];
        // modelConfig is the sole runtime truth. Compatibility slots are saved drafts.
        const engineState = captured.engines || engineProfiles(stored);
        if (c.provider === 'mjai') {
          const selected = engineState.profiles.find(p => p.id === engineState.activeId);
          selected.config = { ...c, engineProfile: selected.id };
          current.engineProfile = selected.id;
        }
        await storage.set({ modelConfig: current, analysisProviders: providers, llmProfilesV1: captured.profiles, mjaiEngineProfilesV1: engineState });
        return providers;
      });
    }
    function disable({ drafts, profiles, engineProfiles: engines }) {
      ++generation;
      const captured = structuredClone({ drafts, profiles, engines });
      captured.profiles.profiles = captured.profiles.profiles.map(item => ({ ...item, config: { ...item.config, enabled: false } }));
      return enqueue(async () => {
        const stored = await storage.get(keys), providers = { ...stored.analysisProviders, ...captured.drafts };
        for (const [provider, c] of Object.entries(providers)) providers[provider] = { ...c, enabled: false };
        const engineState = captured.engines || engineProfiles(stored);
        engineState.profiles = engineState.profiles.map(p => ({ ...p, config: { ...p.config, enabled: false } }));
        await storage.set({ ...(stored.modelConfig ? { modelConfig: { ...stored.modelConfig, enabled: false } } : {}),
          analysisProviders: providers, llmProfilesV1: captured.profiles, mjaiEngineProfilesV1: engineState });
      });
    }
    function clear() {
      ++generation;
      return enqueue(async () => {
        try { await clearAgentData(); }
        finally { await storage.remove([...keys, 'agentRoundContextV1', 'agentRunsV1', 'decisionDiscussionsV1']); }
      });
    }
    return { load, save, disable, clear, enqueue, invalidate: () => ++generation, get generation() { return generation; } };
  }
  const api = { create, defaults, engineProfiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MJModelConfigStore = api;
})(globalThis);
