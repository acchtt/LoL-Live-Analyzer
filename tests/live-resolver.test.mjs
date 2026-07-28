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

test('resolver checks the expected next game before stale earlier in-progress flags', async () => {
  const attempted = [];
  const event = {
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

  const riot = {
    getEvent: async () => event,
    getGames: async () => ({ data: { games: event.match.games } }),
    getLive: async () => ({ data: { schedule: { events: [event] } } }),
    fetchWindow: async gameId => {
      attempted.push(gameId);
      return gameId === 'g3' ? gameplayPayload() : null;
    }
  };

  const result = await resolveActiveGame('match-1', riot);

  assert.equal(attempted[0], 'g3');
  assert.equal(result.selectedGame?.id, 'g3');
  assert.equal(result.selectedPhase, 'gameplay');
  assert.equal(result.telemetryAvailable, true);
});
