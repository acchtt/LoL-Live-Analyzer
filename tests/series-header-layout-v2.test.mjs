import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-header-layout-v2.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-header-layout-v2.js', import.meta.url), 'utf8');

test('series header v2 loads after the previous control dock styles', () => {
  const previous = html.indexOf('series-control-dock.css');
  const current = html.indexOf('series-header-layout-v2.css');
  assert.ok(previous >= 0 && current > previous);
  assert.match(html, /data-ui-build="series-header-layout-v2-1"/);
  assert.match(html, /series-header-layout-v2\.js\?v=20260730-1/);
});

test('score is structurally moved between the two teams', () => {
  assert.match(script, /matchup\.insertBefore\(score, rightTeam\)/);
  assert.match(script, /versus\?\.remove\(\)/);
  assert.match(css, /series-hero-matchup[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 132px minmax\(0, 1fr\)/);
});

test('archive control leaves the game rail and becomes a header action', () => {
  assert.match(script, /top\.appendChild\(controls\)/);
  assert.match(script, /returnButton\.textContent = 'Back to live'/);
  assert.match(css, /is-archive-mode[\s\S]*series-hero-badge[\s\S]*display:\s*none/);
  assert.match(css, /series-hero-rail[\s\S]*display:\s*block/);
});

test('archived telemetry empty state spans the analysis panel', () => {
  assert.match(css, /game-content > \.hero-empty[\s\S]*width:\s*calc\(100% - 32px\)/);
  assert.match(css, /grid-column:\s*1 \/ -1/);
});
