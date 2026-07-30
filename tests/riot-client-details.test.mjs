import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiotClient, detailProbeTimes } from '../lib/riot-client.js';

test('detail probes cover exact, rounded and adjacent Riot timestamps without duplicates', () => {
  assert.deepEqual(detailProbeTimes('2026-07-28T12:47:49.909Z'), [
    '2026-07-28T12:47:49.909Z',
    '2026-07-28T12:47:40.000Z',
    '2026-07-28T12:47:50.000Z',
    '2026-07-28T12:47:30.000Z'
  ]);
});

test('details lookup probes likely timestamp keys together and accepts the rounded frame', async () => {
  const originalFetch = globalThis.fetch;
  const requestedTimes = [];

  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.match(url.pathname, /\/details\/game-3$/);
    const startingTime = url.searchParams.get('startingTime');
    requestedTimes.push(startingTime);

    if (startingTime === '2026-07-28T12:47:49.909Z') return new Response(null, { status: 204 });
    if (startingTime !== '2026-07-28T12:47:40.000Z') return new Response(null, { status: 204 });
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
      '2026-07-28T12:47:40.000Z',
      '2026-07-28T12:47:50.000Z',
      '2026-07-28T12:47:30.000Z'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
