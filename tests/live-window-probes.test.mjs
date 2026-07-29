import test from 'node:test';
import assert from 'node:assert/strict';
import { liveWindowProbeTimes } from '../lib/riot-client.js';
import { classifyTimestamp } from '../lib/reliability-policy.js';

const NOW = Date.parse('2026-07-29T00:10:00.000Z');

function rounded(value) {
  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();
}

test('initial live lookup probes regional feeds delayed by up to ten minutes', () => {
  assert.deepEqual(
    liveWindowProbeTimes(NOW),
    [20, 60, 120, 240, 360, 480, 600].map(seconds => rounded(NOW - seconds * 1000))
  );
});

test('advancing lookup probes immediately after the last displayed frame', () => {
  const after = '2026-07-29T00:09:00.000Z';
  const afterMs = Date.parse(after);
  assert.deepEqual(
    liveWindowProbeTimes(NOW, after),
    [10, 20, 30, 60].map(seconds => rounded(afterMs + seconds * 1000))
  );
});

test('older displayed frames also receive wall-clock delay anchors', () => {
  const after = '2026-07-29T00:03:00.000Z';
  const afterMs = Date.parse(after);
  assert.deepEqual(liveWindowProbeTimes(NOW, after), [
    ...[10, 20, 30, 60, 90].map(seconds => rounded(afterMs + seconds * 1000)),
    rounded(NOW - 120_000),
    rounded(NOW - 240_000)
  ]);
});

test('ten-minute delayed frames remain context-only rather than disappearing', () => {
  assert.equal(classifyTimestamp(NOW - 600_000, NOW).freshness, 'degraded');
  assert.equal(classifyTimestamp(NOW - 601_000, NOW).freshness, 'stale');
});
