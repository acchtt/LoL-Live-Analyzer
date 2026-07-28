import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/series-phase.js', import.meta.url), 'utf8');

function completedEvent() {
  return {
    id: 'match-1',
    state: 'inProgress',
    match: {
      id: 'match-1',
      strategy: { type: 'bestOf', count: 3 },
      teams: [
        { name: 'Blue', result: { gameWins: 2 } },
        { name: 'Red', result: { gameWins: 1 } }
      ],
      games: [
        { id: 'g1', number: 1, state: 'completed' },
        { id: 'g2', number: 2, state: 'completed' },
        { id: 'g3', number: 3, state: 'unstarted' }
      ]
    }
  };
}

function tiedFinalGameEvent() {
  return {
    id: 'match-2',
    state: 'inProgress',
    match: {
      id: 'match-2',
      strategy: { type: 'bestOf', count: 3 },
      teams: [
        { name: 'Blue', result: { gameWins: 1 } },
        { name: 'Red', result: { gameWins: 1 } }
      ],
      games: [
        { id: 'g1', number: 1, state: 'completed' },
        { id: 'g2', number: 2, state: 'completed' },
        { id: 'g3', number: 3, state: 'inProgress' }
      ]
    }
  };
}

test('series-complete resolution loads the deciding game as a historical snapshot', async () => {
  const event = completedEvent();
  let baseWaitingCalls = 0;
  let loadCalls = 0;
  let endpoint = null;
  let rendered = 0;
  let connection = '';

  const context = {
    showWaiting: () => { baseWaitingCalls += 1; },
    state: {
      selectedEventId: 'match-1',
      selectedGameId: null,
      selectedMatchState: 'inProgress',
      liveMatchIds: new Set(['match-1']),
      eventRetryTimer: null,
      pollTimer: null
    },
    selectedScheduleEvent: () => event,
    renderSchedule: () => { rendered += 1; },
    setJsonEndpoint: (gameId, historical) => { endpoint = { gameId, historical }; },
    loadGame: async () => { loadCalls += 1; },
    setConnection: label => { connection = label; },
    gameContent: { innerHTML: '' },
    jsonPreview: { textContent: '' },
    jsonUrl: { value: '' },
    copyJsonUrl: { disabled: false },
    eventTeams: value => value.match.teams,
    markMatchLive: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    queueMicrotask: callback => callback(),
    Promise,
    JSON,
    Number,
    Array,
    String,
    Date,
    Set,
    console
  };

  vm.runInNewContext(source, context, { filename: 'series-phase.js' });
  context.showWaiting(event, {
    seriesComplete: true,
    selectedPhase: 'series_complete',
    event,
    games: event.match.games,
    checkedAt: new Date().toISOString()
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(baseWaitingCalls, 0);
  assert.equal(context.state.selectedMatchState, 'completed');
  assert.equal(context.state.selectedGameId, 'g3');
  assert.equal(context.state.liveMatchIds.has('match-1'), false);
  assert.deepEqual(endpoint, { gameId: 'g3', historical: true });
  assert.equal(loadCalls, 1);
  assert.ok(rendered >= 1);
  assert.match(connection, /loading final game/i);
});

test('stopped expected-game telemetry is classified as result pending instead of draft', () => {
  const event = tiedFinalGameEvent();
  let baseWaitingCalls = 0;
  let connection = '';
  let endpoint = null;

  const context = {
    showWaiting: () => { baseWaitingCalls += 1; },
    state: {
      selectedEventId: 'match-2',
      selectedGameId: null,
      selectedMatchState: 'inProgress',
      liveMatchIds: new Set(['match-2']),
      eventRetryTimer: null,
      pollTimer: 123,
      lastSnapshot: null
    },
    selectedScheduleEvent: () => event,
    renderSchedule: () => {},
    renderGame: () => {},
    setJsonEndpoint: (gameId, historical) => { endpoint = { gameId, historical }; },
    loadGame: async () => {},
    setConnection: label => { connection = label; },
    gameContent: { innerHTML: '', prepend: () => {}, querySelector: () => null },
    jsonPreview: { textContent: '' },
    jsonUrl: { value: '' },
    copyJsonUrl: { disabled: false },
    eventTeams: value => value.match.teams,
    markMatchLive: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    queueMicrotask: callback => callback(),
    Promise,
    JSON,
    Number,
    Array,
    String,
    Object,
    Date,
    Set,
    console
  };

  vm.runInNewContext(source, context, { filename: 'series-phase.js' });
  context.showWaiting(event, {
    seriesComplete: false,
    selectedGame: null,
    pregameGame: null,
    games: event.match.games,
    checkedAt: '2026-07-28T20:00:00.000Z',
    diagnostics: {
      expectedGameNumber: 3,
      g3: {
        phase: 'gameplay',
        freshness: 'stale',
        frameAgeSeconds: 330,
        timestamp: '2026-07-28T19:54:30.000Z',
        gameNumber: 3
      }
    }
  });

  assert.equal(baseWaitingCalls, 0);
  assert.equal(context.state.selectedMatchState, 'postGame');
  assert.equal(context.state.selectedGameId, 'g3');
  assert.deepEqual(endpoint, { gameId: 'g3', historical: false });
  assert.match(context.gameContent.innerHTML, /Game 3 feed stopped/i);
  assert.doesNotMatch(context.gameContent.innerHTML, /draft \/ between games/i);
  assert.match(context.jsonPreview.textContent, /post_game_result_pending/);
  assert.match(connection, /result pending/i);
});

test('stale gameplay from an earlier game does not block the real next-game break state', () => {
  const context = { showWaiting: () => {} };
  vm.runInNewContext(source, context, { filename: 'series-phase.js' });

  const evidence = context.RiftPulseSeriesPhase.staleGameplayEvidence({
    diagnostics: {
      g2: {
        phase: 'gameplay',
        freshness: 'stale',
        gameNumber: 2,
        timestamp: '2026-07-28T19:00:00.000Z'
      }
    }
  }, { nextGameNumber: 3 });

  assert.equal(evidence, null);
});
