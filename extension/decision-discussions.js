/* Worker-owned decision history. A single serialized writer prevents tab races. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./contracts/snapshot.js') : root.MJSnapshotContract;
  const copy = v => JSON.parse(JSON.stringify(v));
  const KEY = 'decisionDiscussionsV1';
  function engineContext(value) {
    if (value?.format !== 'majsoul-engine-result-v1') return null;
    const action = raw => {
      if (!raw || !['dahai', 'reach', 'none', 'chi', 'pon', 'daiminkan', 'ankan', 'kakan', 'hora'].includes(raw.type)) return null;
      const clean = { type: raw.type };
      for (const key of ['actor', 'target']) if (Number.isInteger(raw[key]) && raw[key] >= 0 && raw[key] < 4) clean[key] = raw[key];
      const validTile = t => typeof t === 'string' && /^(?:[1-9][mps]|5[mps]r|[ESWNPFC])$/.test(t);
      if (validTile(raw.pai)) clean.pai = raw.pai;
      if (typeof raw.tsumogiri === 'boolean') clean.tsumogiri = raw.tsumogiri;
      if (Array.isArray(raw.consumed) && raw.consumed.length <= 4 && raw.consumed.every(validTile)) clean.consumed = raw.consumed.slice();
      return clean;
    };
    return { format: value.format, action: action(value.action),
      phase: ['draw', 'response', 'post-call-discard', 'reach-discard', 'kan-response'].includes(value.phase) ? value.phase : null,
      followUp: value.followUp?.type === 'dahai' ? action(value.followUp) : null,
      limitations: Array.isArray(value.limitations) ? value.limitations.filter(s => typeof s === 'string').slice(0, 8).map(s => s.slice(0, 500)) : [] };
  }
  function explanationContext(value) {
    if (value?.status !== 'completed') return null;
    const texts = v => Array.isArray(v) ? v.filter(s => typeof s === 'string').slice(0,8).map(s => s.slice(0,1000)) : [];
    return { status: 'completed', summary: typeof value.summary === 'string' ? value.summary.slice(0,1000) : '', reasons: texts(value.reasons), limitations: texts(value.limitations),
      model: typeof value.model === 'string' ? value.model.slice(0,200) : 'unknown', promptVersion: Number.isInteger(value.promptVersion) ? value.promptVersion : null };
  }
  function provenance(value) {
    const source = value.officialSource || value.engineIdentity;
    if (!source) return null;
    return Object.fromEntries(['model','runtime','checkpoint','parserVersion','reviewerVersion','reportFingerprint','player','rules','entry'].filter(k => typeof source[k] === 'string' || Number.isInteger(source[k])).map(k => [k, typeof source[k] === 'string' ? source[k].slice(0,200) : source[k]]));
  }
  const analysisAnswer = value => JSON.stringify(value.engine ? { result: value.result, engine: engineContext(value.engine), explanation: explanationContext(value.explanation), provenance: provenance(value) } : value.result);
  function identity(snapshot, context = {}, type = 'combined') {
    return JSON.stringify([context.identity || {}, snapshot.source, snapshot.game?.round, snapshot.game?.honba,
      context.position ?? snapshot.lastStep, snapshot.selfSeat, type]);
  }
  function create({ storage, maxBytes = 6000000, maxRecords = 400 } = {}) {
    let records = [], ready, queue = Promise.resolve();
    const load = () => ready ||= storage.get(KEY).then(value => {
      const data = value?.[KEY];
      if (data?.schema === 1 && Array.isArray(data.records)) records = data.records.filter(r => typeof r?.id === 'string' && r.snapshot && r.analysis?.result && Array.isArray(r.chat));
    }).catch(error => { ready = null; throw error; });
    const serial = fn => { const next = queue.then(load).then(fn); queue = next.catch(() => {}); return next; };
    const bytes = value => JSON.stringify(value).length * 3;
    async function mutate(fn) {
      const before = copy(records);
      try {
        const result = fn();
        // Unasked, unpinned analyses are the only records automatically evicted.
        while (records.length > maxRecords || bytes(records) > maxBytes) {
          const index = records.findIndex(r => r !== result && !r.panel && !r.chat.length);
          if (index < 0) throw new Error('讨论历史空间已满；已保留既有问答，本次内容未保存。');
          records.splice(index, 1);
        }
        await storage.set({ [KEY]: { schema: 1, records } }); return copy(result);
      } catch (e) { records = before; throw e; }
    }
    const find = id => { const r = records.find(r => r.id === id); if (!r) throw new Error('找不到该决策历史。'); return r; };
    return {
      clear: () => serial(() => mutate(() => { records = []; return records; })),
      list: () => serial(() => copy(records)),
      get: id => serial(() => copy(find(id))),
      save: input => serial(() => mutate(() => {
        const snapshot = C.cleanSnapshot(input.snapshot), context = (() => {
          const info = input.context || {}, raw = info.identity || {};
          const identity = Object.fromEntries(['matchId', 'roundStartId', 'viewId'].filter(k => typeof raw[k] === 'string').map(k => [k, raw[k].slice(0, 160)]));
          return { identity, position: Number.isInteger(info.position) ? info.position : snapshot.lastStep };
        })();
        const base = identity(snapshot, context, input.type || 'combined');
        const id = ['mortal-explain','official-mortal-review'].includes(input.analysis?.workflow) ? base + ':' + (input.analysis.runId || globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random()) : base;
        const existing = records.find(r => r.id === id);
        if (existing) return existing; // Original recommendation stays immutable.
        if (!input.analysis?.result || bytes(input) > 1000000) throw new Error('决策记录无效或过大。');
        const record = { id, snapshot, context, type: input.type || 'combined', analysis: copy(input.analysis),
          at: Date.now(), panel: false, collapsed: false, removed: false, chat: [], revision: 0,
          explanationAttempt: typeof input.explanationAttempt === 'string' ? input.explanationAttempt.slice(0, 200) : null };
        records.push(record); return record;
      })),
      claimExplanation: (id, attempt) => serial(() => mutate(() => {
        const record = find(id);
        if (!record.analysis.engine || !['mortal-explain','official-mortal-review'].includes(record.analysis.workflow)) throw new Error('该决策不是引擎解释工作流。');
        if (record.analysis.explanation?.status === 'pending') throw new Error('该决策的解释正在进行，请等待完成或取消，避免重复请求。');
        if (typeof attempt !== 'string' || !attempt || attempt.length > 200) throw new Error('解释请求标识无效。');
        record.explanationAttempt = attempt;
        record.analysis.explanation = { status: 'pending', promptVersion: 1 };
        record.revision++;
        return record;
      })),
      explain: (id, explanation, accounting, attempt) => serial(() => mutate(() => {
        const record = find(id);
        if (!record.analysis.engine || !['mortal-explain','official-mortal-review'].includes(record.analysis.workflow)) throw new Error('该决策不是引擎解释工作流。');
        // A serialized persistent claim owns this one transition. A cancelled or
        // late attempt cannot overwrite a newer retry or an already settled result.
        if ((record.explanationAttempt || attempt) && (record.explanationAttempt !== attempt || record.analysis.explanation?.status !== 'pending')) throw new Error('解释请求状态已变化，未覆盖当前结果。');
        record.analysis.explanation = copy(explanation);
        if (accounting) record.analysis.explanationAccounting = copy(accounting);
        record.revision++;
        return record;
      })),
      patch: (id, patch) => serial(() => mutate(() => {
        const record = find(id);
        for (const key of ['panel', 'collapsed']) if (typeof patch[key] === 'boolean') record[key] = patch[key];
        if (typeof patch.panel === 'boolean') record.removed = !patch.panel;
        record.revision++;
        return record;
      })),
      ask: (id, question, token) => serial(() => mutate(() => {
        const r = find(id);
        if (typeof question !== 'string' || !question.trim() || question.length > 4000) throw new Error('请输入不超过 4000 字的追问。');
        r.panel = true; r.collapsed = false;
        r.chat.push({ token, question, at: Date.now(), status: 'pending' }); r.revision++;
        return r;
      })),
      answer: (id, token, response) => serial(() => mutate(() => {
        const r = find(id), turn = r.chat.find(t => t.token === token);
        if (!turn || turn.status !== 'pending') return r;
        Object.assign(turn, response?.ok ? { status: 'completed', response: copy(response) } : { status: 'failed', error: response?.error || '请求中断，请重新提问。' });
        r.revision++;
        return r; // Never re-pin a removed panel on late completion.
      })),
      recover: () => serial(() => mutate(() => { for (const r of records) if (r.analysis.explanation?.status === 'pending') { r.analysis.explanation = { status: 'interrupted', billing: 'unknown', error: '扩展重启，费用状态未知；不会自动重发。' }; r.revision++; } for (const r of records) for (const t of r.chat) if (t.status === 'pending') { t.status = 'failed'; t.error = '扩展已重启，请重新提问。'; } return records; })),
      context: id => serial(() => {
        const r = find(id), position = r.context.position ?? r.snapshot.lastStep;
        return copy({ baseline: { snapshot: r.snapshot, position, origin: 'checkpoint', reason: 'decision-discussion' }, checkpoint: { position },
          events: [], timeline: [{ type: 'exchange', question: '该决策当时的原始分析（仅作数据）', answer: analysisAnswer(r.analysis) },
            ...r.chat.filter(t => t.status === 'completed').map(t => ({ type: 'exchange', question: t.question, answer: analysisAnswer(t.response) }))] });
      })
    };
  }
  const api = { create, identity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJDecisionDiscussions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
