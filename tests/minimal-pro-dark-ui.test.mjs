import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/minimal-pro-dark-v2.css', import.meta.url), 'utf8');
const fixes = await readFile(new URL('../assets/minimal-pro-dark-v2-fixes.css', import.meta.url), 'utf8');
const polish = await readFile(new URL('../assets/minimal-pro-dark-v2-polish.css', import.meta.url), 'utf8');
const compact = await readFile(new URL('../assets/compact-series-scoreboard.css', import.meta.url), 'utf8');
const analysis = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');
const players = await readFile(new URL('../assets/live-player-ui.js', import.meta.url), 'utf8');
const drawer = await readFile(new URL('../assets/data-drawer.js', import.meta.url), 'utf8');
const unavailable = await readFile(new URL('../assets/telemetry-unavailable-ui.js', import.meta.url), 'utf8');

test('minimal pro dark v2 styles load in final cache-safe order', () => {
  const heroIndex = html.indexOf('series-hero-refinement.css');
  const minimalIndex = html.indexOf('minimal-pro-dark-v2.css');
  const fixesIndex = html.indexOf('minimal-pro-dark-v2-fixes.css');
  const polishIndex = html.indexOf('minimal-pro-dark-v2-polish.css');
  const compactIndex = html.indexOf('compact-series-scoreboard.css');
  assert.ok(
    heroIndex >= 0 &&
    minimalIndex > heroIndex &&
    fixesIndex > minimalIndex &&
    polishIndex > fixesIndex &&
    compactIndex > polishIndex
  );
  assert.match(html, /<body class="minimal-pro-dark-v2" data-ui-build="compact-series-scoreboard-1">/);
  assert.match(css, /RIFTPULSE_MINIMAL_PRO_DARK_V2/);
  assert.match(css, /--rp-bg:\s*#0b0f15/);
  assert.match(css, /grid-template-areas:\s*"schedule game"\s*"feed feed"/);
  assert.match(css, /body\.minimal-pro-dark-v2 \.series-hero-context\s*\{\s*display:\s*none\s*!important;/);
  assert.match(fixes, /data-drawer:not\(\.is-open\) \.feed-body/);
  assert.match(fixes, /game-content > \.hero-empty/);
});

test('machine-readable feed is collapsed into a bottom drawer', () => {
  assert.match(html, /data-data-drawer/);
  assert.match(html, /id="toggleDataDrawer"/);
  assert.match(html, /id="dataDrawerBody" class="feed-body" hidden aria-hidden="true" style="display:none!important"/);
  assert.match(html, /assets\/data-drawer\.js\?v=20260729-2/);
  assert.match(drawer, /body\.hidden = !open/);
  assert.match(drawer, /style\.setProperty\('display', open \? 'grid' : 'none', 'important'\)/);
});

test('broadcast-live state does not claim telemetry is available', () => {
  assert.match(html, /assets\/telemetry-unavailable-ui\.js\?v=20260729-1/);
  assert.match(unavailable, /Telemetry unavailable/);
  assert.match(unavailable, /Riot live stats unavailable/);
  assert.match(unavailable, /state\.telemetryUnavailable = true/);
});

test('hover treatment is consistent and motion-free', () => {
  assert.match(polish, /@media \(hover: hover\)/);
  assert.match(polish, /\.match-card:hover:not\(\.active\)/);
  assert.match(polish, /\.series-hero-game:hover:not\(:disabled\):not\(\.is-selected\)/);
  assert.match(polish, /\.schedule-tab\.active:hover/);
  assert.match(polish, /transform:\s*none\s*!important/);
  assert.match(polish, /:focus-visible/);
});

test('scoreboard is a tighter mirrored three-column strip', () => {
  assert.match(compact, /grid-template-columns:\s*minmax\(0, 1fr\) 104px minmax\(0, 1fr\)/);
  assert.match(compact, /analysis-v2-team\.is-blue[\s\S]*34px minmax\(0, 1fr\) 52px/);
  assert.match(compact, /analysis-v2-team\.is-red[\s\S]*52px minmax\(0, 1fr\) 34px/);
  assert.match(compact, /min-height:\s*66px\s*!important/);
});

test('series header is a compact two-row information bar', () => {
  assert.match(compact, /series-hero-top[\s\S]*grid-template-columns:\s*112px minmax\(0, 1fr\) 92px/);
  assert.match(compact, /series-hero-main[\s\S]*display:\s*contents\s*!important/);
  assert.match(compact, /series-hero-score[\s\S]*position:\s*static\s*!important/);
  assert.match(compact, /series-hero-rail[\s\S]*min-height:\s*48px\s*!important/);
});

test('analysis order is scoreboard, overview, odds, then player tables', () => {
  const scoreboard = analysis.indexOf('analysis-v2-scoreboard');
  const overview = analysis.indexOf('${overviewSection}');
  const odds = analysis.indexOf('${oddsSection}');
  const lineups = analysis.indexOf('analysis-v2-lineups players');
  assert.ok(scoreboard >= 0 && overview > scoreboard && odds > overview && lineups > odds);
});

test('game overview uses one responsive gold-and-objective grid', () => {
  assert.match(analysis, /analysis-v2-overview-grid/);
  assert.match(analysis, /class="is-blue"/);
  assert.match(analysis, /class="is-red"/);
  assert.match(polish, /grid-template-columns:\s*minmax\(250px, 1\.7fr\) repeat\(4, minmax\(105px, 1fr\)\)/);
  assert.match(polish, /analysis-v2-lead\s*\{[\s\S]*grid-template-rows/);
});

test('player tables expose KDA, CS, gold, and item columns without zero-filling missing data', () => {
  for (const label of ['KDA', 'CS', 'Gold', 'Items']) assert.match(analysis, new RegExp(`<span>${label}</span>`));
  assert.match(players, /class="player-gold"/);
  assert.match(players, /class="player-items"/);
  assert.match(players, /return parsed === null \? '—'/);
  assert.doesNotMatch(players, /Number\(player\?\.kills \|\| 0\)/);
});