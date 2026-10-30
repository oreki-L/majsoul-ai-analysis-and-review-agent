(function (root) {
  'use strict';
  const endpoint = typeof module !== 'undefined' && module.exports ? require('./adapters/model-endpoint.js') : root.MJModelEndpoint;
  const transport = typeof module !== 'undefined' && module.exports ? require('./model-session-transport.js') : root.MJModelSessionTransport;
  const errors = {
    INVALID: '诊断配置或请求无效，请检查地址与模型。', BUSY: '已有模型诊断或目录请求正在进行，请先取消或等待完成。',
    PERMISSION: '接口访问权限未授予，请先授权该地址。', CANCELLED: '请求已取消。', TIMEOUT: '请求超时，请检查服务状态。',
    NETWORK: '无法连接模型接口，请检查地址、网络与服务状态。', HTTP: '接口请求失败，请检查凭据、模型与服务状态。',
    AUTH: '接口鉴权失败，请检查 Bearer 标识、API Key 或服务授权。', MODEL: '接口拒绝模型、路径或请求参数；请检查模型 ID，以及服务是否支持 function tools。',
    RESPONSE: '接口响应格式无效或过大。', TOOLS: '模型未完成预期的 function tool 调用。', JSON: '模型最终回答未通过 JSON 最小合同校验。',
    IDENTITY: '服务响应未能确认 Magpie 身份。'
  };
  const fail = code => Object.assign(new Error(errors[code]), { code });
  function create({ permissions, fetchModel, timeoutMs = 25000 } = {}) {
    let active = null;
    function cancel(requestId) {
      if (!active || (requestId !== undefined && active.requestId !== requestId)) return false;
      active.controller.abort(); return true;
    }
    async function run(message) {
      const requestId = typeof message?.requestId === 'string' && /^[\w-]{1,100}$/.test(message.requestId) ? message.requestId : null;
      if (!requestId) return { ok: false, requestId, code: 'INVALID', error: errors.INVALID };
      if (active) return { ok: false, requestId, code: 'BUSY', error: errors.BUSY };
      const controller = new AbortController(), job = { requestId, controller };
      active = job;
      const started = Date.now(); let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(fail(timedOut ? 'TIMEOUT' : 'CANCELLED')), { once: true }));
      const check = () => { if (controller.signal.aborted) throw fail(timedOut ? 'TIMEOUT' : 'CANCELLED'); };
      const wait = promise => Promise.race([promise, cancelled]);
      async function json(url, init = {}) {
        check();
        let response;
        try { response = await wait(fetchModel(url, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error' })); }
        catch (error) { check(); throw fail('NETWORK'); }
        check();
        if (!response.ok) throw fail([401, 403].includes(response.status) ? 'AUTH' : [400, 404, 422].includes(response.status) ? 'MODEL' : 'HTTP');
        try {
          const reader = response.body.getReader(), chunks = []; let size = 0;
          while (true) {
            const { done, value } = await wait(reader.read()); check(); if (done) break;
            size += value.length;
            if (size > 256 * 1024) { await reader.cancel(); throw fail('RESPONSE'); }
            chunks.push(value);
          }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          return JSON.parse(new TextDecoder().decode(bytes));
        } catch (error) { check(); throw fail('RESPONSE'); }
      }
      try {
        const config = message.config;
        if (!config || config.provider === 'mjai' || typeof config.endpoint !== 'string' || config.endpoint.length > 2048 ||
          (config.apiKey !== undefined && (typeof config.apiKey !== 'string' || config.apiKey.length > 4096))) throw fail('INVALID');
        let url;
        try { url = endpoint.endpoint(config.endpoint); } catch (_) { throw fail('INVALID'); }
        if (!await wait(permissions.contains({ origins: [endpoint.permissionOrigin(url.href)] }))) throw fail('PERMISSION');
        check();
        const headers = { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}) };
        if (message.type === 'model:discover') {
          if (!['hello', 'models', 'cc-switch-models'].includes(message.action)) throw fail('INVALID');
          const address = message.action === 'hello' ? new URL('/api/hello', url).href : url.href.replace(/\/chat\/completions$/, '/models');
          const data = await json(address, { method: 'GET', headers });
          if (message.action === 'hello') {
            if (![data?.name, data?.service, data?.app, data?.app_name].some(value => typeof value === 'string' && value.toLowerCase() === 'magpie')) throw fail('IDENTITY');
            const version = typeof data.version === 'string' && /^[\w.+-]{1,60}$/.test(data.version) ? data.version : undefined;
            return { ok: true, requestId, hello: { service: 'magpie', ...(version ? { version } : {}) } };
          }
          // CC Switch's ordinary Codex catalog is opt-in; never infer this
          // schema from a generic OpenAI/Magpie discovery response.
          const codexCatalog = message.action === 'cc-switch-models';
          const entries = codexCatalog ? data?.models : data?.data;
          if (!Array.isArray(entries) || (codexCatalog && Object.hasOwn(data, 'data'))) throw fail('RESPONSE');
          const models = [], seen = new Set();
          for (const item of entries.slice(0, 1000)) {
            const id = codexCatalog ? item?.slug : item?.id;
            if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id) || seen.has(id)) continue;
            const name = typeof item.display_name === 'string' && item.display_name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(item.display_name) ? item.display_name : null;
            seen.add(id); models.push({ id, ...(name ? { name } : {}) });
            if (models.length >= 200) break;
          }
          if (codexCatalog && entries.length && !models.length) throw fail('RESPONSE');
          return { ok: true, requestId, models };
        }
        if (message.type !== 'model:diagnose' || typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) throw fail('INVALID');
        let outputOptions;
        try { outputOptions = endpoint.outputOptions(config); } catch (_) { throw fail('INVALID'); }
        const request = { maxTokens: 1024, systemPrompt: 'This is an artificial connectivity diagnostic. First call diagnostic_echo with {"value":"ping"}. After its tool result, reply only with {"ok":true,"echo":"pong"}. Do not perform other actions.',
          messages: [{ role: 'user', content: 'Run the fixed artificial diagnostic now.' }],
          tools: [{ name: 'diagnostic_echo', description: 'Return the fixed harmless diagnostic response. No side effects.', parameters: { type: 'object', properties: { value: { type: 'string', enum: ['ping'] } }, required: ['value'], additionalProperties: false } }] };
        const post = req => json(url.href, { method: 'POST', headers, body: JSON.stringify(transport.body(req, config, outputOptions)) });
        let first;
        try { first = transport.result(await post(request), true); } catch (error) { if (errors[error.code]) throw error; throw fail('TOOLS'); }
        const call = first.toolCalls?.[0];
        if (first.toolCalls?.length !== 1 || call.name !== 'diagnostic_echo' || call.arguments.value !== 'ping' || Object.keys(call.arguments).length !== 1) throw fail('TOOLS');
        request.messages.push({ role: 'assistant', content: [{ type: 'toolCall', ...call }], ...(first.reasoning_content ? { reasoning_content: first.reasoning_content } : {}) },
          { role: 'toolResult', toolCallId: call.id, content: JSON.stringify({ value: 'pong' }) });
        request.tools = [];
        let final;
        try { final = JSON.parse(transport.result(await post(request), false).text); } catch (error) { if (errors[error.code]) throw error; throw fail('JSON'); }
        if (!final || final.ok !== true || final.echo !== 'pong' || Object.keys(final).length !== 2) throw fail('JSON');
        check();
        return { ok: true, requestId, checks: { connection: true, tools: true, json: true }, elapsedMs: Date.now() - started };
      } catch (error) {
        const code = controller.signal.aborted ? (timedOut ? 'TIMEOUT' : 'CANCELLED') : (errors[error.code] ? error.code : 'INVALID');
        return { ok: false, requestId, code, error: errors[code] };
      } finally { clearTimeout(timer); if (active === job) active = null; }
    }
    return { run, cancel };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MJModelDiagnostics = api;
})(globalThis);
