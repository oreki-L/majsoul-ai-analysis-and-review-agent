'use strict';
function sampleRequest() {
  return { format: 'majsoul-mjai-v1', seat: 0, events: [
    { type: 'start_game', id: 0, names: ['Player 0', 'Player 1', 'Player 2', 'Player 3'] },
    { type: 'start_kyoku', bakaze: 'E', dora_marker: '2s', kyoku: 1, honba: 0, kyotaku: 0, oya: 0,
      scores: [25000, 25000, 25000, 25000], tehais: [
        ['E', '6p', '9m', '8m', 'C', '2s', '7m', 'S', '6m', '1m', 'S', '3s', '8m'],
        ...Array.from({ length: 3 }, () => Array(13).fill('?'))] },
    { type: 'tsumo', actor: 0, pai: '1m' }
  ] };
}
module.exports = { sampleRequest };
