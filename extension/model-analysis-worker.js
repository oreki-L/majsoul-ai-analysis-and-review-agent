(function (root) {
  'use strict';
  function create({ storage, permissions, fetchModel, runtime, roundContexts, runStore, discussions, discussionReady, memoryWorker, onStage = async () => {} }) {
    // The sole pending map is shared through busy/cancel/cancelAll with the composition root.
    const pending = new Map();
    let revisionPromise = null;
    const newRevision = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    async function configRevision() {
      if (!revisionPromise) revisionPromise = (async () => {
        const saved = (await storage.get('agentConfigRevision')).agentConfigRevision;
        const revision = typeof saved === 'string' ? saved : newRevision();
        if (storage.set && revision !== saved) await storage.set({ agentConfigRevision: revision });
        return revision;
      })();
      return revisionPromise;
    }
    async function invalidate(clearRuns = true) {
      for (const controller of pending.values()) controller.abort();
      memoryWorker.cancel();
      const revision = newRevision(); revisionPromise = Promise.resolve(revision);
      await Promise.all([roundContexts.reset(), clearRuns ? Promise.all([runStore.clear(), discussions.clear()]) : Promise.resolve(), storage.set?.({ agentConfigRevision: revision })]);
    }

    function prepare(message) {
      return Promise.resolve().then(() => {
        const payload = JSON.stringify(message.snapshot);
        if (!payload || payload.length > 60000) throw new Error('局面数据无效或过大。');
        if (message.provider === 'mjai') {
          root.MJSnapshotContract.cleanSnapshot(message.snapshot);
          return { ok: true, data: root.MJMjaiAdapter.validateRequest(message.engineRequest) };
        }
        return { ok: true, data: root.MJAnalysis.prepare(message.snapshot, message.task).data };
      }).catch(error => ({ ok: false, error: error.message }));
    }
    function analyze(message, key) {
      let rawModelResult = null, accounting = null, boundEngine = null, engineRecord = null, explanationAttempt = null, engineCalls = 0, engineMs = 0, sourceConfig = null;
      return (async () => {
        if (pending.has(key)) {
          if (message.discussionId) pending.get(key).abort();
          else throw new Error('已有分析正在进行。');
        }
        // Reserve before the first await so cancellation and configuration changes
        // cover storage/permission preflight as well as the eventual fetch.
        memoryWorker.cancel();
        const controller = new AbortController(); pending.set(key, controller);
        let timer = setTimeout(() => controller.abort(), 25000);
        const checkCancelled = () => {
          if (controller.signal.aborted) { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; }
        };
        try {
          let savedDecision = null;
          if (message.discussionId) {
            await discussionReady;
            const saved = await discussions.get(message.discussionId);
            savedDecision = saved;
            const grant = message.selection;
            if (!grant || (saved.snapshot.selfHand && grant.hand !== true) || (saved.snapshot.game && grant.game !== true)
              || ((saved.snapshot.rivers || []).some(r => grant.rivers !== 'all' && !(grant.rivers === 'self' && r.seat === saved.snapshot.selfSeat)))) throw new Error('当前数据授权范围不含该历史快照，请恢复对应授权后再追问。');
            if (!message.retryExplanation && !saved.chat.some(t => t.token === message.discussionToken && t.status === 'pending' && t.question === message.question)) throw new Error('追问状态已变化，请重新提问。');
            message = { ...message, snapshot: saved.snapshot, context: saved.context, task: saved.type, lane: 'manual-review' };
          }
          const configured = await storage.get(['modelConfig', 'analysisProviders']);
          sourceConfig = configured.modelConfig;
          let c = sourceConfig;
          const hybrid = c?.provider === 'mjai' && c?.workflow === 'mortal-explain';
          if (savedDecision?.analysis?.engine) {
            if (!hybrid && c?.provider === 'mjai') throw new Error('该引擎配置未启用独立 LLM 解释。');
            if (savedDecision.analysis.explanation?.status === 'pending') throw new Error('该决策的解释正在进行，请等待完成或取消，避免重复请求。');
            // Claim atomically across tab keys before taking catch/write ownership.
            // A rejected duplicate must not change the running owner's record.
            if (!message.discussionToken) {
              engineRecord = await discussions.claimExplanation(savedDecision.id, newRevision());
              explanationAttempt = engineRecord.explanationAttempt;
              boundEngine = engineRecord.analysis;
            } else { boundEngine = savedDecision.analysis; engineRecord = savedDecision; }
          }
          if (hybrid && (savedDecision || root.MJAnalysis.normalizeTask(message.task) !== 'combined' || message.engineEnabled === false)) c = { ...configured.analysisProviders?.chat, enabled: sourceConfig.enabled };
          checkCancelled();
          if (!c?.enabled) throw new Error('请先在设置中开启模型分析。');
          const engine = c.provider === 'mjai';
          const requestedProvider = message.provider === undefined ? 'chat' : message.provider;
          if (!['chat', 'mjai'].includes(requestedProvider) || requestedProvider !== (sourceConfig.provider === 'mjai' && !message.discussionId ? 'mjai' : 'chat')) throw new Error('分析服务已变化，请刷新设置状态后重新分析。');
          const endpointAdapter = engine ? root.MJEngineEndpoint : root.MJModelEndpoint;
          const url = endpointAdapter.endpoint(c.endpoint);
          const permitted = await permissions.contains({ origins: [endpointAdapter.permissionOrigin(url.href)] });
          checkCancelled();
          if (!permitted) throw new Error('接口访问权限未授予，请重新保存设置。');
          if (typeof c.model !== 'string' || !c.model.trim() || c.model.length > 200 || (c.apiKey && typeof c.apiKey !== 'string')) throw new Error('模型配置无效，请重新保存设置。');
          const task = root.MJAnalysis.normalizeTask(message.task);
          const payload = JSON.stringify(message.snapshot);
          if (!payload || payload.length > 60000 || message.snapshot?.format !== 'mj-analysis-v1') throw new Error('局面数据无效或过大。');
          if (engine && (typeof c.apiKey !== 'string' || !c.apiKey.trim() || c.apiKey.length > 4096)) throw new Error('请配置本地引擎 Token。');
          if (engine && task !== 'combined') throw new Error('专业引擎仅支持综合决策，请选择综合攻守。');
          const latest = (await storage.get('modelConfig')).modelConfig;
          checkCancelled();
          if (JSON.stringify(latest) !== JSON.stringify(sourceConfig)) throw new Error('模型设置已变化，请重新发起分析。');
          if (engine) {
            const engineStarted = Date.now(), engineEpoch = runStore.epoch(); engineCalls++;
            let engineStatus = 'failed';
            let analysis;
            try {
            analysis = await root.MJEngineAgent.run({ snapshot: message.snapshot, request: message.engineRequest, signal: controller.signal, expectedProfile: c.engineProfile,
              infer: async (request, { signal }) => {
                const response = await fetchModel(url.href, { method: 'POST', signal, credentials: 'omit', redirect: 'error',
                  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey }, body: JSON.stringify(request) });
                if (!response.ok) throw new Error(response.status === 422 && ['voidshine-298k','yuchen-582500'].includes(c.engineProfile) ? '当前事件以立直成立或宝牌公告结尾，固定 Mortal Bot 暂不支持此时决策；请等待下一可验证动作后再分析。' : '本地引擎返回 HTTP ' + response.status + '，请检查服务、Token 与支持的局面。');
                return readJson(response);
              } });
            engineStatus = 'completed';
            } finally {
              engineMs = Date.now() - engineStarted;
              await runStore.append({ id: newRevision(), workflow: hybrid ? 'mortal-explain' : 'engine', stage: 'engine', engineCalls: 1, engineMs, elapsedMs: engineMs, calls: 0,
                status: controller.signal.aborted ? 'cancelled' : engineStatus, lane: message.lane }, engineEpoch).catch(() => {});
            }
            const engineLabel = ({ 'VoidShine-mortal-v4-298k': 'VoidShine Mortal v4 · 298k · 社区模型', 'Yuchen1457-mortal-v4-582500': 'Yuchen1457 Mortal v4 · 582500 · 社区模型' })[analysis.engine.identity?.model] || analysis.engine.identity?.model || '自选本地引擎（身份未知）';
            const decision = { ok: true, ...analysis, model: 'mjai · ' + engineLabel, provider: 'mjai',
              workflow: hybrid ? 'mortal-explain' : 'engine', engineModel: c.model, engineCalls, engineMs,
              engineIdentity: analysis.engine.identity || { model: c.model, runtime: 'user-local-mjai', checkpoint: 'unknown' } };
            if (!hybrid) return decision;
            boundEngine = { ...decision, explanation: { status: 'pending', promptVersion: 1 } };
            checkCancelled();
            const initialAttempt = newRevision();
            engineRecord = await discussions.save({ snapshot: message.snapshot, context: message.context || {}, type: task, analysis: boundEngine, explanationAttempt: initialAttempt });
            explanationAttempt = engineRecord.explanationAttempt;
            checkCancelled();
            await onStage(key, { clientRunId: message.clientRunId, record: engineRecord, analysis: boundEngine });
            c = { ...configured.analysisProviders?.chat, enabled: sourceConfig.enabled };
          }
          if (hybrid && !c?.model?.trim()) throw new Error('独立 LLM 解释服务未配置。');
          // Each service has its own endpoint, credential and permission check.
          const llmUrl = root.MJModelEndpoint.endpoint(c.endpoint);
          if (!await permissions.contains({ origins: [root.MJModelEndpoint.permissionOrigin(llmUrl.href)] })) throw new Error('LLM 解释接口权限未授予。');
          checkCancelled();
          const outputOptions = root.MJModelEndpoint.outputOptions(c);
          if (outputOptions.thinking?.type === 'enabled') {
            clearTimeout(timer); timer = setTimeout(() => controller.abort(), 120000);
          }
          const lane = message.lane === 'live' ? 'live' : 'manual-review';
          const question = message.question === undefined ? '' : message.question;
          if (typeof question !== 'string' || question.length > 4000) throw new Error('追问内容无效或过长。');
          const contextMode = 'round';
          let session = null, sessionContext = null;
          if (message.discussionId) {
            sessionContext = await discussions.context(message.discussionId);
          } else {
            const info = message.context || {}, identity = info.identity || {};
            const revision = await configRevision(); checkCancelled();
            const memory = lane === 'live' && message.snapshot.source === 'live' && typeof identity.roundStartId === 'string'
              ? await memoryWorker.store.pin(`${key}:${identity.matchId}:${identity.roundStartId}`).catch(() => ({ version: 0, entries: [] })) : { version: 0, entries: [] };
            checkCancelled();
            session = await roundContexts.observe({ snapshot: message.snapshot, scope: String(key),
              identity: { matchId: typeof identity.matchId === 'string' ? `${key}:${identity.matchId.slice(0, 160)}` : null,
                roundStartId: identity.roundStartId, viewId: identity.viewId },
              position: info.position, events: info.events, eventWindowStart: info.eventWindowStart, historyComplete: info.historyComplete,
              lane, provider: llmUrl.href, model: c.model, task,
              config: { revision, workflow: boundEngine?.workflow || 'llm', engineIdentity: boundEngine?.engineIdentity || null, memoryVersion: memory.version, mode: contextMode, promptVersion: boundEngine ? 6 : 7, maxTokens: c.maxTokens, selection: true } });
            checkCancelled(); sessionContext = await roundContexts.getContext(session);
            if (lane === 'live' && memory.entries.length) sessionContext.userMemory = memory;
          }
          const records = [], started = Date.now(), epoch = runStore.epoch(), runId = newRevision(); let status = 'failed', attempts = 0, outcome, sessionTurn, toolCalls = null;
          const totals = () => {
            const summary = root.MJModelUsage.summarize(records);
            const usage = summary.requests ? summary.usage : root.MJModelUsage.normalizeUsage(null);
            return { engineCalls, engineMs, toolCalls, workflow: boundEngine?.workflow || 'llm', stage: boundEngine ? 'explanation' : 'llm', usage, cost: root.MJModelUsage.estimateCost(usage, c.pricing), calls: attempts, elapsedMs: Date.now() - started, contextMode };
          };
          try {
            const analysis = await root.MJAgent.run({ snapshot: message.snapshot, task, signal: controller.signal,
              runtime, sessionContext, question, engineDecision: boundEngine ? { engine: boundEngine.engine, provenance: boundEngine.engineIdentity } : null, toolCalling: true,
              contextPolicy: lane === 'live' && !question && !message.discussionId ? (boundEngine ? 'live-selective' : 'live-xf') : 'full',
              maxTurns: lane === 'manual-review' ? 3 : 2,
              timeoutMs: outputOptions.thinking?.type === 'enabled' ? 120000 : 25000,
              transport: async request => {
                checkCancelled(); attempts++;
                // A failed or unreadable attempt may still have been billed. Its missing usage is unknown.
                const record = { usage: root.MJModelUsage.normalizeUsage(null) }; records.push(record);
                const response = await fetchModel(llmUrl.href, { method: 'POST', signal: request.signal, credentials: 'omit', redirect: 'error',
                  headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: 'Bearer ' + c.apiKey } : {}) },
                  body: JSON.stringify(root.MJModelSessionTransport.body(request, c, outputOptions)) });
                if (!response.ok) throw new Error('模型接口返回 HTTP ' + response.status + '，请检查地址、密钥、模型及额度。');
                const data = await readJson(response, '模型');
                const usage = root.MJModelUsage.normalizeUsage(data);
                record.usage = usage;
                checkCancelled();
                const choice = data?.choices?.[0], content = choice?.message?.content;
                if (typeof content === 'string') rawModelResult = { content: content.slice(0, 32000), truncated: content.length > 32000,
                  model: c.model, capturedAt: new Date().toISOString(), finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason.slice(0, 100) : null };
                const result = root.MJModelSessionTransport.result(data, request.tools.length > 0);
                return { ...result, usage: { input: usage.uncachedInputTokens ?? usage.inputTokens ?? 0, output: usage.outputTokens ?? 0,
                  cacheRead: usage.uncachedInputTokens === null ? 0 : usage.cacheReadTokens ?? 0, cacheWrite: usage.cacheWriteTokens ?? 0,
                  totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0) } };
              } });
            toolCalls = analysis.runtime?.toolCalls ?? null;
            checkCancelled();
            if (session) {
              if (!await roundContexts.isCurrent(session)) throw new Error('分析上下文已变化，请重新分析。');
            }
            checkCancelled(); status = 'completed'; accounting = totals();
            if (!await permissions.contains({ origins: [root.MJModelEndpoint.permissionOrigin(llmUrl.href)] })) throw new Error('解释接口授权已失效。');
            if (JSON.stringify((await storage.get('modelConfig')).modelConfig) !== JSON.stringify(sourceConfig)) throw new Error('配置已变化，未挂载解释。');
            checkCancelled();
            const { sessionTurn: internalTurn, ...publicAnalysis } = analysis;
            sessionTurn = internalTurn;
            outcome = boundEngine
              ? { ...boundEngine, ok: true, ...accounting, explanation: { ...publicAnalysis.explanation, status: 'completed', model: c.model }, explanationRuntime: publicAnalysis.runtime }
              : { ok: true, ...publicAnalysis, model: c.model, ...accounting, ...(session ? { session } : {}) };
            if (boundEngine && engineRecord && !message.discussionToken) {
              checkCancelled();
              engineRecord = await discussions.explain(engineRecord.id, outcome.explanation, accounting, explanationAttempt);
              outcome.discussionRecord = engineRecord;
            }
          } finally {
            accounting = totals();
            if (controller.signal.aborted) status = 'cancelled';
            await runStore.append({ id: runId, ...accounting, engineCalls: 0, status, mode: contextMode, lane }, epoch).catch(() => {});
            if (controller.signal.aborted && status !== 'cancelled') await runStore.append({ id: runId, ...accounting, status: 'cancelled', mode: contextMode, lane }, epoch).catch(() => {});
            checkCancelled();
          }
          if (session) {
            const exchangeId = `${started}-${newRevision()}`;
            try {
              const committed = await roundContexts.appendExchange(session, { id: exchangeId, question: question || '分析当时局面',
                automatic: lane === 'live' && !question, task, position: sessionContext.checkpoint.position,
                answer: boundEngine ? JSON.stringify({ ...boundEngine.result, engine: boundEngine.engine, explanation: outcome.explanation }) : sessionTurn?.answer || JSON.stringify(outcome.result), ...(sessionTurn?.request ? { request: sessionTurn.request } : {}) }, { signal: controller.signal });
              checkCancelled();
              if (!committed) {
                if (!await roundContexts.isCurrent(session)) throw new Error('分析上下文已变化，请重新分析。');
                checkCancelled(); outcome.sessionSaved = false;
              }
            } catch (error) {
              await roundContexts.removeExchange(session, exchangeId).catch(() => {});
              await runStore.append({ id: runId, ...accounting, status: controller.signal.aborted ? 'cancelled' : 'failed', mode: contextMode, lane }, epoch).catch(() => {});
              throw error;
            }
          }
          return outcome;
        } finally { clearTimeout(timer); if (pending.get(key) === controller) pending.delete(key); memoryWorker.pump(); }
      })().catch(async error => {
        if (boundEngine && engineRecord && explanationAttempt && !message.discussionToken) {
          const explanation = { status: error.name === 'AbortError' ? 'interrupted' : 'failed', error: modelError(error), promptVersion: 1,
            billing: accounting?.calls ? 'unknown-or-recorded' : 'not-started' };
          const record = await discussions.explain(engineRecord.id, explanation, accounting, explanationAttempt).catch(() => null);
          // A removed/cleared record cannot be revived by a late response.
          if (record) return { ...boundEngine, ok: true, ...(accounting || {}), explanation, discussionRecord: record };
        }
        return { ok: false, error: modelError(error), ...(error.validation ? { validation: error.validation } : {}), ...(accounting || {}), ...(rawModelResult && error.name !== 'AbortError' ? { rawModelResult } : {}) };
      }).then(async outcome => {
        if (message.discussionId && !message.retryExplanation) {
          try { await discussions.answer(message.discussionId, message.discussionToken, outcome); }
          catch (e) { outcome = { ok: false, error: e.message }; }
        }
        return outcome;
      });
    }
    function cancel(key) { pending.get(key)?.abort(); }
    function cancelAll() { for (const controller of pending.values()) controller.abort(); }
    return { prepare, analyze, busy: () => pending.size > 0, cancel, cancelAll, invalidate };
  }
  function modelError(error) {
    if (error.name === 'AbortError' || ['ABORTED', 'TIME_BUDGET'].includes(error.code)) return '分析已取消或请求超时，请重试。';
    if (error.name === 'TypeError') return '无法连接模型接口，请检查地址、网络与访问权限。';
    const budget = { TURN_BUDGET: '已达到本次模型调用上限，未取得最终分析。', TOOL_BUDGET: '已达到本次工具调用上限，未取得最终分析。', TOKEN_BUDGET: '已达到本次 token 预算，未取得最终分析。' };
    return budget[error.code] || error.message;
  }

  async function readJson(response, label = '引擎') {
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 1024 * 1024) { await reader.cancel(); throw new Error(label + '响应过大。'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new Error(label + '未返回有效 JSON。'); }
  }

  const api = { create, readJson };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MJModelAnalysisWorker = api;
})(globalThis);
