(function (root) {
  'use strict';
  const scriptUrl = typeof document !== 'undefined' ? document.currentScript?.src : '';
  function start() {
    if (document.getElementById('mj-agent-host') || document.getElementById('mj-observer-host')) return null;
    const ports = root.MJCollectorBrowser.create({ window: root.window, scriptUrl: scriptUrl });
    const controller = root.MJCollectorController.create(ports);
    const hints = root.MJHandHints.create({ onCalibrationChange(state) {
      analysis.render();
      if (!state.editing) document.getElementById('mj-agent-host')?.shadowRoot?.querySelector('#analysis-calibrate')?.focus({ preventScroll: true });
    } });
    let memoryAdvice = null;
    const hintHooks = { onHints: value => {
      memoryAdvice = value?.decision ? JSON.stringify({ action: value.decision.action, tile: value.decision.tile,
        reasons: (value.decision.reasons || []).filter(reason => typeof reason === 'string').slice(0, 3).map(reason => reason.slice(0, 160)) }) : null;
      hints.update(value);
    } };
    const panel = root.MJCollectorPanel.create({ controller, title: '雀魂牌局获取器', tileBase: ports.tileBase, collapsed: false, dismissible: true });
    const analysis = root.MJFloatingPanel.create({ id: 'mj-agent-host', title: 'Majsoul Agent', positionKey: 'mj-agent-panel-position-v1',
      onRender(container, render) {
        let analysisSlot = container.querySelector('[data-analysis-slot]');
        if (!analysisSlot) {
          analysisSlot = document.createElement('div'); analysisSlot.dataset.analysisSlot = '';
          container.appendChild(analysisSlot);
        }
        const view = controller.getView(), state = view.state, S = root.__MJ_OBSERVER_STATE_V1__;
        const selfHand = (state.source === 'replay' ? state.players[state.selfSeat]?.hand : state.selfHand) || [];
        const drawnTile = state.drawnTiles[state.selfSeat] || null;
        const hand = S.handLayout(selfHand, drawnTile);
        const calibration = hints.getCalibrationState();
        const analysisView = {
          importOfficialReport: async (html, rules) => {
            const parsed = root.MJOfficialMortalReport.parse(html), observation = controller.exportData();
            if (view.mode !== 'replay' || view.historical) throw new Error('仅可在本地牌谱复盘中导入官方报告。');
            const converted = root.MJNagaReplay.fromObservation(observation, { rules });
            const rounds = converted.rounds.map(r => ({ id: r.id, log: r.json.log[0] }));
            const candidates = []; let roundId = null, frozen = S.initial('replay', parsed.player);
            const records = observation.replayRecords;
            for (let index = 0; index < records.length; index++) {
              const event = records[index]; if (event.kind === 'NewRound') roundId = 'round-' + index;
              frozen = S.apply(frozen, event);
              if (event.kind !== 'DealTile' || event.seat !== parsed.player || frozen.players[parsed.player].melds.length) continue;
              const next = records[index + 1];
              if (next?.kind !== 'DiscardTile' || next.seat !== parsed.player || next.riichi) continue;
              try { candidates.push({ roundId, cursor: index + 1, actualTile: next.tile,
                snapshot: root.MJCollectorSnapshot.snapshot(frozen, { game: true, rivers: 'all', hand: true }),
                context: { identity: view.contextIdentity, position: index + 1 } }); } catch (_) { /* Incomplete positions stay unmatched. */ }
            }
            const aligned = root.MJOfficialMortalReport.align(parsed, { rounds, candidates });
            const hash = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
            return { ...aligned, fingerprint: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,'0')).join('') };
          },
          snapshot: selection => root.MJCollectorSnapshot.snapshot(state, selection),
          analysisContext: () => {
            const observation = controller.exportData();
            const prefix = view.historical ? [] : view.mode === 'replay' ? observation.replayRecords.slice(0, view.cursor) : observation.events;
            let start = prefix.length - 1;
            while (start >= 0 && prefix[start].kind !== 'NewRound') start--;
            // The worker applies the actual data-selection whitelist again before storing or sending.
            const windowStart = Math.max(0, start);
            const window = prefix.slice(windowStart);
            const replay = view.mode === 'replay' && !view.historical;
            const eventPosition = e => replay ? (Number.isInteger(e.recordIndex) ? e.recordIndex + 1 : null) : (Number.isInteger(e.step) ? e.step : null);
            // Replay cursor counts records; recordIndex is zero-based. Coverage uses cursor coordinates.
            const eventWindowStart = window.map(eventPosition).find(p => p !== null) ?? null;
            const events = window.map(e => ({
              kind: e.kind, source: e.source, step: e.step, recordIndex: e.recordIndex, seat: e.seat,
              tile: e.kind === 'DealTile' && e.seat !== state.selfSeat ? '?' : e.tile,
              tiles: e.tiles, meldType: e.meldType, riichi: e.riichi, tsumogiri: e.tsumogiri
            }));
            return { identity: view.contextIdentity, position: replay ? view.cursor : state.lastStep, events,
              eventWindowStart, historyComplete: start >= 0 && windowStart === start };
          },
          engineRequest: selection => {
            if (!selection.game || selection.rivers !== 'all' || !selection.hand) throw new Error('专业引擎需要授权对局信息、全部牌河和自家手牌。');
            return root.MJMjaiAdapter.fromObservation(controller.exportData(), { seat: state.selfSeat, hand: true });
          },
          seatLabels: state.players.slice(0, state.scores.length === 3 ? 3 : 4).map((_, i) => S.seatWind(state, i) + '家'),
          phase: state.phase, matchEnded: state.result?.gameEnded === true, round: state.round, selfSeat: state.selfSeat,
          selfHand: hand.tiles.concat(hand.drawn ? [hand.drawn] : []), drawnTile: hand.drawn,
          riichiLabels: view.historical ? [] : S.opponentRiichi(state).map(i => S.seatWind(state, i) + '家'),
          hintsReady: calibration.available, hintsCalibrated: calibration.calibrated,
          recordCount: view.recordCount,
          onMode: mode => controller.setMode(mode), onCursor: cursor => controller.setCursor(cursor),
          onRoundStart: () => controller.roundStart(), onSelfSeat: seat => controller.setSelfSeat(seat),
          onCollector: () => panel.open(), onHistory: () => panel.open({ history: true }),
          onCalibrateHints: () => { hints.startCalibration(); }
        };
        root.MJAnalysisPanel.mount(analysisSlot, analysisView, {
          mode: view.historical ? 'history' : view.mode, historyView: view.historyView,
          contextIdentity: view.contextIdentity,
          health: view.mode === 'live' && !view.historical ? view.health : undefined,
          replayRevision: view.mode === 'replay' ? view.replayRevision : null,
          cursor: !view.historical && view.mode === 'replay' ? view.cursor : null
        }, render, hintHooks);
        let replaySlot = container.querySelector('[data-naga-slot]');
        if (!replaySlot) {
          replaySlot = document.createElement('div'); replaySlot.dataset.nagaSlot = '';
          container.appendChild(replaySlot);
        }
        root.MJNagaPanel.mount(replaySlot, {
          mode: view.historical ? 'history' : view.mode,
          recordCount: view.recordCount, replayRevision: view.replayRevision,
          exportReplay: () => controller.exportData()
        }, render);
      }
    });
    analysis.mount();
    // The analysis renderer invalidates stale hints synchronously with each state change.
    const unsubscribe = controller.subscribe(() => analysis.render());
    const memory = root.MJUserMemoryCapture.create({
      send: message => root.chrome?.runtime?.sendMessage(message) || Promise.resolve({ enabled: false }),
      snapshot: root.MJCollectorSnapshot.snapshot
    });
    memory.status();
    const onMemoryConfig = message => { if (message?.type === 'model:config-changed') memory.status(); };
    root.chrome?.runtime?.onMessage?.addListener(onMemoryConfig);
    const disconnect = ports.connect({ receive(message) {
      const before = controller.getView(), advice = memoryAdvice; controller.receive(message);
      memory.record(before, message, controller.getView(), advice);
    } });
    return { controller, panel, analysis, hints, destroy() { root.chrome?.runtime?.onMessage?.removeListener(onMemoryConfig); disconnect(); unsubscribe(); root.MJAnalysisPanel.destroy?.(); root.MJNagaPanel.destroy(); hints.destroy(); analysis.destroy(); panel.destroy(); } };
  }
  root.MJAgentApp = { start };
  if (typeof document !== 'undefined') {
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
