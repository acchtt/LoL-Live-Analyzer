import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-scoreboard-v3.css', import.meta.url), 'utf8');
const symmetry = await readFile(new URL('../assets/scoreboard-symmetry.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-scoreboard-v3.js', import.meta.url), 'utf8');

test('series scoreboard loads before the final symmetry and overview layers', () => {
  const previous = html.indexOf('player-comparison-board.css');
  const scoreboard = html.indexOf('series-scoreboard-v3.css');
  const symmetryIndex = html.indexOf('scoreboard-symmetry.css');
  const overviewIndex = html.indexOf('overview-panel-v2.css');
  assert.ok(previous >= 0 && scoreboard > previous && symmetryIndex > scoreboard && overviewIndex > symmetryIndex);
  assert.match(html, /data-ui-build="overview-panel-v2-1"/);
  assert.match(html, /series-scoreboard-v3\.js\?v=20260730-2/);
  assert.match(html, /scoreboard-symmetry\.css\?v=20260730-1/);
  assert.doesNotMatch(html, /series-header-layout-v2\.js\?v=20260730-1/);
});

test('scoreboard structurally centers the series score between mirrored teams', () => {
  assert.match(script, /main\.append\(leftTeam, score, rightTeam\)/);
  assert.match(script, /if \(side === 'a'\) team\.append\(logo, copy\)/);
  assert.match(script, /else team\.append\(copy, logo\)/);
  assert.match(css, /series-scoreboard-main[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 184px minmax\(0, 1fr\)/);
  assert.match(symmetry, /series-scoreboard-team\.is-team-a[\s\S]*grid-template-columns:\s*64px minmax\(0, 1fr\)/);
  assert.match(symmetry, /series-scoreboard-team\.is-team-b[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 64px/);
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

test('current-game scoreboard mirrors kills beside the center clock', () => {
  assert.match(symmetry, /analysis-v2-scoreboard[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 144px minmax\(0, 1fr\)/);
  assert.match(symmetry, /analysis-v2-team\.is-blue[\s\S]*grid-template-areas:\s*"logo copy kills"/);
  assert.match(symmetry, /analysis-v2-team\.is-red[\s\S]*grid-template-areas:\s*"kills copy logo"/);
});