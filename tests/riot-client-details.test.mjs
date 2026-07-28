import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiotClient, detailProbeTimes } from '../lib/riot-client.js';

test('detail probes include exact and rounded Riot timestamps without duplicates', () => {
  assert.deepEqual(detailProbeTimes('2026-07-28T12:47:49.909Z'), [
    '2026-07-28T12:47:49.909Z',
    '2026-07-28T12:47:40.000Z',
    '2026-07-28T12:47:30.000Z'
  ]);
});

test('details lookup retries a rounded timestamp when the exact frame is absent', async () => {
  const originalFetch = globalThis.fetch;
  const requestedTimes = [];

  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.match(url.pathname, /\/details\/game-3$/);
    requestedTimes.push(url.searchParams.get('startingTime'));

    if (requestedTimes.length === 1) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({
      frames: [{
        rfc460Timestamp: '2026-07-28T12:47:40.000Z',
        participants: [{ participantId: 1, level: 3, items: [] }]
      }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const client = createRiotClient({ LOL_ESPORTS_API_KEY: 'unused-for-details' });
    const payload = await client.fetchBestDetails('game-3', '2026-07-28T12:47:49.909Z');

    assert.ok(payload?.frames?.length);
    assert.deepEqual(requestedTimes, [
      '2026-07-28T12:47:49.909Z',
      '2026-07-28T12:47:40.000Z'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
