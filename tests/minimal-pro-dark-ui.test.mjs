import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/minimal-pro-dark-v2.css', import.meta.url), 'utf8');
const analysis = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');
const players = await readFile(new URL('../assets/live-player-ui.js', import.meta.url), 'utf8');
const drawer = await readFile(new URL('../assets/data-drawer.js', import.meta.url), 'utf8');

test('minimal pro dark v2 stylesheet is the final cache-safe visual override', () => {
  const heroIndex = html.indexOf('series-hero-refinement.css');
  const minimalIndex = html.indexOf('minimal-pro-dark-v2.css');
  assert.ok(heroIndex >= 0 && minimalIndex > heroIndex);
  assert.match(html, /<body class="minimal-pro-dark-v2" data-ui-build="minimal-pro-dark-v2">/);
  assert.match(css, /RIFTPULSE_MINIMAL_PRO_DARK_V2/);
  assert.match(css, /--rp-bg:\s*#0b0f15/);
  assert.match(css, /grid-template-areas:\s*"schedule game"\s*"feed feed"/);
  assert.match(css, /body\.minimal-pro-dark-v2 \.series-hero-context\s*\{\s*display:\s*none\s*!important;/);
});

test('machine-readable feed is collapsed into a bottom drawer', () => {
  assert.match(html, /data-data-drawer/);
  assert.match(html, /id="toggleDataDrawer"/);
  assert.match(html, /id="dataDrawerBody" class="feed-body" hidden/);
  assert.match(html, /assets\/data-drawer\.js\?v=20260729-1/);
  assert.match(drawer, /body\.hidden = !open/);
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
