(function (root) {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  const SEND_TTL = 24 * HOUR;
  const RETAIN_TTL = 7 * SEND_TTL;
  const CAPACITY = 200;
  const MAX_ATTEMPTS = 5;
  const TIMEOUT = 10000;
  const LEASE = 60000;
  const MAX_BODY = 16384;
  const DB_NAME = 'mj-chat-delivery-v1';
  const TEST = 'app.majsoul.integration.test.v1';
  const SHARE = 'app.majsoul.review.summary.shared.v1';
  const COMPLETE = 'app.majsoul.match.completed.v1';
  const END_LABELS = { win: '和牌', exhaustive_draw: '荒牌流局', abortive_draw: '途中流局' };
  const LABELS = { strategy: '攻守与风险', efficiency: '牌效率', calls: '鸣牌与立直局面', questions: '用户疑问' };
  const encoder = new TextEncoder();
  const failed = code => ({ ok: false, code });
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
  const validVersion = value => (Number.isSafeInteger(value) && value > 0) || validId(value);
  const validCount = value => Number.isSafeInteger(value) && value >= 0;

  function normalizeDestination(input) {
    if (!input || !validId(input.id) || !validVersion(input.version)) return null;
    const { kind, secret = '', url: address } = input;
    if (kind !== 'webhook' && kind !== 'feishu') return null;
    if (typeof address !== 'string' || address.length > 2048 || typeof secret !== 'string' || secret.length > 1024) return null;
    if (!/^https:\/\/[^/\\?#]+/i.test(address.trim()) || /[\\\s\x00-\x1f]/.test(address.trim())) return null;
    let url;
    try { url = new URL(address.trim()); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname.includes('*') || url.href.includes('#') ||
      /@/.test(address.trim().slice(8).split(/[/?#]/, 1)[0])) return null;
    if (kind === 'webhook' && !secret.trim()) return null;
    if (kind === 'feishu' && (url.origin !== 'https://open.feishu.cn' || url.href.includes('?') ||
      !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname))) return null;
    return {
      id: input.id, version: input.version, kind,
      name: typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '',
      url: url.href, secret, enabled: input.enabled === true,
    };
  }

  function eventBody(event) {
    if (!event || event.specversion !== '1.0' || !validId(event.id) ||
      typeof event.source !== 'string' || !/^urn:majsoul-agent:installation:[A-Za-z0-9_-]{1,160}$/.test(event.source) ||
      ![TEST, SHARE, COMPLETE].includes(event.type) ||
      typeof event.time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(event.time) ||
      !Number.isFinite(Date.parse(event.time)) || event.datacontenttype !== 'application/json' ||
      !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
    const { specversion, id, source, type, time, datacontenttype, data } = event;
    let projection = {};
    if (type === SHARE) {
      const { roundCount, decisionCount, scope, topics = [] } = data;
      if (!validCount(roundCount) || !validCount(decisionCount) || scope !== 'retained-decisions' ||
        !Array.isArray(topics) || topics.length > Object.keys(LABELS).length ||
        Array.from(topics).some(topic => typeof topic !== 'string' || !Object.hasOwn(LABELS, topic))) return null;
      projection = { roundCount, decisionCount, scope, topics: Object.keys(LABELS).filter(key => topics.includes(key)) };
    } else if (type === COMPLETE) {
      const { playerCount, roundCount, endReason, finalScores } = data;
      if (![3, 4].includes(playerCount) || !validCount(roundCount) || roundCount < 1 || roundCount > 100 ||
          typeof endReason !== 'string' || !Object.hasOwn(END_LABELS, endReason) ||
          (finalScores !== undefined && (!Array.isArray(finalScores) || finalScores.length !== playerCount ||
            !Array.from(finalScores).every(score => Number.isSafeInteger(score) && Math.abs(score) <= 1000000)))) return null;
      projection = { playerCount, roundCount, endReason, ...(finalScores === undefined ? {} : { finalScores }) };
    }
    return JSON.stringify({ specversion, id, source, type, time, datacontenttype, data: projection });
  }

  function publicDelivery(row) {
    const { id, destinationId, destinationVersion, type, status, attempts, createdAt, updatedAt, errorCode } = row;
    return { id, deliveryId: id, destinationId, destinationVersion, type, status, attempts, createdAt, updatedAt, scope: row.scope,
      nextAttemptAt: status === 'pending' ? row.dueAt : null, errorCode };
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function openDatabase(indexedDB) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('events', { keyPath: 'key' });
        const deliveries = db.createObjectStore('deliveries', { keyPath: 'id' });
        deliveries.createIndex('route', ['eventKey', 'destinationId'], { unique: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(new Error('storage_unavailable'));
    });
  }

  function change(store, row, now, status, errorCode = null, dueAt = null) {
    Object.assign(row, { status, errorCode, dueAt, updatedAt: now, leaseUntil: null, leaseToken: null });
    store.put(row);
  }

  function reschedule(store, row, now, code, delay = 0) {
    if (row.attempts - row.attemptBase >= MAX_ATTEMPTS) {
      change(store, row, now, 'failed', code);
      return;
    }
    const backoff = Math.min(15 * 60000, 30000 * (2 ** Math.max(0, row.attempts - row.attemptBase - 1)));
    const dueAt = now + Math.max(backoff, delay);
    if (dueAt >= row.expiresAt) change(store, row, now, 'expired', 'delivery_expired');
    else change(store, row, now, 'pending', code, dueAt);
  }

  function maintain(stores, rows, now) {
    const retained = [];
    const removedEvents = new Set();
    for (const row of rows) {
      if (row.createdAt + RETAIN_TTL <= now) {
        stores.deliveries.delete(row.id);
        removedEvents.add(row.eventKey);
        continue;
      }
      if (row.status === 'sending' && row.leaseUntil <= now) {
        if (row.kind === 'feishu') change(stores.deliveries, row, now, 'unknown', 'lease_expired');
        else reschedule(stores.deliveries, row, now, 'lease_expired');
      }
      if (row.status === 'pending' && row.expiresAt <= now) {
        change(stores.deliveries, row, now, 'expired', 'delivery_expired');
      }
      retained.push(row);
    }
    for (const row of retained) removedEvents.delete(row.eventKey);
    for (const key of removedEvents) stores.events.delete(key);
    return retained;
  }

  function retryAfter(response, now) {
    const value = response.headers?.get('Retry-After')?.trim();
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    const time = Date.parse(value);
    return Number.isFinite(time) ? Math.max(0, time - now) : 0;
  }

  async function hmac(key, data) {
    const cryptoKey = await root.crypto.subtle.importKey('raw', encoder.encode(key),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await root.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
  }

  function feishuText(event) {
    if (event.type === TEST) return '雀魂插件：聊天渠道测试消息';
    if (event.type === COMPLETE) {
      const { playerCount, roundCount, endReason, finalScores } = event.data;
      return `雀魂整场结算：${playerCount} 人麻将，记录 ${roundCount} 小局，${END_LABELS[endReason]}结束` +
        (finalScores ? `\n终局点数（按座位顺序）：${finalScores.join(' / ')}` : '');
    }
    const { roundCount, decisionCount, topics } = event.data;
    const summary = `雀魂插件赛后摘要（仅留存分析样本）：${roundCount} 小局，${decisionCount} 条决策`;
    return topics.length ? `${summary}\n主题：${topics.map(key => LABELS[key]).join('、')}` : summary;
  }

  async function makeRequest(destination, event, timestamp) {
    if (destination.kind === 'webhook') {
      const signature = await hmac(destination.secret, `${timestamp}.${event.body}`);
      const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
      return {
        headers: {
          'Content-Type': 'application/cloudevents+json',
          'X-MJ-Timestamp': timestamp,
          'X-MJ-Signature': `sha256=${hex}`,
        },
        body: event.body,
      };
    }
    const message = { msg_type: 'text', content: { text: feishuText(JSON.parse(event.body)) } };
    if (destination.secret) {
      const signature = await hmac(`${timestamp}\n${destination.secret}`, '');
      message.timestamp = timestamp;
      message.sign = btoa(String.fromCharCode(...signature));
    }
    return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) };
  }

  async function readResult(response) {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let length = 0;
    let body = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return JSON.parse(body + decoder.decode());
        length += value.byteLength;
        if (length > MAX_BODY) return null;
        body += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  async function classify(response, kind, now) {
    const status = response.status;
    if (response.redirected || response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
      return { status: 'failed', code: 'redirect_rejected' };
    }
    if (status === 429) return { status: 'retry', code: 'rate_limited', delay: retryAfter(response, now) };
    if (!Number.isInteger(status) || status < 200 || status === 408 || status >= 500) {
      return kind === 'feishu'
        ? { status: 'unknown', code: 'confirmation_unknown' }
        : { status: 'retry', code: 'http_temporary', delay: retryAfter(response, now) };
    }
    if (status >= 400) return { status: 'failed', code: 'http_rejected' };
    if (kind === 'webhook') return { status: 'accepted' };
    const body = await readResult(response).catch(() => null);
    const codes = [body?.code, body?.StatusCode].filter(code => code !== undefined);
    if (!codes.length || codes.some(code => !Number.isInteger(code) || code !== codes[0])) {
      return { status: 'unknown', code: 'confirmation_unknown' };
    }
    if (codes[0] === 0) return { status: 'accepted' };
    if (codes[0] === 11232) return { status: 'retry', code: 'rate_limited', delay: retryAfter(response, now) };
    return { status: 'failed', code: 'platform_rejected' };
  }

  function create({ indexedDB = root.indexedDB, fetchRequest = root.fetch?.bind(root), clock = Date.now,
    resolveDestination, hasPermission, canPump = () => true,
    authorizeDispatch = (destination, signal, send) => send(signal) } = {}) {
    let database;
    let pumping;
    const inFlight = new Map();

    async function transaction(work) {
      const db = await (database ||= openDatabase(indexedDB).then(connection => {
        connection.onversionchange = connection.onclose = () => {
          connection.close();
          database = null;
        };
        return connection;
      }).catch(() => {
        database = null;
        throw new Error('storage_unavailable');
      }));
      const tx = db.transaction(['events', 'deliveries'], 'readwrite', { durability: 'strict' });
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      done.catch(() => {});
      try {
        const result = await work({ events: tx.objectStore('events'), deliveries: tx.objectStore('deliveries') });
        await done;
        return result;
      } catch {
        try { tx.abort(); } catch {}
        throw new Error('storage_unavailable');
      }
    }

    async function currentRows(stores, now) {
      return maintain(stores, await requestResult(stores.deliveries.getAll()), now);
    }

    async function enqueue({ event, destinations, expiresAt } = {}) {
      let body;
      try { body = eventBody(event); } catch { return failed('invalid_event'); }
      if (!body) return failed('invalid_event');
      if (!Array.isArray(destinations) || !destinations.length || destinations.length > CAPACITY) return failed('invalid_destination');
      const refs = new Map();
      for (const ref of destinations) {
        const previous = refs.get(ref?.id);
        if (!validId(ref?.id) || !validVersion(ref.version) ||
          (previous && (previous.version !== ref.version || previous.scope !== ref.scope))) return failed('invalid_destination');
        if (event.type === COMPLETE ? !validId(ref.scope) : ref.scope !== undefined) return failed('invalid_destination');
        refs.set(ref.id, ref);
      }
      const envelope = JSON.parse(body);
      const eventKey = JSON.stringify([envelope.source, envelope.id]);
      return transaction(async stores => {
        const now = clock();
        const rows = await currentRows(stores, now);
        const existing = await requestResult(stores.events.get(eventKey));
        if (existing && existing.body !== body) return failed('event_conflict');
        const byTarget = new Map(rows.filter(row => row.eventKey === eventKey).map(row => [row.destinationId, row]));
        const additions = [...refs].filter(([id]) => !byTarget.has(id));
        const deadline = envelope.type === COMPLETE && Number.isFinite(expiresAt) ? Math.min(expiresAt, now + SEND_TTL) : now + SEND_TTL;
        if (additions.length && deadline <= now) return failed('delivery_expired');
        if (rows.length + additions.length > CAPACITY) return failed('queue_full');
        if (!existing) stores.events.add({ key: eventKey, body });
        for (const [destinationId, { version: destinationVersion, scope }] of additions) {
          const row = {
            id: root.crypto.randomUUID(), eventKey, destinationId, destinationVersion, scope, type: envelope.type,
            status: 'pending', attempts: 0, attemptBase: 0, createdAt: now, updatedAt: now,
            expiresAt: deadline, dueAt: now, errorCode: null,
          };
          stores.deliveries.add(row);
          byTarget.set(destinationId, row);
        }
        return { ok: true, deliveries: [...refs.keys()].map(id => publicDelivery(byTarget.get(id))) };
      }).catch(() => failed('storage_unavailable'));
    }

    async function claim() {
      return transaction(async stores => {
        const now = clock();
        const rows = await currentRows(stores, now);
        const busy = new Set(rows.filter(row => row.status === 'sending').map(row => row.destinationId));
        const row = rows.filter(item => item.status === 'pending' && item.dueAt <= now && !busy.has(item.destinationId))
          .sort((left, right) => left.dueAt - right.dueAt || left.createdAt - right.createdAt)[0];
        if (!row) return null;
        const event = await requestResult(stores.events.get(row.eventKey));
        Object.assign(row, { status: 'sending', updatedAt: now, leaseUntil: now + LEASE,
          leaseToken: root.crypto.randomUUID(), kind: null, errorCode: null });
        stores.deliveries.put(row);
        return { row, event };
      });
    }

    async function markDispatched(row, kind) {
      return transaction(async stores => {
        const current = await requestResult(stores.deliveries.get(row.id));
        const now = clock();
        if (current?.leaseToken !== row.leaseToken || now >= current.leaseUntil || now >= current.expiresAt) return false;
        current.kind = kind;
        current.attempts += 1;
        stores.deliveries.put(current);
        return true;
      });
    }

    async function send({ row, event }) {
      if (!event) return { status: 'failed', code: 'event_unavailable' };
      const controller = new AbortController();
      inFlight.set(row.id, controller);
      let timer;
      let dispatched = false;
      try {
        const deadline = new Promise((unusedResolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('request_aborted')), { once: true });
          timer = setTimeout(() => controller.abort(), TIMEOUT);
        });
        const outcome = await Promise.race([deadline, (async () => {
          const destination = normalizeDestination(await resolveDestination(row.destinationId, row.destinationVersion));
          if (!destination || destination.id !== row.destinationId || !destination.enabled ||
            destination.version !== row.destinationVersion) return { status: 'failed', code: 'destination_changed' };
          const request = await makeRequest(destination, event, String(Math.floor(clock() / 1000)));
          if (!await hasPermission(destination.url)) {
            return { status: 'failed', code: 'permission_denied' };
          }
          if (controller.signal.aborted || !await markDispatched(row, destination.kind) || controller.signal.aborted) return null;
          return authorizeDispatch(destination, controller.signal, async signal => {
            if (signal.aborted) return { status: 'failed', code: 'preflight_failed' };
            dispatched = destination.kind;
            let response;
            try {
              response = await fetchRequest(destination.url, {
                ...request, method: 'POST', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer',
                cache: 'no-store', signal,
              });
              return await classify(response, destination.kind, clock());
            } finally {
              response?.body?.cancel().catch(() => {});
            }
          }, row.scope, row.expiresAt);
        })()]);
        return outcome && { ...outcome, unattempted: !dispatched };
      } catch {
        if (dispatched === 'webhook') return { status: 'retry', code: 'transport_error' };
        if (dispatched === 'feishu') return { status: 'unknown', code: 'confirmation_unknown' };
        return { status: 'failed', code: 'preflight_failed', unattempted: true };
      } finally {
        clearTimeout(timer);
        inFlight.delete(row.id);
      }
    }

    async function settle(row, outcome) {
      return transaction(async stores => {
        const current = await requestResult(stores.deliveries.get(row.id));
        if (current?.leaseToken !== row.leaseToken) return;
        const now = clock();
        if (outcome?.unattempted && current.kind) current.attempts--;
        if (!outcome) change(stores.deliveries, current, now, 'expired', 'delivery_expired');
        else if (outcome.status === 'retry') reschedule(stores.deliveries, current, now, outcome.code, outcome.delay);
        else change(stores.deliveries, current, now, outcome.status, outcome.code);
      });
    }

    function pump() {
      if (!pumping) pumping = (async () => {
        let processed = 0;
        try {
          while (processed < 20 && canPump()) {
            const item = await claim();
            if (!item) break;
            await settle(item.row, await send(item));
            processed += 1;
          }
          return { ok: true, processed };
        } catch {
          return failed('storage_unavailable');
        }
      })().finally(() => { pumping = null; });
      return pumping;
    }

    async function list({ includeDeadline = false } = {}) {
      return transaction(async stores => (await currentRows(stores, clock()))
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(row => includeDeadline ? { ...publicDelivery(row), expiresAt: row.expiresAt } : publicDelivery(row)));
    }

    async function clear() {
      for (const controller of inFlight.values()) controller.abort();
      return transaction(async stores => {
        const cleared = await requestResult(stores.deliveries.count());
        stores.events.clear();
        stores.deliveries.clear();
        return { ok: true, cleared };
      }).catch(() => failed('storage_unavailable'));
    }

    async function retry(deliveryId) {
      return transaction(async stores => {
        const now = clock();
        const row = (await currentRows(stores, now)).find(item => item.id === deliveryId);
        if (!row) return failed('delivery_not_found');
        if (!['failed', 'unknown'].includes(row.status) || now >= row.expiresAt) return failed('not_retryable');
        row.attemptBase = row.attempts;
        change(stores.deliveries, row, now, 'pending', null, now);
        return { ok: true, delivery: publicDelivery(row) };
      }).catch(() => failed('storage_unavailable'));
    }

    async function nextDue() {
      return transaction(async stores => {
        const rows = await currentRows(stores, clock());
        const leases = new Map(rows.filter(row => row.status === 'sending').map(row => [row.destinationId, row.leaseUntil]));
        const due = [...leases.values()];
        for (const row of rows) {
          if (row.status === 'pending') due.push(Math.min(row.expiresAt, Math.max(row.dueAt, leases.get(row.destinationId) || 0)));
        }
        return due.length ? Math.min(...due) : null;
      });
    }

    return { enqueue, pump, list, clear, retry, nextDue };
  }

  const api = { create, normalizeDestination, validateDestination: input => normalizeDestination(input) !== null };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJChatDelivery = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
