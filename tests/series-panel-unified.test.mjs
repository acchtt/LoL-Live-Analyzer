import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-panel-clean.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-panel-clean.js', import.meta.url), 'utf8');

test('clean series panel is the only runtime series UI', () => {
  assert.match(html, /series-panel-clean\.css\?v=20260730-1/);
  assert.match(html, /series-panel-clean\.js\?v=20260730-1/);
  assert.doesNotMatch(html, /series-panel-unified|history-shell-state|series-scoreboard-v3|series-game-history|live-series-nav/);
});

test('one controller covers live, archive, history, and result-only states', () => {
  assert.match(script, /function liveModel\(\)/);
  assert.match(script, /function historyModel\(\)/);
  assert.match(script, /variant: archiveMode \? 'archive' : 'live'/);
  assert.match(script, /variant: available \? 'history' : 'result-only'/);
  assert.match(script, /const model = liveModel\(\) \|\| historyModel\(\)/);
});

test('clean controller owns navigation and return-to-live behavior', () => {
  assert.match(script, /dataset\.seriesCleanLiveGameId/);
  assert.match(script, /dataset\.seriesCleanHistoryGameId/);
  assert.match(script, /dataset\.seriesCleanReturnLive/);
  assert.match(script, /function removeLegacyPanels\(\)/);
  assert.match(script, /host\.classList\.add\('panel', 'app-panel'\)/);
});

test('reset layout has no outer frame or rounded corner dependency', () => {
  assert.match(css, /\.series-clean-panel[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /\.series-clean-panel[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(css, /\.series-clean-panel::before,[\s\S]*display:\s*none\s*!important/);
  assert.doesNotMatch(css, /:has\(|contain:\s*paint|box-shadow:\s*inset 0 0 0 1px/);
});

test('matchup remains symmetrical without a boxed outer shell', () => {
  assert.match(css, /series-clean-matchup[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 176px minmax\(0, 1fr\)/);
  assert.match(css, /series-clean-team\.is-left[\s\S]*grid-template-columns:\s*58px minmax\(0, 1fr\)/);
  assert.match(css, /series-clean-team\.is-right[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 58px/);
  assert.match(css, /series-clean-score-value[\s\S]*column-gap:\s*20px/);
});
