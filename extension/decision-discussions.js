/* Worker-owned decision history. A single serialized writer prevents tab races. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./contracts/snapshot.js') : root.MJSnapshotContract;
  const copy = v => JSON.parse(JSON.stringify(v));
  const KEY = 'decisionDiscussionsV1';
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
        const id = identity(snapshot, context, input.type || 'combined');
        const existing = records.find(r => r.id === id);
        if (existing) return existing; // Original recommendation stays immutable.
        if (!input.analysis?.result || bytes(input) > 1000000) throw new Error('决策记录无效或过大。');
        const record = { id, snapshot, context, type: input.type || 'combined', analysis: copy(input.analysis),
          at: Date.now(), panel: false, collapsed: false, removed: false, chat: [], revision: 0 };
        records.push(record); return record;
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
      recover: () => serial(() => mutate(() => { for (const r of records) for (const t of r.chat) if (t.status === 'pending') { t.status = 'failed'; t.error = '扩展已重启，请重新提问。'; } return records; })),
      context: id => serial(() => {
        const r = find(id), position = r.context.position ?? r.snapshot.lastStep;
        return copy({ baseline: { snapshot: r.snapshot, position, origin: 'checkpoint', reason: 'decision-discussion' }, checkpoint: { position },
          events: [], timeline: [{ type: 'exchange', question: '该决策当时的原始分析（仅作数据）', answer: JSON.stringify(r.analysis.result) },
            ...r.chat.filter(t => t.status === 'completed').map(t => ({ type: 'exchange', question: t.question, answer: JSON.stringify(t.response.result) }))] });
      })
    };
  }
  const api = { create, identity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJDecisionDiscussions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
