import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/minimal-pro-dark-v2.css', import.meta.url), 'utf8');
const fixes = await readFile(new URL('../assets/minimal-pro-dark-v2-fixes.css', import.meta.url), 'utf8');
const polish = await readFile(new URL('../assets/minimal-pro-dark-v2-polish.css', import.meta.url), 'utf8');
const compact = await readFile(new URL('../assets/compact-series-scoreboard.css', import.meta.url), 'utf8');
const readable = await readFile(new URL('../assets/readable-density.css', import.meta.url), 'utf8');
const comfortable = await readFile(new URL('../assets/comfortable-reading-layout.css', import.meta.url), 'utf8');
const analysis = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');
const players = await readFile(new URL('../assets/live-player-ui.js', import.meta.url), 'utf8');
const drawer = await readFile(new URL('../assets/data-drawer.js', import.meta.url), 'utf8');
const unavailable = await readFile(new URL('../assets/telemetry-unavailable-ui.js', import.meta.url), 'utf8');

test('minimal pro dark styles load in final cache-safe order', () => {
  const heroIndex = html.indexOf('series-hero-refinement.css');
  const minimalIndex = html.indexOf('minimal-pro-dark-v2.css');
  const fixesIndex = html.indexOf('minimal-pro-dark-v2-fixes.css');
  const polishIndex = html.indexOf('minimal-pro-dark-v2-polish.css');
  const compactIndex = html.indexOf('compact-series-scoreboard.css');
  const readableIndex = html.indexOf('readable-density.css');
  const comfortableIndex = html.indexOf('comfortable-reading-layout.css');
  assert.ok(
    heroIndex >= 0 &&
    minimalIndex > heroIndex &&
    fixesIndex > minimalIndex &&
    polishIndex > fixesIndex &&
    compactIndex > polishIndex &&
    readableIndex > compactIndex &&
    comfortableIndex > readableIndex
  );
  assert.match(html, /<body class="minimal-pro-dark-v2" data-ui-build="comfortable-reading-layout-1">/);
  assert.match(css, /RIFTPULSE_MINIMAL_PRO_DARK_V2/);
  assert.match(css, /--rp-bg:\s*#0b0f15/);
  assert.match(fixes, /data-drawer:not\(\.is-open\) \.feed-body/);
});

test('machine-readable feed is collapsed into a bottom drawer', () => {
  assert.match(html, /data-data-drawer/);
  assert.match(html, /id="toggleDataDrawer"/);
  assert.match(html, /id="dataDrawerBody" class="feed-body" hidden aria-hidden="true" style="display:none!important"/);
  assert.match(drawer, /body\.hidden = !open/);
  assert.match(drawer, /style\.setProperty\('display', open \? 'grid' : 'none', 'important'\)/);
});

test('broadcast-live state does not claim telemetry is available', () => {
  assert.match(unavailable, /Telemetry unavailable/);
  assert.match(unavailable, /Riot live stats unavailable/);
  assert.match(unavailable, /state\.telemetryUnavailable = true/);
});

test('hover treatment is consistent and motion-free', () => {
  assert.match(polish, /@media \(hover: hover\)/);
  assert.match(polish, /\.match-card:hover:not\(\.active\)/);
  assert.match(polish, /\.series-hero-game:hover:not\(:disabled\):not\(\.is-selected\)/);
  assert.match(polish, /transform:\s*none\s*!important/);
  assert.match(polish, /:focus-visible/);
});

test('main analysis uses natural page height instead of viewport compression', () => {
  assert.match(comfortable, /\.game-panel,[\s\S]*\.game-content[\s\S]*height:\s*auto\s*!important/);
  assert.match(comfortable, /\.game-panel,[\s\S]*\.game-content[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(comfortable, /body\.minimal-pro-dark-v2\s*\{[\s\S]*font-size:\s*16px\s*!important/);
});

test('scoreboard uses large readable desktop sizing', () => {
  assert.match(compact, /grid-template-columns:\s*minmax\(0, 1fr\) 104px minmax\(0, 1fr\)/);
  assert.match(comfortable, /grid-template-columns:\s*minmax\(0, 1fr\) 132px minmax\(0, 1fr\)/);
  assert.match(comfortable, /analysis-v2-team,[\s\S]*min-height:\s*104px\s*!important/);
  assert.match(comfortable, /analysis-v2-team-copy h3[\s\S]*font-size:\s*18px\s*!important/);
  assert.match(comfortable, /analysis-v2-team-kills[\s\S]*font-size:\s*34px\s*!important/);
});

test('series header keeps two rows with larger labels and controls', () => {
  assert.match(compact, /series-hero-main[\s\S]*display:\s*contents\s*!important/);
  assert.match(comfortable, /series-hero-top[\s\S]*grid-template-columns:\s*150px minmax\(0, 1fr\) 120px/);
  assert.match(comfortable, /series-hero-game > span[\s\S]*font-size:\s*12px\s*!important/);
  assert.match(comfortable, /series-hero-score > strong[\s\S]*font-size:\s*30px\s*!important/);
});

test('game overview wraps into a spacious two-row layout', () => {
  assert.match(analysis, /analysis-v2-overview-grid/);
  assert.match(comfortable, /analysis-v2-overview-grid[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(comfortable, /analysis-v2-lead\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(comfortable, /analysis-v2-objective\s*\{[\s\S]*min-height:\s*112px/);
});

test('player boards stack vertically with larger rows and portraits', () => {
  assert.match(comfortable, /analysis-v2-lineups[\s\S]*grid-template-columns:\s*1fr\s*!important/);
  assert.match(comfortable, /enhanced-player-row,[\s\S]*min-height:\s*72px\s*!important/);
  assert.match(comfortable, /player-copy strong[\s\S]*font-size:\s*15px\s*!important/);
  assert.match(comfortable, /champion-portrait[\s\S]*width:\s*46px\s*!important/);
});

test('analysis order is scoreboard, overview, odds, then player tables', () => {
  const scoreboard = analysis.indexOf('analysis-v2-scoreboard');
  const overview = analysis.indexOf('${overviewSection}');
  const odds = analysis.indexOf('${oddsSection}');
  const lineups = analysis.indexOf('analysis-v2-lineups players');
  assert.ok(scoreboard >= 0 && overview > scoreboard && odds > overview && lineups > odds);
});

test('player tables expose KDA, CS, gold, and item columns without zero-filling missing data', () => {
  for (const label of ['KDA', 'CS', 'Gold', 'Items']) assert.match(analysis, new RegExp(`<span>${label}</span>`));
  assert.match(players, /class="player-gold"/);
  assert.match(players, /class="player-items"/);
  assert.match(players, /return parsed === null \? '—'/);
  assert.doesNotMatch(players, /Number\(player\?\.kills \|\| 0\)/);
});
