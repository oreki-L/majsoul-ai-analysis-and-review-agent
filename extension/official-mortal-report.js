/* Finite data adapter for the public English Classic 1.5.3 sample. No HTML is rendered. */
(function (root) {
  'use strict';
  const VERSION = 'classic-en-1.5.3-v1';
  const fail = text => { throw new Error(text); };
  const tile = text => /^5[mps]r$/.test(text) ? '0' + text[1] : /^[1-9][mps]$/.test(text) ? text : ({ e: '1z', s: '2z', w: '3z', n: '4z', p: '5z', f: '6z', c: '7z' })[text] || null;
  const tiles = text => [...text.matchAll(/href=#pai-([a-z0-9]+)/g)].map(m => tile(m[1]));
  function officialUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) fail('请粘贴雀魂原生分享链接。');
    let url; try { url = new URL(value.trim()); } catch (_) { fail('雀魂分享链接无效。'); }
    if (url.protocol !== 'https:' || !['game.maj-soul.com', 'game.mahjongsoul.com', 'mahjongsoul.game.yo-star.com'].includes(url.hostname) || url.username || url.password || !url.searchParams.get('paipu')) fail('仅接受含 paipu 参数的 HTTPS 雀魂分享链接；不从本地对局 ID 拼接。');
    return 'https://mjai.ekyu.moe/zh-cn.html?url=' + encodeURIComponent(url.href);
  }
  function parse(html) {
    if (typeof html !== 'string' || html.length > 5 * 1024 * 1024) fail('报告为空或超过 5 MB。');
    // Strip executable/foreign containers as text, never instantiate a DOM or fetch resources.
    const data = html.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const meta = label => data.match(new RegExp('<dt>' + label + '<dd>([^<]+)'))?.[1]?.trim();
    if (meta('engine') !== 'Mortal' || meta('mjai-reviewer version') !== '1.5.3' || meta('game length') !== 'Hanchan' || !/^mortal3-[\w-]{1,100}$/.test(meta('model tag') || '')) fail('不支持该报告格式：仅支持已验收的英文 Classic 1.5.3 / Mortal 3；当前 4.1、KillerDucky 和 CLI JSON 尚未支持。');
    const player = Number(meta('player id'));
    if (!Number.isInteger(player) || player < 0 || player > 3) fail('报告缺少可核对的玩家视角。');
    const rounds = [], entries = [];
    for (const section of data.split(/<section style=z-index:\d+>/).slice(1)) {
      const id = section.match(/<h1 class=kyoku-heading id=kyoku-(\d+)-(\d+)>/);
      const rawLog = section.match(/<textarea\b[^>]*>([^<]+)<\/textarea>/)?.[1];
      if (!id || !rawLog) fail('Classic 小局结构不完整。');
      let json; try { json = JSON.parse(rawLog); } catch (_) { fail('Classic 小局 JSON 无效。'); }
      if (!Array.isArray(json.log) || json.log.length !== 1 || !Array.isArray(json.log[0]) || json.log[0].length !== 17 || json.log[0][0]?.[0] !== +id[1] || json.log[0][0]?.[1] !== +id[2]) fail('Classic 小局身份与动作记录不一致。');
      const round = { kyoku: +id[1], honba: +id[2], log: json.log[0] }; rounds.push(round);
      for (const block of section.split(/<details class="collapse entry"[^>]*>/).slice(1)) {
        const index = entries.length, header = block.match(/<summary>Turn (\d+) \(×(\d+)\)/), handBlock = block.match(/<ul class=tehai-state>([\s\S]*?)<\/ul>/)?.[1];
        const action = who => block.match(new RegExp('class=role>' + who + ': </span>([\\s\\S]*?)(?:<details>|<br>|</span> )'))?.[1];
        // The final recommendation precedes the candidate table. Candidate Q never selects an action.
        const mortal = block.split('class=role>Mortal: </span>')[1]?.split('<details>')[0];
        const actual = action('Player');
        const expectedTiles = tiles(mortal || ''), actualTiles = tiles(actual || ''), hand = tiles(handBlock || '');
        const supported = !!header && !!handBlock && hand.length === 14 && hand.every(Boolean) && /^Discard /.test(mortal || '') && /^Discard /.test(actual || '') && expectedTiles.length === 1 && actualTiles.length === 1 && hand.includes(expectedTiles[0]) && hand.includes(actualTiles[0]);
        entries.push({ index, kyoku: round.kyoku, honba: round.honba, turn: header ? +header[1] : null, remaining: header ? +header[2] : null,
          status: supported ? 'unmatched' : 'unsupported', ...(supported ? { hand, expectedTile: expectedTiles[0], actualTile: actualTiles[0] } : { reason: '首版仅支持无副露、摸牌后的普通弃牌；其他动作明确未适配。' }) });
      }
    }
    if (!rounds.length || rounds.length > 32 || !entries.length || entries.length > 2000) fail('Classic 报告小局或条目数量无效。');
    return { format: 'official-mortal-import-v1', parserVersion: VERSION, model: meta('model tag'), reviewerVersion: '1.5.3', player,
      rules: 'four-player-hanchan', generatedAt: meta('generated at') || 'unknown', rounds, entries };
  }
  function align(report, local) {
    const entries = report.entries.map(entry => {
      if (entry.status === 'unsupported') return { ...entry };
      const sourceRound = report.rounds.find(r => r.kyoku === entry.kyoku && r.honba === entry.honba);
      // Full round action sequences (all seats) must match before a cursor can bind.
      const rounds = local.rounds.filter(r => JSON.stringify(r.log.slice(0, 16)) === JSON.stringify(sourceRound.log.slice(0, 16)));
      if (rounds.length !== 1) return { ...entry, status: rounds.length > 1 ? 'ambiguous' : 'unmatched', reason: '未核对到唯一完整小局动作序列。' };
      const matches = local.candidates.filter(c => c.roundId === rounds[0].id && c.snapshot.source === 'replay' && c.snapshot.selfSeat === report.player && c.snapshot.game?.remaining === entry.remaining &&
        JSON.stringify([...c.snapshot.selfHand].sort()) === JSON.stringify([...entry.hand].sort()) && c.actualTile === entry.actualTile);
      return matches.length === 1 ? { ...entry, status: 'matched', cursor: matches[0].cursor, snapshot: matches[0].snapshot, context: matches[0].context }
        : { ...entry, status: matches.length > 1 ? 'ambiguous' : 'unmatched', reason: '手牌、牌山、座位及实际动作未定位到唯一摸牌后游标。' };
    });
    return { ...report, entries, coverage: Object.fromEntries(['matched','ambiguous','unsupported','unmatched'].map(status => [status, entries.filter(e => e.status === status).length])) };
  }
  const api = { parse, align, officialUrl, VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJOfficialMortalReport = api;
})(globalThis);
