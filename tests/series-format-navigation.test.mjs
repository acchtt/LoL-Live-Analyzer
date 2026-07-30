import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const historySource = await readFile(new URL('../assets/series-game-history.js', import.meta.url), 'utf8');
const liveSource = await readFile(new URL('../assets/live-series-nav.js', import.meta.url), 'utf8');
const historyCss = await readFile(new URL('../assets/match-history.css', import.meta.url), 'utf8');
const liveCss = await readFile(new URL('../assets/live-series-nav.css', import.meta.url), 'utf8');
const heroCss = await readFile(new URL('../assets/series-hero.css', import.meta.url), 'utf8');
const refinementCss = await readFile(new URL('../assets/series-hero-refinement.css', import.meta.url), 'utf8');
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

test('unplayed history slots are visible but disabled when game ids exist', () => {
  assert.match(historySource, /Not played/);
  assert.match(historySource, /disabled aria-disabled=\"true\"/);
});

test('history without game ids renders a result-only record instead of a fake game tab', () => {
  assert.match(historySource, /if \(!games\.length\)/);
  assert.match(historySource, /series-hero-games is-unavailable/);
  assert.match(historySource, /Game archive unavailable/);
  assert.match(historySource, /Archive unavailable/);
  assert.match(historySource, /summary\.dataset\.historyArchive = archiveAvailable \? 'available' : 'missing'/);
});

test('live navigation distinguishes final, waiting, live, locked, and stale slots', () => {
  for (const label of ['Final', 'Waiting', 'Live', 'Locked', 'Stale']) {
    assert.match(liveSource, new RegExp(`['\"]${label}['\"]`));
  }
  assert.match(liveSource, /snapshotState\.status === 'telemetry_stale'/);
  assert.match(liveSource, /'Stale frame'/);
});

test('completed history renders the full matchup hero, adaptive score, rail, badge, and context strip', () => {
  for (const className of [
    'series-hero-matchup',
    'series-hero-team-logo',
    'series-hero-rail',
    'series-hero-badge',
    'series-hero-context'
  ]) {
    assert.match(historySource, new RegExp(className));
  }
  assert.match(historySource, /archiveAvailable \? 'is-final' : 'is-unresolved'/);
  assert.match(historySource, /archiveAvailable \? 'Verified archive' : 'Archive unavailable'/);
  assert.match(historySource, /teamLogo\(a\)/);
  assert.match(historySource, /teamLogo\(b\)/);
});

test('active series renders the same hero language with live, pending, stale, and archive modes', () => {
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
  for (const label of ['Live telemetry', 'Result pending', 'Stale frame', 'Archive view']) {
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
  const refinementIndex = html.indexOf('series-hero-refinement.css');
  assert.ok(priorityIndex >= 0 && heroIndex > priorityIndex);
  assert.ok(refinementIndex > heroIndex);
});

test('live series hero is compact and suppresses the duplicate analysis heading', () => {
  assert.match(refinementCss, /\.series-hero--live \.series-hero-top[\s\S]*min-height:\s*76px/);
  assert.match(refinementCss, /\.series-hero--live \+ \.analysis-v2-header/);
  assert.match(refinementCss, /\.series-hero-score\.is-stale/);
  assert.match(html, /assets\/series-hero-refinement\.css\?v=20260729-2/);
});

test('history hero uses a balanced compact matchup and full-width adaptive rail', () => {
  assert.match(refinementCss, /\.series-hero--history \.series-hero-top[\s\S]*min-height:\s*88px/);
  assert.match(refinementCss, /\.series-hero--history \.series-hero-main[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\)/);
  assert.match(refinementCss, /\.series-hero--history\[data-series-length=\"3\"\] \.series-hero-games[\s\S]*repeat\(3, minmax\(104px, 1fr\)\)/);
  assert.match(refinementCss, /\.series-hero--history::after[\s\S]*display:\s*none/);
});