import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTimestamp,
  finiteOrNull,
  normalizeDragonData,
  FRESH_FRAME_SECONDS,
  DEGRADED_FRAME_SECONDS,
  FUTURE_TOLERANCE_SECONDS
} from '../lib/reliability-policy.js';

const NOW = Date.parse('2026-07-27T12:00:00.000Z');

test('classifies strict freshness boundaries', () => {
  assert.equal(classifyTimestamp(NOW - FRESH_FRAME_SECONDS * 1000, NOW).freshness, 'fresh');
  assert.equal(classifyTimestamp(NOW - (FRESH_FRAME_SECONDS + 1) * 1000, NOW).freshness, 'degraded');
  assert.equal(classifyTimestamp(NOW - DEGRADED_FRAME_SECONDS * 1000, NOW).freshness, 'degraded');
  assert.equal(classifyTimestamp(NOW - (DEGRADED_FRAME_SECONDS + 1) * 1000, NOW).freshness, 'stale');
});

test('rejects excessive future timestamp skew', () => {
  assert.equal(classifyTimestamp(NOW + FUTURE_TOLERANCE_SECONDS * 1000, NOW).timestampValid, true);
  assert.equal(classifyTimestamp(NOW + (FUTURE_TOLERANCE_SECONDS + 1) * 1000, NOW).timestampValid, false);
});

test('preserves missing numbers as null', () => {
  assert.equal(finiteOrNull(undefined), null);
  assert.equal(finiteOrNull(''), null);
  assert.equal(finiteOrNull('bad'), null);
  assert.equal(finiteOrNull('0'), 0);
});

test('preserves numeric dragon counts without inventing missing zero', () => {
  assert.equal(normalizeDragonData(3).dragonCount, 3);
  assert.equal(normalizeDragonData(3).dragons.length, 3);
  assert.deepEqual(normalizeDragonData(undefined), { dragons: null, dragonCount: null, missing: true });
});
