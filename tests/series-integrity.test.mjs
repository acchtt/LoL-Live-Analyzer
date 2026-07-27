import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  authoritativeSeriesComplete,
  normalizeAuthoritativeCompletion,
  unresolvedPlaceholderEvent
} from '../lib/series-integrity.js';

function event({ bestOf = 3, leftWins = 0, rightWins = 0, state = 'inProgress', teams } = {}) {
  return {
    state,
    match: {
      strategy: { type: 'bestOf', count: bestOf },
      teams: teams || [
        { id: 'left', name: 'Left', result: { gameWins: leftWins } },
        { id: 'right', name: 'Right', result: { gameWins: rightWins } }
      ]
    }
  };
}

test('a 2-0 best-of-three is authoritatively complete even when Riot still reports live', () => {
  const value = event({ bestOf: 3, leftWins: 2, rightWins: 0 });
  assert.equal(authoritativeSeriesComplete(value), true);
  assert.equal(normalizeAuthoritativeCompletion(value), true);
  assert.equal(value.state, 'completed');
  assert.equal(value.match.state, 'completed');
  assert.equal(value.completionSource, 'riot_series_score');
});

test('a 2-0 best-of-five is not complete', () => {
  assert.equal(authoritativeSeriesComplete(event({ bestOf: 5, leftWins: 2, rightWins: 0 })), false);
});

test('an all-TBD event is hidden but a partially resolved matchup remains visible', () => {
  const placeholder = event({
    teams: [
      { name: 'TBD', result: { gameWins: 0 } },
      { name: 'TBD', result: { gameWins: 0 } }
    ]
  });
  const partial = event({
    teams: [
      { id: 'known', name: 'Known Team', result: { gameWins: 0 } },
      { name: 'TBD', result: { gameWins: 0 } }
    ]
  });
  assert.equal(unresolvedPlaceholderEvent(placeholder), true);
  assert.equal(unresolvedPlaceholderEvent(partial), false);
});

test('frontend integrity layer retires selected clinched series and filters placeholders', async () => {
  const source = await readFile(new URL('../assets/schedule-integrity.js', import.meta.url), 'utf8');
  assert.match(source, /state\.scheduleTab = 'finished'/);
  assert.match(source, /placeholderEvent\(event\)/);
  assert.match(source, /resolution\?\.seriesComplete/);
  assert.match(source, /loadSchedule\(true\)/);
});
