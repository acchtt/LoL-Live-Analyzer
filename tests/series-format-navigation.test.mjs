import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const historySource = await readFile(new URL('../assets/series-game-history.js', import.meta.url), 'utf8');
const liveSource = await readFile(new URL('../assets/live-series-nav.js', import.meta.url), 'utf8');
const historyCss = await readFile(new URL('../assets/match-history.css', import.meta.url), 'utf8');
const liveCss = await readFile(new URL('../assets/live-series-nav.css', import.meta.url), 'utf8');

for (const format of [1, 2, 3, 5]) {
  test(`history navigation supports BO${format}`, () => {
    assert.match(historySource, /\[1, 2, 3, 5\]\.includes\(configured\)/);
    assert.match(historySource, /Array\.from\(\{ length: format \}/);
    assert.match(historyCss, new RegExp(`data-series-length=\\"${format}\\"`));
  });

  test(`live navigation supports BO${format}`, () => {
    assert.match(liveSource, /\[1, 2, 3, 5\]\.includes\(configured\)/);
    assert.match(liveSource, /nav\.dataset\.seriesLength = String\(format\)/);
    assert.match(liveCss, new RegExp(`data-series-length=\\"${format}\\"`));
  });
}

test('unplayed history slots are visible but disabled', () => {
  assert.match(historySource, /Not played/);
  assert.match(historySource, /disabled aria-disabled=\"true\"/);
});

test('live navigation distinguishes final, waiting, live, and locked slots', () => {
  for (const label of ['Final', 'Waiting', 'Live', 'Locked']) {
    assert.match(liveSource, new RegExp(`['\"]${label}['\"]`));
  }
});
