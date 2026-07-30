import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/minimal-pro-dark-v2.css', import.meta.url), 'utf8');
const fixes = await readFile(new URL('../assets/minimal-pro-dark-v2-fixes.css', import.meta.url), 'utf8');
const polish = await readFile(new URL('../assets/minimal-pro-dark-v2-polish.css', import.meta.url), 'utf8');
const readable = await readFile(new URL('../assets/readable-density.css', import.meta.url), 'utf8');
const comfortable = await readFile(new URL('../assets/comfortable-reading-layout.css', import.meta.url), 'utf8');
const comparisonCss = await readFile(new URL('../assets/player-comparison-board.css', import.meta.url), 'utf8');
const comparisonJs = await readFile(new URL('../assets/player-comparison-board.js', import.meta.url), 'utf8');
const symmetryCss = await readFile(new URL('../assets/scoreboard-symmetry.css', import.meta.url), 'utf8');
const overviewCss = await readFile(new URL('../assets/overview-panel-v2.css', import.meta.url), 'utf8');
const overviewJs = await readFile(new URL('../assets/overview-panel-v2.js', import.meta.url), 'utf8');
const trimCss = await readFile(new URL('../assets/scoreboard-detail-trim.css', import.meta.url), 'utf8');
const seriesCss = await readFile(new URL('../assets/series-panel-clean.css', import.meta.url), 'utf8');
const seriesJs = await readFile(new URL('../assets/series-panel-clean.js', import.meta.url), 'utf8');
const analysis = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');
const players = await readFile(new URL('../assets/live-player-ui.js', import.meta.url), 'utf8');
const drawer = await readFile(new URL('../assets/data-drawer.js', import.meta.url), 'utf8');
const unavailable = await readFile(new URL('../assets/telemetry-unavailable-ui.js', import.meta.url), 'utf8');

test('minimal pro dark assets end with the clean series rebuild', () => {
  const minimalIndex = html.indexOf('minimal-pro-dark-v2.css');
  const fixesIndex = html.indexOf('minimal-pro-dark-v2-fixes.css');
  const polishIndex = html.indexOf('minimal-pro-dark-v2-polish.css');
  const readableIndex = html.indexOf('readable-density.css');
  const comfortableIndex = html.indexOf('comfortable-reading-layout.css');
  const comparisonIndex = html.indexOf('player-comparison-board.css');
  const symmetryIndex = html.indexOf('scoreboard-symmetry.css');
  const overviewIndex = html.indexOf('overview-panel-v2.css');
  const trimIndex = html.indexOf('scoreboard-detail-trim.css');
  const cleanIndex = html.indexOf('series-panel-clean.css');

  assert.ok(
    minimalIndex >= 0 &&
    fixesIndex > minimalIndex &&
    polishIndex > fixesIndex &&
    readableIndex > polishIndex &&
    comfortableIndex > readableIndex &&
    comparisonIndex > comfortableIndex &&
    symmetryIndex > comparisonIndex &&
    overviewIndex > symmetryIndex &&
    trimIndex > overviewIndex &&
    cleanIndex > trimIndex
  );

  assert.match(html, /series-panel-clean\.css\?v=20260730-1/);
  assert.match(html, /series-panel-clean\.js\?v=20260730-1/);
  assert.match(html, /data-ui-build="series-panel-clean-rebuild-1"/);
  assert.doesNotMatch(html, /series-hero\.css|series-scoreboard-v3|history-shell-edge-final|history-result-only-repair|series-panel-unified/);
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
  assert.match(polish, /transform:\s*none\s*!important/);
  assert.match(polish, /:focus-visible/);
});

test('main analysis uses natural page height instead of viewport compression', () => {
  assert.match(comfortable, /\.game-panel,[\s\S]*\.game-content[\s\S]*height:\s*auto\s*!important/);
  assert.match(comfortable, /\.game-panel,[\s\S]*\.game-content[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(comfortable, /body\.minimal-pro-dark-v2\s*\{[\s\S]*font-size:\s*16px\s*!important/);
});

test('current-game scoreboard remains mirrored and readable', () => {
  assert.match(comfortable, /grid-template-columns:\s*minmax\(0, 1fr\) 132px minmax\(0, 1fr\)/);
  assert.match(comfortable, /analysis-v2-team,[\s\S]*min-height:\s*104px\s*!important/);
  assert.match(symmetryCss, /analysis-v2-scoreboard[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 144px minmax\(0, 1fr\)/);
  assert.match(symmetryCss, /analysis-v2-team\.is-blue[\s\S]*grid-template-areas:\s*"logo copy kills"/);
  assert.match(symmetryCss, /analysis-v2-team\.is-red[\s\S]*grid-template-areas:\s*"kills copy logo"/);
  assert.match(trimCss, /analysis-v2-team[\s\S]*analysis-v2-team-copy > small[\s\S]*display:\s*none\s*!important/);
});

test('clean series panel mirrors teams around separated score values', () => {
  assert.match(seriesJs, /matchup\.append\(createTeam\(model\.teams\[0\][\s\S]*createScore\(model\.score\)[\s\S]*createTeam\(model\.teams\[1\]/);
  assert.match(seriesJs, /if \(side === 'left'\) card\.append\(logo, copy\)/);
  assert.match(seriesJs, /else card\.append\(copy, logo\)/);
  assert.match(seriesJs, /value\.append\(left, separator, right\)/);
  assert.match(seriesCss, /series-clean-matchup[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 190px minmax\(0, 1fr\)/);
  assert.match(seriesCss, /series-clean-score-value[\s\S]*column-gap:\s*18px\s*!important/);
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
});

test('player boards become one mirrored role-by-role comparison table', () => {
  assert.match(comparisonJs, /ROLE_ORDER = \['top', 'jungle', 'mid', 'bottom', 'support'\]/);
  assert.match(comparisonJs, /data-player-comparison/);
  assert.match(comparisonJs, /player-comparison-row/);
  assert.match(comparisonJs, /lineups\.replaceWith\(board\)/);
  assert.match(comparisonCss, /grid-template-areas:\s*"blue-items blue-stats blue-identity role red-identity red-stats red-items"/);
  assert.match(comparisonCss, /comparison-identity\.is-blue[\s\S]*flex-direction:\s*row-reverse/);
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
