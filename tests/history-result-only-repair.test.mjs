import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const history = await readFile(new URL('../assets/series-game-history.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/history-result-only-repair.css', import.meta.url), 'utf8');

test('history records without game ids render one result-only surface', () => {
  assert.match(history, /summary\.dataset\.historyArchive = archiveAvailable \? 'available' : 'missing'/);
  assert.match(history, /Game archive unavailable/);
  assert.match(history, /Archive unavailable/);
  assert.match(history, /gameContent\.innerHTML = ''[\s\S]*renderSeriesNavigation\(\)/);
  assert.doesNotMatch(history, /Series result available<\/strong><span>No archived game IDs/);
});

test('missing archives do not show fake game navigation or verified state', () => {
  assert.match(history, /if \(!games\.length\)/);
  assert.match(history, /series-hero-games is-unavailable/);
  assert.match(history, /archiveAvailable \? 'Verified archive' : 'Archive unavailable'/);
  assert.match(history, /selectedNumber \? `Game \$\{selectedNumber\}` : 'Result only'/);
});

test('result-only rendering removes the structural panel frame synchronously', () => {
  assert.match(history, /function setResultOnlyHistoryShell\(active = false\)/);
  assert.match(history, /panel\.classList\.toggle\('panel', !active\)/);
  assert.match(history, /panel\.classList\.toggle\('app-panel', !active\)/);
  assert.match(history, /setResultOnlyHistoryShell\(!archiveAvailable\)/);
  assert.match(history, /setResultOnlyHistoryShell\(false\)[\s\S]*Loading match history/);
});

test('result-only repair loads after the general edge repair', () => {
  const surface = html.indexOf('surface-edge-repair.css');
  const resultOnly = html.indexOf('history-result-only-repair.css');
  assert.ok(surface >= 0 && resultOnly > surface);
  assert.match(html, /history-result-only-repair\.css\?v=20260730-2/);
  assert.match(html, /series-game-history\.js\?v=20260730-6/);
  assert.match(html, /data-ui-build="history-corner-frame-1"/);
  assert.match(css, /data-history-archive="missing"/);
  assert.match(css, /history-archive-unavailable/);
});

test('result-only history uses one outer card with flat internal rows', () => {
  assert.match(css, /game-panel:has\(\.series-hero\[data-history-archive="missing"\]\)[\s\S]*border:\s*0\s*!important/);
  assert.match(css, /game-content > \.series-hero\[data-history-archive="missing"\][\s\S]*border-radius:\s*12px\s*!important/);
  assert.match(css, /series-scoreboard-meta,[\s\S]*series-scoreboard-main,[\s\S]*series-scoreboard-navigation[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(css, /history-archive-unavailable[\s\S]*border:\s*0\s*!important[\s\S]*background:\s*transparent\s*!important/);
  assert.match(css, /series-scoreboard-main[\s\S]*border-bottom:\s*1px solid var\(--rp-divider\)/);
});
