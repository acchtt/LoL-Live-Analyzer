import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/history-shell-edge-final.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/history-shell-state.js', import.meta.url), 'utf8');

test('result-only history uses an explicit shell class instead of relying on :has', () => {
  assert.match(script, /className = 'is-result-only-history'/);
  assert.match(script, /panel\.classList\.toggle\(className, resultOnly\)/);
  assert.match(script, /content\.classList\.toggle\(className, resultOnly\)/);
  assert.match(script, /MutationObserver\(syncHistoryShell\)/);
});

test('explicit history shell removes the duplicate outer frame', () => {
  assert.match(css, /game-panel\.is-result-only-history[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /game-panel\.is-result-only-history[\s\S]*background:\s*transparent\s*!important/);
  assert.match(css, /game-content\.is-result-only-history[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /series-hero\[data-history-archive="missing"\][\s\S]*border:\s*1px solid var\(--rp-border\)/);
});

test('explicit shell assets load after the previous result-only repair', () => {
  const oldRepair = html.indexOf('history-result-only-repair.css');
  const finalRepair = html.indexOf('history-shell-edge-final.css');
  const stateScript = html.indexOf('history-shell-state.js');
  assert.ok(oldRepair >= 0 && finalRepair > oldRepair && stateScript > 0);
  assert.match(html, /history-shell-edge-final\.css\?v=20260730-1/);
  assert.match(html, /history-shell-state\.js\?v=20260730-1/);
});
