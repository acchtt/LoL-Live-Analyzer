import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/history-shell-edge-final.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/history-shell-state.js', import.meta.url), 'utf8');
const history = await readFile(new URL('../assets/series-game-history.js', import.meta.url), 'utf8');

test('result-only history removes the structural panel classes directly', () => {
  assert.match(history, /panel\.classList\.toggle\('panel', !active\)/);
  assert.match(history, /panel\.classList\.toggle\('app-panel', !active\)/);
  assert.match(history, /panel\.dataset\.historyShell = 'result-only'/);
  assert.match(history, /setResultOnlyHistoryShell\(!archiveAvailable\)/);
});

test('observer keeps the shell state correct after later DOM replacements', () => {
  assert.match(script, /className = 'is-result-only-history'/);
  assert.match(script, /panel\.classList\.toggle\(className, resultOnly\)/);
  assert.match(script, /content\.classList\.toggle\(className, resultOnly\)/);
  assert.match(script, /panel\.classList\.toggle\('panel', !resultOnly\)/);
  assert.match(script, /panel\.classList\.toggle\('app-panel', !resultOnly\)/);
  assert.match(script, /MutationObserver\(syncHistoryShell\)/);
});

test('explicit history shell removes the duplicate outer frame', () => {
  assert.match(css, /game-panel\.is-result-only-history[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /game-panel\.is-result-only-history[\s\S]*background:\s*transparent\s*!important/);
  assert.match(css, /game-content\.is-result-only-history[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /series-hero\[data-history-archive="missing"\][\s\S]*border:\s*0\s*!important/);
});

test('history card uses one joined inset frame at rounded corners', () => {
  assert.match(css, /series-hero\[data-history-archive="missing"\][\s\S]*border-radius:\s*8px\s*!important/);
  assert.match(css, /series-hero\[data-history-archive="missing"\]::after/);
  assert.match(css, /box-shadow:\s*inset 0 0 0 1px var\(--rp-border\)\s*!important/);
  assert.match(css, /contain:\s*paint\s*!important/);
});

test('explicit shell assets load after the previous result-only repair', () => {
  const oldRepair = html.indexOf('history-result-only-repair.css');
  const finalRepair = html.indexOf('history-shell-edge-final.css');
  const stateScript = html.indexOf('history-shell-state.js');
  assert.ok(oldRepair >= 0 && finalRepair > oldRepair && stateScript > 0);
  assert.match(html, /history-shell-edge-final\.css\?v=20260730-3/);
  assert.match(html, /history-shell-state\.js\?v=20260730-2/);
  assert.match(html, /series-game-history\.js\?v=20260730-6/);
  assert.match(html, /data-ui-build="history-corner-frame-1"/);
});
