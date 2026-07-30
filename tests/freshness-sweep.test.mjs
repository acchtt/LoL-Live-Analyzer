import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRiotClient,
  freshnessSweepTimes
} from '../lib/fresh-riot-client.js';

const NOW = Date.parse('2026-07-31T00:00:00.000Z');

function gameplayPayload(timestampMs) {
  return {
    frames: [{
      rfc460Timestamp: new Date(timestampMs).toISOString(),
      blueTeam: {
        totalGold: 6000,
        totalKills: 1,
        participants: [{ creepScore: 10, level: 2 }]
      },
      redTeam: {
        totalGold: 5000,
        totalKills: 0,
        participants: [{ creepScore: 8, level: 2 }]
      }
    }]
  };
}

test('freshness sweep probes ahead of a delayed candidate and near wall-clock anchors', () => {
  const candidate = NOW - 402_000;
  const times = freshnessSweepTimes(candidate, NOW);

  assert.deepEqual(times, [
    candidate + 10_000,
    candidate + 30_000,
    candidate + 60_000,
    candidate + 120_000,
    NOW - 120_000,
    NOW - 240_000
  ].map(value => new Date(Math.floor(value / 10_000) * 10_000).toISOString()));
});

test('a fast but delayed primary frame is replaced by the freshest sweep result', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const primaryTimestamp = NOW - 240_000;
  const freshTimestamp = NOW - 20_000;
  const calls = [];

  Date.now = () => NOW;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    const startingTime = url.searchParams.get('startingTime');
    calls.push(startingTime);

    if (!startingTime) {
      return new Response(JSON.stringify(gameplayPayload(primaryTimestamp)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const requestedMs = Date.parse(startingTime);
    if (requestedMs <= freshTimestamp) {
      return new Response(JSON.stringify(gameplayPayload(freshTimestamp)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(null, { status: 204 });
  };

  try {
    const riot = createRiotClient({ LOL_ESPORTS_API_KEY: 'unused-for-window-feed' });
    const candidate = await riot.fetchBestLiveWindow('freshness-sweep-game', null);

    assert.equal(candidate.timestampMs, freshTimestamp);
    assert.equal(candidate.timestampQuality.freshness, 'fresh');
    assert.equal(candidate.retrieval.freshnessSweep, true);
    assert.equal(candidate.retrieval.freshnessSweepImprovedBySeconds, 220);
    assert.ok(candidate.retrieval.requestCount > 1);
    assert.ok(calls.some(value => value !== null));
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test('a fresh primary frame does not trigger extra sweep requests', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const freshTimestamp = NOW - 10_000;
  let requestCount = 0;

  Date.now = () => NOW;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify(gameplayPayload(freshTimestamp)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const riot = createRiotClient({ LOL_ESPORTS_API_KEY: 'unused-for-window-feed' });
    const candidate = await riot.fetchBestLiveWindow('fresh-primary-game', null);

    assert.equal(candidate.timestampMs, freshTimestamp);
    assert.equal(candidate.timestampQuality.freshness, 'fresh');
    assert.equal(candidate.retrieval.freshnessSweep, undefined);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});
