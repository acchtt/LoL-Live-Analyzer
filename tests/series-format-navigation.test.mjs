import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/series-panel-clean.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-panel-clean.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

for (const format of [1, 2, 3, 5]) {
  test(`clean series navigation supports BO${format}`, () => {
    assert.match(source, /\[1, 2, 3, 5\]\.includes\(configured\)/);
    assert.match(source, /Array\.from\(\{ length: format \}/);
    assert.match(source, /games\.style\.setProperty\('--series-clean-count'/);
    assert.match(css, /repeat\(var\(--series-clean-count\), minmax\(120px, 1fr\)\)/);
  });
}

test('unplayed history slots stay visible but disabled', () => {
  assert.match(source, /label: selected \? 'Selected' : id \? 'Final' : 'Not played'/);
  assert.match(source, /disabled: !id/);
  assert.match(source, /button\.disabled = Boolean\(game\.disabled\)/);
});

test('history without game ids renders result-only content instead of a fake tab', () => {
  assert.match(source, /variant: available \? 'history' : 'result-only'/);
  assert.match(source, /games: available[\s\S]*: \[\]/);
  assert.match(source, /title: 'Game archive unavailable'/);
  assert.match(source, /label: available \? 'Verified archive' : 'Archive unavailable'/);
});

test('live navigation distinguishes final, waiting, live, locked, and stale slots', () => {
  for (const label of ['Final', 'Waiting', 'Live', 'Locked', 'Stale']) {
    assert.match(source, new RegExp(`['"]${label}['"]`));
  }
  assert.match(source, /telemetry\.status === 'telemetry_stale'/);
  assert.match(source, /'Stale frame'/);
});

test('one clean renderer covers completed history and active series modes', () => {
  assert.match(source, /function historyModel\(\)/);
  assert.match(source, /function liveModel\(\)/);
  for (const label of ['Live telemetry', 'Result pending', 'Stale frame', 'Archive view']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /insertPanel\(createPanel\(model\)\)/);
});

test('clean stylesheet loads last and old cinematic hero layers are absent', () => {
  const priorityIndex = html.indexOf('analysis-priority.css');
  const cleanIndex = html.indexOf('series-panel-clean.css');
  assert.ok(priorityIndex >= 0 && cleanIndex > priorityIndex);
  assert.match(html, /assets\/series-panel-clean\.css\?v=20260730-2/);
  assert.doesNotMatch(html, /series-hero\.css|series-hero-refinement\.css|live-series-nav\.css/);
});

test('series panel is readable and does not depend on rounded outer corners', () => {
  assert.match(css, /series-clean-matchup[\s\S]*min-height:\s*132px/);
  assert.match(css, /series-clean-team-copy strong[\s\S]*font-size:\s*clamp\(20px, 1\.55vw, 28px\)/);
  assert.match(css, /series-clean-panel[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /series-clean-panel[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(css, /series-clean-panel::before,[\s\S]*display:\s*none\s*!important/);
});
