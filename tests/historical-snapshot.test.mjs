import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { historicalCursorTimes } from '../lib/historical-snapshot.js';

const anchor = Date.parse('2026-07-27T12:00:00.000Z');

test('historical recovery probes both Riot VOD anchor interpretations', () => {
  const cursors = historicalCursorTimes({
    vods: [{
      firstFrameTime: new Date(anchor).toISOString(),
      startMillis: 120_000,
      endMillis: 2_400_000
    }]
  });

  assert.ok(cursors.includes(new Date(anchor).toISOString()));
  assert.ok(cursors.includes(new Date(anchor + 120_000).toISOString()));
  assert.ok(cursors.includes(new Date(anchor + 2_400_000).toISOString()));
  assert.ok(cursors.includes(new Date(anchor + 120_000 + 2_400_000).toISOString()));
  assert.ok(cursors.length <= 40);
});

test('historical pregame frames are never rendered as a live game', async () => {
  const source = await readFile(new URL('../assets/authoritative-ui.js', import.meta.url), 'utf8');
  assert.match(source, /PREGAME FRAME REJECTED/);
  assert.match(source, /showPregame\(snapshot, historical\)/);
  assert.match(source, /restoreHistoryNavigation\(\)/);
});

test('per-game navigation remains available when an archive is missing', async () => {
  const source = await readFile(new URL('../assets/series-game-history.js', import.meta.url), 'utf8');
  assert.match(source, /globalThis\.renderHistorySeriesSummary = renderSeriesNavigation/);
  assert.match(source, /data-history-game-id/);
  assert.match(source, /Open archive/);
});
