import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGameplay } from '../lib/live-normalizer.js';

function player(participantId) {
  return {
    participantId,
    level: 11,
    kills: 1,
    deaths: 1,
    assists: 3,
    creepScore: 180,
    totalGold: 9_000,
    currentGold: 500,
    items: [1001, 3006]
  };
}

function fixture() {
  const candidate = {
    payload: {
      gameMetadata: {
        patchVersion: '16.14',
        blueTeamMetadata: {
          esportsTeamId: 'blue-id',
          participantMetadata: Array.from({ length: 5 }, (_, index) => ({ participantId: index + 1 }))
        },
        redTeamMetadata: {
          esportsTeamId: 'red-id',
          participantMetadata: Array.from({ length: 5 }, (_, index) => ({ participantId: index + 6 }))
        }
      }
    },
    frame: {
      blueTeam: {
        totalGold: 45_000,
        totalKills: 8,
        towers: 4,
        barons: 0,
        dragons: 2,
        participants: Array.from({ length: 5 }, (_, index) => player(index + 1))
      },
      redTeam: {
        totalGold: 43_500,
        totalKills: 6,
        towers: 3,
        barons: 0,
        dragons: 1,
        participants: Array.from({ length: 5 }, (_, index) => player(index + 6))
      }
    },
    timestampMs: Date.parse('2026-07-27T12:00:00.000Z'),
    timestampQuality: {
      freshness: 'fresh',
      dataAgeSeconds: 10,
      futureSkewSeconds: 0
    }
  };
  const event = {
    match: {
      teams: [
        { id: 'blue-id', name: 'Blue Team' },
        { id: 'red-id', name: 'Red Team' }
      ],
      games: [{
        id: 'game-id',
        teams: [
          { id: 'blue-id', side: 'blue' },
          { id: 'red-id', side: 'red' }
        ]
      }]
    }
  };
  return { candidate, event };
}

test('marks a complete fresh frame safe for live analysis', () => {
  const { candidate, event } = fixture();
  const snapshot = normalizeGameplay({ candidate, event, gameId: 'game-id', detailedPayload: null, afterMs: null });
  assert.equal(snapshot.quality.safeForLiveAnalysis, true);
  assert.deepEqual(snapshot.quality.criticalMissingFields, []);
  assert.equal(snapshot.blue.dragonCount, 2);
});

test('fails closed when a player item state is missing', () => {
  const { candidate, event } = fixture();
  delete candidate.frame.blueTeam.participants[0].items;
  const snapshot = normalizeGameplay({ candidate, event, gameId: 'game-id', detailedPayload: null, afterMs: null });
  assert.equal(snapshot.quality.safeForLiveAnalysis, false);
  assert.ok(snapshot.quality.criticalMissingFields.includes('blue.players.0.items'));
  assert.equal(snapshot.blue.players[0].items, null);
});
