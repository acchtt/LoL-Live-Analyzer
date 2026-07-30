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

test('result-only repair loads after the general edge repair', () => {
  const surface = html.indexOf('surface-edge-repair.css');
  const resultOnly = html.indexOf('history-result-only-repair.css');
  assert.ok(surface >= 0 && resultOnly > surface);
  assert.match(html, /series-game-history\.js\?v=20260730-5/);
  assert.match(html, /data-ui-build="history-result-only-repair-1"/);
  assert.match(css, /data-history-archive="missing"/);
  assert.match(css, /history-archive-unavailable/);
});