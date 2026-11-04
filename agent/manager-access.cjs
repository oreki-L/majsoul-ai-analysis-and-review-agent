'use strict';
const crypto = require('node:crypto');
const random = () => crypto.randomBytes(32).toString('hex');
// All credentials are bounded, process-local and discarded when this server exits.
function createAccess({ now = Date.now, ticketTtl = 60000, sessionTtl = 8 * 3600000, pairTtl = 120000 } = {}) {
  const tickets = new Map(), sessions = new Map(), pairs = new Map();
  const clean = map => { for (const [key, value] of map) if (value.expires <= now()) map.delete(key); };
  const cookieName = 'mj_manager_session';
  function ticket() { clean(tickets); if (tickets.size >= 16) tickets.delete(tickets.keys().next().value); const key = random(); tickets.set(key, { expires: now() + ticketTtl }); return key; }
  function exchange(key) {
    clean(tickets); clean(sessions); if (!tickets.delete(key)) return null;
    if (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
    const session = random(); sessions.set(session, { expires: now() + sessionTtl });
    return `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`;
  }
  function session(req) { clean(sessions); const key = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1); return sessions.has(key); }
  function pending() { clean(pairs); return [...pairs].filter(([, p]) => !p.approved).map(([id, p]) => ({ id, origin: p.origin, profile: p.profile, expires: p.expires })); }
  function request(origin, nonce, profile) {
    clean(pairs);
    if (!/^[a-f0-9]{64}$/.test(nonce || '') || !/^[a-z0-9-]{1,64}$/.test(profile || '')) throw new Error('INVALID_PAIR_REQUEST');
    if (pairs.size >= 16) throw new Error('PAIR_LIMIT');
    if ([...pairs.values()].some(p => p.nonce === nonce)) throw new Error('PAIR_REPLAY');
    const id = random(); pairs.set(id, { origin, nonce, profile, expires: now() + pairTtl }); return id;
  }
  function approve(id, bridge) {
    clean(pairs); const p = pairs.get(id);
    if (!p || p.approved || bridge.state !== 'running' || bridge.profile !== p.profile) throw new Error('PAIR_MODEL_NOT_RUNNING');
    p.approved = { profile: bridge.profile, endpoint: bridge.url, apiKey: bridge.token };
  }
  function claim(id, origin, nonce, bridge) {
    clean(pairs); const p = pairs.get(id);
    if (!p || p.origin !== origin || p.nonce !== nonce) throw new Error('PAIR_EXPIRED_OR_REJECTED');
    if (!p.approved) return { pending: true };
    pairs.delete(id);
    if (bridge.state !== 'running' || bridge.profile !== p.approved.profile || bridge.token !== p.approved.apiKey || bridge.url !== p.approved.endpoint) throw new Error('PAIR_MODEL_CHANGED');
    return { format: 'local-analysis-pair-v1', ...p.approved };
  }
  return { ticket, exchange, session, pending, request, approve, claim };
}
module.exports = { createAccess };
