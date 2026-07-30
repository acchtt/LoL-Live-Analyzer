import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/series-phase.js', import.meta.url), 'utf8');

function createContext() {
  const calls = { baseWaiting: 0, markedLive: 0, connections: [] };
  const context = {
    console,
    Date,
    JSON,
    state: { selectedEventId: 'match-1' },
    gameContent: { innerHTML: '' },
    jsonUrl: { value: '' },
    copyJsonUrl: { disabled: false },
    jsonPreview: { textContent: '' },
    selectedScheduleEvent: () => null,
    eventTeams: event => event?.match?.teams || [{ name: 'Blue' }, { name: 'Red' }],
    markMatchLive: () => { calls.markedLive += 1; },
    setConnection: (...args) => { calls.connections.push(args); },
    showWaiting: () => { calls.baseWaiting += 1; }
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'assets/series-phase.js' });
  return { context, calls };
}

const event = {
  match: {
    strategy: { count: 3 },
    teams: [
      { name: 'Blue', result: { gameWins: 0 } },
      { name: 'Red', result: { gameWins: 1 } }
    ]
  }
};

const games = [
  { id: 'game-1', number: 1, state: 'completed' },
  { id: 'game-2', number: 2, state: 'inProgress' },
  { id: 'game-3', number: 3, state: 'unstarted' }
];

test('live broadcast without explicit pregame evidence does not show draft/break', () => {
  const { context, calls } = createContext();

  context.showWaiting(event, {
    broadcastLive: true,
    selectedGame: null,
    selectedPhase: null,
    pregameGame: null,
    games
  });

  assert.equal(calls.baseWaiting, 1);
  assert.equal(calls.markedLive, 0);
  assert.equal(context.jsonPreview.textContent, '');
});

test('explicit pregame telemetry shows draft/break', () => {
  const { context, calls } = createContext();

  context.showWaiting(event, {
    broadcastLive: true,
    selectedGame: null,
    selectedPhase: 'pregame',
    pregameGame: { id: 'game-2', number: 2 },
    games,
    checkedAt: '2026-07-30T19:00:00.000Z'
  });

  assert.equal(calls.baseWaiting, 0);
  assert.equal(calls.markedLive, 1);
  const payload = JSON.parse(context.jsonPreview.textContent);
  assert.equal(payload.status, 'draft_or_between_games');
  assert.equal(payload.nextGameNumber, 2);
  assert.equal(payload.pregameGameId, 'game-2');
});
