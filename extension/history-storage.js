/* Runs only in the extension service worker. History never shares the model settings key. */
(function (root) {
  'use strict';
  const HISTORY = 'roundHistoryV1';
  const storage = chrome.storage.local;
  const readHistory = async () => (await storage.get(HISTORY))[HISTORY] ?? [];
  const publicHistory = matches => matches.map(({ completionEventId, ...match }) => match);
  let historyWrites = Promise.resolve(), inbox;
  function serial(work) {
    const operation = historyWrites.then(work);
    historyWrites = operation.catch(() => {});
    return operation;
  }

  function enableCompletionInbox(contract) {
    if (inbox) return inbox.port;
    const { KEY, MAX_PENDING, parse, unexpired, committed, publicEvent, createEntry } = contract;
    const listeners = new Set();
    const counts = { unavailable: 0, projectionFailed: 0, full: 0, jointWriteFailed: 0 };
    const note = reason => { counts[reason] = Math.min(counts[reason] + 1, Number.MAX_SAFE_INTEGER); };
    const read = async () => parse((await storage.get(KEY))[KEY]);
    const write = entries => storage.set({ [KEY]: entries });
    const port = Object.freeze({
      listCommitted: () => serial(async () => {
        const entries = await read();
        const active = entries.filter(entry => unexpired(entry, Date.now()));
        const history = active.length ? await readHistory() : [];
        const verified = active.filter(entry => committed(entry, history));
        if (verified.length !== entries.length) {
          try { await write(verified); } catch (_) { note('unavailable'); }
        }
        return verified.map(publicEvent);
      }),
      ack: id => serial(async () => {
        const entries = await read(), now = Date.now();
        const remaining = entries.filter(entry => entry.event.id !== id && unexpired(entry, now));
        if (remaining.length !== entries.length) await write(remaining);
      }),
      discardPending: () => serial(() => write([])),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getStatus: () => ({ ...counts })
    });

    async function append(matches, previous, normalized, message, sender) {
      let entry;
      try { entry = createEntry(normalized, message.match, message.matchStart, sender); }
      catch (_) { note('projectionFailed'); return false; }
      if (!entry) return false;
      let pending;
      try {
        const entries = await read(), now = Date.now();
        pending = entries.filter(item => unexpired(item, now) && committed(item, previous));
      }
      catch (_) { note('unavailable'); return false; }
      if (pending.length >= MAX_PENDING) { note('full'); return false; }
      const marked = matches.map(match => match === normalized ? { ...match, completionEventId: entry.event.id } : match);
      try { await storage.set({ [HISTORY]: marked, [KEY]: [...pending, entry] }); }
      catch (_) { note('jointWriteFailed'); return false; }
      return true;
    }
    function notify() {
      for (const listener of listeners) Promise.resolve().then(() => listener()).catch(() => {});
    }
    inbox = { port, append, notify };
    return port;
  }

  root.MJHistoryStorage = Object.freeze({ enableCompletionInbox });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['history:load', 'history:save'].includes(message?.type)) return;
    let game = false;
    try {
      const origin = new URL(sender.url).origin;
      game = sender.id === chrome.runtime.id && !!sender.tab && sender.frameId === 0 && origin === 'https://game.maj-soul.com' &&
        (!sender.origin || sender.origin === origin);
    } catch (_) {}
    if (!game) return;
    const operation = serial(async () => {
      const previous = await readHistory();
      if (message.type === 'history:load') return { matches: publicHistory(previous) };
      if (!message.match || typeof message.match !== 'object' || JSON.stringify(message.match).length > 1000000) throw new Error('整场记录过大');
      const prior = previous.find(match => match.id === message.match.id);
      if (prior?.source === 'live' && prior.closed === true && !message.match.closed) return { matches: publicHistory(previous) };
      const matches = MJHistory.merge(previous, message.match);
      const index = matches.findIndex(match => match.id === message.match.id);
      const normalized = matches[index];
      if (normalized && prior?.completionEventId && prior.startedAt === normalized.startedAt) {
        matches[index] = { ...normalized, completionEventId: prior.completionEventId };
      }
      const appended = inbox && normalized && !prior?.closed && !prior?.completionEventId &&
        await inbox.append(matches, previous, normalized, message, sender);
      if (!appended) await storage.set({ [HISTORY]: matches });
      return { matches: publicHistory(matches), appended };
    });
    operation.then(({ matches, appended }) => {
      if (appended) inbox.notify();
      respond({ ok: true, matches });
    }, () => respond({ ok: false, error: '本地记录保存或读取失败，请导出核对记录备份。' }));
    return true;
  });
})(globalThis);
