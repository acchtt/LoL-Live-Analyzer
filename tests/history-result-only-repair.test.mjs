import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-panel-clean.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-panel-clean.css', import.meta.url), 'utf8');

test('history records without game ids use the clean result-only model', () => {
  assert.match(script, /variant: available \? 'history' : 'result-only'/);
  assert.match(script, /label: available \? 'Final' : 'No result'/);
  assert.match(script, /detail: available \? `[\s\S]*` : 'No completed games'/);
  assert.match(script, /title: 'Game archive unavailable'/);
  assert.match(script, /Riot returned the match result without archived game IDs/);
});

test('missing archives do not create fake game buttons', () => {
  assert.match(script, /games: available[\s\S]*: \[\]/);
  assert.match(script, /if \(model\.empty\)/);
  assert.match(script, /bottom\.append\(empty\)/);
  assert.doesNotMatch(script, /Series result available<\/strong>/);
});

test('result-only loading clears telemetry and renders one panel', () => {
  assert.match(script, /if \(!finalGame\?\.id\)/);
  assert.match(script, /state\.selectedGameId = null/);
  assert.match(script, /gameContent\.innerHTML = ''/);
  assert.match(script, /scheduleRender\(\)/);
  assert.match(script, /History · result only · archive unavailable/);
});

test('clean rebuild removes the old result-only repair stack', () => {
  assert.match(html, /series-panel-clean\.css\?v=20260730-2/);
  assert.match(html, /series-panel-clean\.js\?v=20260730-1/);
  assert.doesNotMatch(html, /history-result-only-repair|history-shell-edge-final|history-shell-state|series-game-history/);
});

test('result-only state uses one cohesive panel and an integrated notice', () => {
  assert.match(css, /series-clean-panel[\s\S]*border:\s*1px solid var\(--series-line-strong\)\s*!important/);
  assert.match(css, /series-clean-panel[\s\S]*border-radius:\s*10px\s*!important/);
  assert.match(css, /series-clean-empty[\s\S]*min-height:\s*62px\s*!important/);
  assert.match(css, /series-clean-panel::before,[\s\S]*display:\s*none\s*!important/);
});