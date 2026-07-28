import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadController() {
  const source = await readFile(new URL('../assets/live-series-nav.js', import.meta.url), 'utf8');
  const context = {
    console,
    queueMicrotask: callback => callback(),
    clearInterval: () => {},
    document: {
      getElementById: () => null,
      createElement: () => ({
        className: '',
        innerHTML: '',
        setAttribute: () => {},
        querySelector: () => null
      })
    },
    state: {},
    gameContent: {
      querySelector: () => null,
      addEventListener: () => {}
    },
    renderGame: () => {},
    loadGame: async () => {},
    selectEvent: async () => {},
    startPolling: () => {},
    setJsonEndpoint: () => {},
    setConnection: () => {},
    api: async () => ({}),
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'live-series-nav.js' });
  return context.RiftPulseLiveSeries;
}

test('active series navigation includes previous games through the current game', async () => {
  const controller = await loadController();
  const games = controller.playedSeriesGames({
    match: {
      teams: [
        { result: { gameWins: 1 } },
        { result: { gameWins: 1 } }
      ],
      games: [
        { id: 'g1', number: 1, state: 'completed' },
        { id: 'g2', number: 2, state: 'completed' },
        { id: 'g3', number: 3, state: 'inProgress' },
        { id: 'g4', number: 4, state: 'unstarted' },
        { id: 'g5', number: 5, state: 'unstarted' }
      ]
    }
  }, 'g3');

  assert.deepEqual(Array.from(games, game => game.id), ['g1', 'g2', 'g3']);
});

test('active series navigation excludes unplayed games after a sweep', async () => {
  const controller = await loadController();
  const games = controller.playedSeriesGames({
    match: {
      teams: [
        { result: { gameWins: 2 } },
        { result: { gameWins: 0 } }
      ],
      games: [
        { id: 'g1', number: 1, state: 'completed' },
        { id: 'g2', number: 2, state: 'completed' },
        { id: 'g3', number: 3, state: 'unstarted' }
      ]
    }
  }, 'g2');

  assert.deepEqual(Array.from(games, game => game.id), ['g1', 'g2']);
});
