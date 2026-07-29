import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-scoreboard-v3.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-scoreboard-v3.js', import.meta.url), 'utf8');

test('series scoreboard v3 loads after the previous visual layers', () => {
  const previous = html.indexOf('player-comparison-board.css');
  const current = html.indexOf('series-scoreboard-v3.css');
  assert.ok(previous >= 0 && current > previous);
  assert.match(html, /data-ui-build="series-scoreboard-v3-1"/);
  assert.match(html, /series-scoreboard-v3\.js\?v=20260730-1/);
  assert.doesNotMatch(html, /series-header-layout-v2\.js\?v=20260730-1/);
});

test('scoreboard structurally centers the series score between teams', () => {
  assert.match(script, /main\.append\(leftTeam, score, rightTeam\)/);
  assert.match(script, /matchup\.querySelector\('\.series-hero-versus'\)\?\.remove\(\)/);
  assert.match(css, /series-scoreboard-main[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 184px minmax\(0, 1fr\)/);
  assert.match(css, /series-scoreboard-score > strong[\s\S]*font-size:\s*46px/);
});

test('status, context, and live return action live in a separate metadata row', () => {
  assert.match(script, /meta\.append\(metaPrimary, metaContext, metaActions\)/);
  assert.match(script, /returnButton\.textContent = 'Back to live'/);
  assert.match(css, /series-scoreboard-meta[\s\S]*grid-template-columns:\s*minmax\(180px, auto\) minmax\(0, 1fr\) auto/);
  assert.match(css, /series-scoreboard-meta-actions[\s\S]*justify-content:\s*flex-end/);
});

test('game navigation owns a full-width third row', () => {
  assert.match(script, /navigation\.append\(games\)/);
  assert.match(script, /hero\.replaceChildren\(meta, main, navigation\)/);
  assert.match(css, /series-scoreboard-navigation[\s\S]*border-top:\s*1px solid/);
  assert.match(css, /data-series-length="5"[\s\S]*repeat\(5, minmax\(130px, 1fr\)\)/);
});
