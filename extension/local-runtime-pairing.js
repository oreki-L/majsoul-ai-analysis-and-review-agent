(function (root) {
  'use strict';
  const base = 'http://127.0.0.1:17343';
  const ports = { 'akagi-v2': 17341, 'voidshine-298k': 17342, 'yuchen-582500': 17344 };
  function apply(state, result, profile) {
    if (result?.format !== 'local-analysis-pair-v1' || result.profile !== profile || !ports[profile] || result.endpoint !== `http://127.0.0.1:${ports[profile]}/analyze` || typeof result.apiKey !== 'string' || result.apiKey.length < 16 || result.apiKey.length > 4096 || /[\r\n]/.test(result.apiKey)) throw new Error('运行包返回的模型或凭据不匹配。');
    const chosen = state.engineProfiles.profiles.find(p => p.id === profile);
    if (!chosen) throw new Error('请选择运行包支持的模型。');
    const config = { ...chosen.config, provider: 'mjai', model: 'mjai', engineProfile: profile, endpoint: result.endpoint, apiKey: result.apiKey, enabled: false };
    return { ...state, engineProfiles: { ...state.engineProfiles, activeId: profile, profiles: state.engineProfiles.profiles.map(p => p.id === profile ? { ...p, config } : p) }, drafts: { ...state.drafts, mjai: config } };
  }
  async function connect(profile, { signal, fetcher = root.fetch.bind(root), crypto = root.crypto, wait = ms => new Promise(r => setTimeout(r, ms)), notify = () => {} } = {}) {
    if (!ports[profile]) throw new Error('请先选择运行包支持的模型；自备服务请使用手动配置。');
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
    async function post(path, body) {
      const response = await fetcher(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Pair': '1' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
      if (!response.ok) throw new Error('连接已过期或被拒绝，请重新连接。');
      return response.json();
    }
    const request = await post('/pair/request', { nonce, profile });
    if (!/^[a-f0-9]{64}$/.test(request.id || '')) throw new Error('运行包协议不匹配。');
    notify();
    for (let n = 0; n < 120; n++) {
      if (signal?.aborted) throw new Error('连接已取消。');
      const result = await post('/pair/claim', { id: request.id, nonce });
      if (result.pending !== true) return result;
      await wait(1000);
    }
    throw new Error('连接已过期，请重新连接。');
  }
  const api = { connect, apply, supports: profile => Object.hasOwn(ports, profile) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MJLocalRuntimePairing = api;
})(globalThis);
