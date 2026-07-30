import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-panel-clean.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-panel-clean.js', import.meta.url), 'utf8');

test('clean renderer restores the normal host classes instead of toggling repair shells', () => {
  assert.match(script, /function restoreHostShell\(\)/);
  assert.match(script, /host\.classList\.add\('panel', 'app-panel'\)/);
  assert.match(script, /host\.classList\.remove\('is-result-only-history'\)/);
  assert.match(script, /delete host\.dataset\.historyShell/);
  assert.doesNotMatch(html, /history-shell-state\.js/);
});

test('outer game area has no decorative frame or radius', () => {
  assert.match(css, /\.game-panel[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /\.game-panel[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(css, /\.game-panel[\s\S]*background:\s*transparent\s*!important/);
  assert.match(css, /\.game-content[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /\.game-content[\s\S]*border-radius:\s*0\s*!important/);
});

test('series panel owns the only visible frame', () => {
  assert.match(css, /series-clean-panel[\s\S]*border:\s*1px solid var\(--series-line-strong\)\s*!important/);
  assert.match(css, /series-clean-panel[\s\S]*border-radius:\s*10px\s*!important/);
  assert.match(css, /series-clean-panel::before,[\s\S]*display:\s*none\s*!important/);
  assert.doesNotMatch(css, /contain:\s*paint|box-shadow:\s*inset 0 0 0 1px/);
});

test('all previous corner repair assets are removed from runtime', () => {
  assert.match(html, /series-panel-clean\.css\?v=20260730-2/);
  assert.match(html, /data-ui-build="series-panel-polished-card-1"/);
  assert.doesNotMatch(html, /history-shell-edge-final|history-result-only-repair|surface-edge-repair|series-panel-unified/);
});