import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveGame } from '../lib/live-resolver.js';

function gameplayPayload() {
  return {
    frames: [{
      rfc460Timestamp: new Date().toISOString(),
      blueTeam: {
        totalGold: 6100,
        participants: [{ participantId: 1, level: 2, creepScore: 4 }]
      },
      redTeam: {
        totalGold: 6000,
        participants: [{ participantId: 6, level: 2, creepScore: 3 }]
      }
    }]
  };
}

function pregamePayload() {
  const participants = Array.from({ length: 5 }, (_, index) => ({
    participantId: index + 1,
    level: 1,
    creepScore: 0
  }));
  return {
    frames: [{
      rfc460Timestamp: new Date().toISOString(),
      blueTeam: { totalGold: 2500, participants },
      redTeam: {
        totalGold: 2500,
        participants: participants.map(player => ({ ...player, participantId: player.participantId + 5 }))
      }
    }]
  };
}

function activeSeriesEvent() {
  return {
    id: 'match-1',
    match: {
      id: 'match-1',
      strategy: { type: 'bestOf', count: 3 },
      teams: [
        { name: 'DK Challengers', result: { gameWins: 1 } },
        { name: 'KT Challengers', result: { gameWins: 1 } }
      ],
      games: [
        { id: 'g1', number: 1, state: 'inProgress' },
        { id: 'g2', number: 2, state: 'inProgress' },
        { id: 'g3', number: 3, state: 'unstarted' }
      ]
    }
  };
}

function riotFor(event, overrides = {}) {
  return {
    getEvent: async () => event,
    getGames: async () => ({ data: { games: event.match.games } }),
    getLive: async () => ({ data: { schedule: { events: [event] } } }),
    fetchWindow: async () => null,
    fetchBestLiveWindow: async () => null,
    ...overrides
  };
}

test('resolver checks the expected next game before stale earlier in-progress flags', async () => {
  const attempted = [];
  const event = activeSeriesEvent();
  const riot = riotFor(event, {
    fetchBestLiveWindow: async gameId => {
      attempted.push(gameId);
      return gameId === 'g3' ? gameplayPayload() : null;
    },
    fetchWindow: async gameId => {
      attempted.push(`latest:${gameId}`);
      return null;
    }
  });

  const result = await resolveActiveGame('match-1', riot);

  assert.equal(attempted[0], 'g3');
  assert.equal(result.selectedGame?.id, 'g3');
  assert.equal(result.selectedPhase, 'gameplay');
  assert.equal(result.telemetryAvailable, true);
  assert.equal(result.diagnostics.g3.lookup, 'best-live-window');
});

test('resolver uses resilient recent-window probes when the latest endpoint is empty', async () => {
  const event = activeSeriesEvent();
  let directLatestCalls = 0;
  const riot = riotFor(event, {
    fetchBestLiveWindow: async gameId => gameId === 'g3' ? gameplayPayload() : null,
    fetchWindow: async () => {
      directLatestCalls += 1;
      return null;
    }
  });

  const result = await resolveActiveGame('match-1', riot);

  assert.equal(result.selectedGame?.id, 'g3');
  assert.equal(result.selectedPhase, 'gameplay');
  assert.equal(directLatestCalls, 0);
});

test('resolver keeps champion select as waiting state instead of exposing pregame stats', async () => {
  const event = activeSeriesEvent();
  const riot = riotFor(event, {
    fetchBestLiveWindow: async gameId => gameId === 'g3' ? pregamePayload() : null
  });

  const result = await resolveActiveGame('match-1', riot);

  assert.equal(result.selectedGame, null);
  assert.equal(result.pregameGame?.id, 'g3');
  assert.equal(result.selectedPhase, 'pregame');
  assert.equal(result.telemetryAvailable, false);
  assert.equal(result.quality.safeForLiveAnalysis, false);
});
