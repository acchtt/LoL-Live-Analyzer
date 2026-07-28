import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const renderer = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');
const cleanup = await readFile(new URL('../assets/analysis-cleanup.js', import.meta.url), 'utf8');

test('scoreboard renders blue team, centered game clock, then red team', () => {
  const scoreboard = renderer.match(/<section class="analysis-v2-scoreboard"[\s\S]*?<\/section>/)?.[0] || '';

  assert.match(scoreboard, /teamCard\(blue, 'Blue side'\)/);
  assert.match(scoreboard, /analysis-v2-score-center/);
  assert.match(scoreboard, /analysis-v2-clock/);
  assert.match(scoreboard, /teamCard\(red, 'Red side', true\)/);

  const blueIndex = scoreboard.indexOf("teamCard(blue, 'Blue side')");
  const clockIndex = scoreboard.indexOf('analysis-v2-score-center');
  const redIndex = scoreboard.indexOf("teamCard(red, 'Red side', true)");
  assert.ok(blueIndex < clockIndex && clockIndex < redIndex);
});

test('red team card uses mirrored class and cleanup preserves center clock', () => {
  assert.match(renderer, /is-red' : 'is-blue'/);
  assert.doesNotMatch(cleanup, /analysis-v2-score-center[^\n]*remove/);
});
