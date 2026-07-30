import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-panel-unified.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-panel-unified.js', import.meta.url), 'utf8');

test('unified series panel loads after all legacy series repair layers', () => {
  const legacyCss = html.indexOf('history-shell-edge-final.css');
  const unifiedCss = html.indexOf('series-panel-unified.css');
  const legacyScript = html.indexOf('history-shell-state.js');
  const unifiedScript = html.indexOf('series-panel-unified.js');
  assert.ok(legacyCss >= 0 && unifiedCss > legacyCss);
  assert.ok(legacyScript >= 0 && unifiedScript > legacyScript);
  assert.match(html, /series-panel-unified\.css\?v=20260730-1/);
  assert.match(html, /series-panel-unified\.js\?v=20260730-1/);
});

test('one visual renderer covers live, archive, history, and result-only states', () => {
  assert.match(script, /function liveModel\(\)/);
  assert.match(script, /function historyModel\(\)/);
  assert.match(script, /variant: archiveMode \? 'archive' : 'live'/);
  assert.match(script, /variant: available \? 'history' : 'result-only'/);
  assert.match(script, /const model = liveModel\(\) \|\| historyModel\(\)/);
});

test('new panel keeps existing navigation contracts while removing legacy panels', () => {
  assert.match(script, /data-live-series-game-id/);
  assert.match(script, /data-history-game-id/);
  assert.match(script, /data-return-live-game/);
  assert.match(script, /removeLegacySeriesPanels/);
  assert.match(script, /host\.classList\.add\('panel', 'app-panel'\)/);
});

test('outer series surface has square continuous edges and no pseudo-border repair', () => {
  assert.match(css, /\.rp-series-panel[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(css, /\.rp-series-panel[\s\S]*border-top:\s*1px solid var\(--rp-divider\)/);
  assert.match(css, /\.rp-series-panel[\s\S]*border-bottom:\s*1px solid var\(--rp-divider\)/);
  assert.match(css, /\.rp-series-panel::before,[\s\S]*display:\s*none\s*!important/);
  assert.doesNotMatch(css, /:has\(/);
});

test('matchup and score remain symmetrical', () => {
  assert.match(css, /rp-series-matchup[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 190px minmax\(0, 1fr\)/);
  assert.match(css, /rp-series-team\.is-left[\s\S]*grid-template-columns:\s*60px minmax\(0, 1fr\)/);
  assert.match(css, /rp-series-team\.is-right[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 60px/);
  assert.match(css, /rp-series-score-value[\s\S]*column-gap:\s*16px/);
});
