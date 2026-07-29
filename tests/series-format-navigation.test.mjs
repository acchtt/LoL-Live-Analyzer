import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const historySource = await readFile(new URL('../assets/series-game-history.js', import.meta.url), 'utf8');
const liveSource = await readFile(new URL('../assets/live-series-nav.js', import.meta.url), 'utf8');
const historyCss = await readFile(new URL('../assets/match-history.css', import.meta.url), 'utf8');
const liveCss = await readFile(new URL('../assets/live-series-nav.css', import.meta.url), 'utf8');
const heroCss = await readFile(new URL('../assets/series-hero.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

for (const format of [1, 2, 3, 5]) {
  test(`history navigation supports BO${format}`, () => {
    assert.match(historySource, /\[1, 2, 3, 5\]\.includes\(configured\)/);
    assert.match(historySource, /Array\.from\(\{ length: format \}/);
    assert.match(historyCss, new RegExp(`data-series-length=\\"${format}\\"`));
    assert.match(heroCss, new RegExp(`data-series-length=\\"${format}\\"`));
  });

  test(`live navigation supports BO${format}`, () => {
    assert.match(liveSource, /\[1, 2, 3, 5\]\.includes\(configured\)/);
    assert.match(liveSource, /nav\.dataset\.seriesLength = String\(format\)/);
    assert.match(liveCss, new RegExp(`data-series-length=\\"${format}\\"`));
    assert.match(heroCss, new RegExp(`data-series-length=\\"${format}\\"`));
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

test('completed history renders the full matchup hero, score, rail, badge, and context strip', () => {
  for (const className of [
    'series-hero-matchup',
    'series-hero-team-logo',
    'series-hero-score is-final',
    'series-hero-rail',
    'series-hero-badge is-archive',
    'series-hero-context'
  ]) {
    assert.match(historySource, new RegExp(className));
  }
  assert.match(historySource, /teamLogo\(a\)/);
  assert.match(historySource, /teamLogo\(b\)/);
});

test('active series renders the same hero language with live, pending, and archive modes', () => {
  for (const className of [
    'series-hero--live',
    'series-hero-matchup',
    'series-hero-score',
    'series-hero-rail',
    'series-hero-actions',
    'series-hero-context'
  ]) {
    assert.match(liveSource, new RegExp(className));
  }
  for (const label of ['Live telemetry', 'Result pending', 'Archive view']) {
    assert.match(liveSource, new RegExp(label));
  }
  assert.match(liveSource, /insertAdjacentElement\('beforebegin', nav\)/);
});

test('shared cinematic series hero stylesheet loads after other layout overrides', () => {
  assert.match(heroCss, /\.series-hero-top/);
  assert.match(heroCss, /\.series-hero-matchup/);
  assert.match(heroCss, /\.series-hero-game\.is-selected/);
  const priorityIndex = html.indexOf('analysis-priority.css');
  const heroIndex = html.indexOf('series-hero.css');
  assert.ok(priorityIndex >= 0 && heroIndex > priorityIndex);
});
