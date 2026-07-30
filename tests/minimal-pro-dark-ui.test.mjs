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
const controlDock = await readFile(new URL('../assets/series-control-dock.css', import.meta.url), 'utf8');
const headerV2 = await readFile(new URL('../assets/series-header-layout-v2.css', import.meta.url), 'utf8');
const comparisonCss = await readFile(new URL('../assets/player-comparison-board.css', import.meta.url), 'utf8');
const comparisonJs = await readFile(new URL('../assets/player-comparison-board.js', import.meta.url), 'utf8');
const seriesScoreboardCss = await readFile(new URL('../assets/series-scoreboard-v3.css', import.meta.url), 'utf8');
const symmetryCss = await readFile(new URL('../assets/scoreboard-symmetry.css', import.meta.url), 'utf8');
const overviewCss = await readFile(new URL('../assets/overview-panel-v2.css', import.meta.url), 'utf8');
const trimCss = await readFile(new URL('../assets/scoreboard-detail-trim.css', import.meta.url), 'utf8');
const overviewJs = await readFile(new URL('../assets/overview-panel-v2.js', import.meta.url), 'utf8');
const seriesScoreboardJs = await readFile(new URL('../assets/series-scoreboard-v3.js', import.meta.url), 'utf8');
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
  const controlDockIndex = html.indexOf('series-control-dock.css');
  const headerV2Index = html.indexOf('series-header-layout-v2.css');
  const comparisonIndex = html.indexOf('player-comparison-board.css');
  const seriesScoreboardIndex = html.indexOf('series-scoreboard-v3.css');
  const symmetryIndex = html.indexOf('scoreboard-symmetry.css');
  const overviewIndex = html.indexOf('overview-panel-v2.css');
  const trimIndex = html.indexOf('scoreboard-detail-trim.css');
  assert.ok(
    heroIndex >= 0 &&
    minimalIndex > heroIndex &&
    fixesIndex > minimalIndex &&
    polishIndex > fixesIndex &&
    compactIndex > polishIndex &&
    readableIndex > compactIndex &&
    comfortableIndex > readableIndex &&
    controlDockIndex > comfortableIndex &&
    headerV2Index > controlDockIndex &&
    comparisonIndex > headerV2Index &&
    seriesScoreboardIndex > comparisonIndex &&
    symmetryIndex > seriesScoreboardIndex &&
    overviewIndex > symmetryIndex &&
    trimIndex > overviewIndex
  );
  assert.match(html, /series-control-dock\.css\?v=20260730-2/);
  assert.match(html, /series-header-layout-v2\.css\?v=20260730-1/);
  assert.match(html, /player-comparison-board\.css\?v=20260730-1/);
  assert.match(html, /player-comparison-board\.js\?v=20260730-1/);
  assert.match(html, /series-scoreboard-v3\.css\?v=20260730-1/);
  assert.match(html, /scoreboard-symmetry\.css\?v=20260730-1/);
  assert.match(html, /overview-panel-v2\.css\?v=20260730-2/);
  assert.match(html, /scoreboard-detail-trim\.css\?v=20260730-2/);
  assert.match(html, /overview-panel-v2\.js\?v=20260730-2/);
  assert.match(html, /series-scoreboard-v3\.js\?v=20260730-4/);
  assert.match(html, /<body class="minimal-pro-dark-v2" data-ui-build="series-score-card-repair-1">/);
  assert.match(css, /RIFTPULSE_MINIMAL_PRO_DARK_V2/);
  assert.match(css, /--rp-bg:\s*#0b0f15/);
  assert.match(fixes, /data-drawer:not\(\.is-open\) \.feed-body/);
  assert.match(headerV2, /series-hero\[data-header-layout-v2="true"\]/);
  assert.match(seriesScoreboardCss, /series-hero\[data-series-scoreboard-v3="true"\]/);
  assert.match(seriesScoreboardJs, /hero\.dataset\.seriesScoreboardV3 = 'true'/);
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

test('series and current-game scoreboards mirror both sides around the center', () => {
  assert.match(seriesScoreboardJs, /if \(side === 'a'\) team\.append\(logo, copy\)/);
  assert.match(seriesScoreboardJs, /else team\.append\(copy, logo\)/);
  assert.match(symmetryCss, /series-scoreboard-main[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 184px minmax\(0, 1fr\)/);
  assert.match(symmetryCss, /series-scoreboard-team\.is-team-a[\s\S]*grid-template-columns:\s*64px minmax\(0, 1fr\)/);
  assert.match(symmetryCss, /series-scoreboard-team\.is-team-b[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 64px/);
  assert.match(symmetryCss, /analysis-v2-scoreboard[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 144px minmax\(0, 1fr\)/);
  assert.match(symmetryCss, /analysis-v2-team\.is-blue[\s\S]*grid-template-areas:\s*"logo copy kills"/);
  assert.match(symmetryCss, /analysis-v2-team\.is-red[\s\S]*grid-template-areas:\s*"kills copy logo"/);
});

test('secondary scoreboard details are reduced and central score is repaired', () => {
  assert.match(trimCss, /analysis-v2-team[\s\S]*analysis-v2-team-copy > small[\s\S]*display:\s*none\s*!important/);
  assert.match(trimCss, /series-scoreboard-team-result[\s\S]*font-size:\s*9px\s*!important/);
  assert.match(trimCss, /series-scoreboard-team-result[\s\S]*opacity:\s*\.58\s*!important/);
  assert.match(trimCss, /series-scoreboard-score-value[\s\S]*column-gap:\s*14px\s*!important/);
  assert.match(trimCss, /series-scoreboard-score\.is-unresolved/);
  assert.match(seriesScoreboardJs, /`\$\{wins\} win\$\{wins === '1' \? '' : 's'\}`/);
  assert.match(seriesScoreboardJs, /value\.append\(left, separator, right\)/);
  assert.match(seriesScoreboardJs, /label\.textContent = 'No result'/);
});

test('game overview becomes a gold summary and objective comparison dashboard', () => {
  assert.match(overviewJs, /overview-gold-summary/);
  assert.match(overviewJs, /overview-objective-grid-v2/);
  assert.match(overviewJs, /objectiveCard\('Towers'/);
  assert.match(overviewJs, /objectiveCard\('Dragons'/);
  assert.match(overviewJs, /content\.replaceChildren\(dashboard\)/);
  assert.match(overviewJs, /typeof state === 'object'[\s\S]*state\.lastSnapshot/);
  assert.doesNotMatch(overviewJs, /globalThis\.state/);
  assert.match(overviewCss, /overview-gold-summary[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 214px minmax\(0, 1fr\)/);
  assert.match(overviewCss, /overview-objective-grid-v2[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(overviewCss, /overview-objective-track/);
});

test('player boards become one mirrored role-by-role comparison table', () => {
  assert.match(comparisonJs, /ROLE_ORDER = \['top', 'jungle', 'mid', 'bottom', 'support'\]/);
  assert.match(comparisonJs, /data-player-comparison/);
  assert.match(comparisonJs, /player-comparison-row/);
  assert.match(comparisonJs, /lineups\.replaceWith\(board\)/);
  assert.match(comparisonCss, /grid-template-areas:\s*"blue-items blue-stats blue-identity role red-identity red-stats red-items"/);
  assert.match(comparisonCss, /comparison-identity\.is-blue[\s\S]*flex-direction:\s*row-reverse/);
  assert.match(comparisonCss, /comparison-kda[\s\S]*font-size:\s*18px/);
  assert.match(comparisonCss, /champion-level/);
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
