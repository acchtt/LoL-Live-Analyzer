import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/minimal-pro-dark.css', import.meta.url), 'utf8');
const analysis = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');
const players = await readFile(new URL('../assets/live-player-ui.js', import.meta.url), 'utf8');
const drawer = await readFile(new URL('../assets/data-drawer.js', import.meta.url), 'utf8');

test('minimal pro dark stylesheet is the final visual override', () => {
  const heroIndex = html.indexOf('series-hero-refinement.css');
  const minimalIndex = html.indexOf('minimal-pro-dark.css');
  assert.ok(heroIndex >= 0 && minimalIndex > heroIndex);
  assert.match(css, /--bg:\s*#090d14/);
  assert.match(css, /grid-template-areas:[\s\S]*"schedule game"[\s\S]*"feed feed"/);
  assert.match(css, /\.series-hero-context\s*\{\s*display:\s*none\s*!important;/);
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
