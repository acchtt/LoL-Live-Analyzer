import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadHistoryController(event) {
  const source = await readFile(new URL('../assets/series-game-history.js', import.meta.url), 'utf8');
  const calls = { endpoint: null, loadGame: 0, connection: null };
  const context = {
    document: {
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} }
    },
    state: {},
    gameContent: { innerHTML: '' },
    jsonUrl: { value: '' },
    copyJsonUrl: { disabled: false },
    jsonPreview: { textContent: '' },
    api: async () => ({ data: { event } }),
    setJsonEndpoint: (gameId, historical) => { calls.endpoint = { gameId, historical }; },
    loadGame: async () => { calls.loadGame += 1; },
    setConnection: message => { calls.connection = message; },
    loadFinishedMatch: async () => {}
  };
  vm.runInNewContext(source, context, { filename: 'series-game-history.js' });
  return { context, calls };
}

test('history includes earlier games when Riot marks only the final game completed', async () => {
  const event = {
    match: {
      teams: [
        { result: { gameWins: 2 } },
        { result: { gameWins: 1 } }
      ],
      games: [
        { id: 'game-1', number: 1, state: 'unstarted' },
        { id: 'game-2', number: 2, state: 'unstarted' },
        { id: 'game-3', number: 3, state: 'completed' }
      ]
    }
  };

  const { context, calls } = await loadHistoryController(event);
  await context.loadFinishedMatch('match-1');

  assert.deepEqual(
    Array.from(context.state.historyMatch.games, game => game.id),
    ['game-1', 'game-2', 'game-3']
  );
  assert.equal(context.state.selectedGameId, 'game-3');
  assert.deepEqual(calls.endpoint, { gameId: 'game-3', historical: true });
  assert.equal(calls.loadGame, 1);
});

test('history does not show unplayed games from a swept best-of series', async () => {
  const event = {
    match: {
      teams: [
        { result: { gameWins: 2 } },
        { result: { gameWins: 0 } }
      ],
      games: [
        { id: 'game-1', number: 1, state: 'completed' },
        { id: 'game-2', number: 2, state: 'completed' },
        { id: 'game-3', number: 3, state: 'unstarted' }
      ]
    }
  };

  const { context } = await loadHistoryController(event);
  await context.loadFinishedMatch('match-2');

  assert.deepEqual(
    Array.from(context.state.historyMatch.games, game => game.id),
    ['game-1', 'game-2']
  );
});
