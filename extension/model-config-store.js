(function (root) {
  'use strict';
  const Profiles = typeof module !== 'undefined' && module.exports ? require('./model-profiles.js') : root.MJModelProfiles;
  const providerOf = c => c?.provider === 'mjai' ? 'mjai' : 'chat';
  const defaults = provider => ({ provider, enabled: false, endpoint: provider === 'mjai' ? 'http://127.0.0.1:17341/analyze' : '', model: provider === 'mjai' ? 'mjai' : '', apiKey: '' });
  const keys = ['modelConfig', 'analysisProviders', 'llmProfilesV1'];
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
      return { profiles, drafts, provider: providerOf(c) };
    }
    function save({ config, profiles, drafts }, token = generation) {
      const captured = structuredClone({ config, profiles, drafts });
      return enqueue(async () => {
        if (token !== generation) return null;
        const stored = await storage.get(keys);
        if (token !== generation) return null;
        const c = captured.config, providers = { ...stored.analysisProviders };
        for (const [provider, draft] of Object.entries(captured.drafts)) providers[provider] = { ...providers[provider], ...draft };
        providers[c.provider] = { ...providers[c.provider], ...c };
        const current = providers[c.provider];
        // modelConfig is the sole runtime truth. Compatibility slots are saved drafts.
        await storage.set({ modelConfig: current, analysisProviders: providers, llmProfilesV1: captured.profiles });
        return providers;
      });
    }
    function disable({ drafts, profiles }) {
      ++generation;
      const captured = structuredClone({ drafts, profiles });
      captured.profiles.profiles = captured.profiles.profiles.map(item => ({ ...item, config: { ...item.config, enabled: false } }));
      return enqueue(async () => {
        const stored = await storage.get(keys), providers = { ...stored.analysisProviders, ...captured.drafts };
        for (const [provider, c] of Object.entries(providers)) providers[provider] = { ...c, enabled: false };
        await storage.set({ ...(stored.modelConfig ? { modelConfig: { ...stored.modelConfig, enabled: false } } : {}),
          analysisProviders: providers, llmProfilesV1: captured.profiles });
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
  const api = { create, defaults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MJModelConfigStore = api;
})(globalThis);
