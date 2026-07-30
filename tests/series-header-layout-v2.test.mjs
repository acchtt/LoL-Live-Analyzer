import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/series-panel-clean.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/series-panel-clean.js', import.meta.url), 'utf8');
const symmetry = await readFile(new URL('../assets/scoreboard-symmetry.css', import.meta.url), 'utf8');

test('clean series assets replace every legacy series UI layer', () => {
  assert.match(html, /series-panel-clean\.css\?v=20260730-2/);
  assert.match(html, /series-panel-clean\.js\?v=20260730-1/);
  assert.match(html, /data-ui-build="series-panel-polished-card-1"/);
  assert.doesNotMatch(html, /series-scoreboard-v3|series-header-layout-v2|series-control-dock|series-panel-unified|history-shell-edge-final/);
});

test('one renderer handles live, archive, history, and result-only states', () => {
  assert.match(script, /function liveModel\(\)/);
  assert.match(script, /function historyModel\(\)/);
  assert.match(script, /variant: archiveMode \? 'archive' : 'live'/);
  assert.match(script, /variant: available \? 'history' : 'result-only'/);
  assert.match(script, /const model = liveModel\(\) \|\| historyModel\(\)/);
});

test('series matchup is structurally symmetrical', () => {
  assert.match(script, /matchup\.append\(createTeam\(model\.teams\[0\][\s\S]*createScore\(model\.score\)[\s\S]*createTeam\(model\.teams\[1\]/);
  assert.match(script, /if \(side === 'left'\) card\.append\(logo, copy\)/);
  assert.match(script, /else card\.append\(copy, logo\)/);
  assert.match(css, /series-clean-matchup[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 176px minmax\(0, 1fr\)/);
  assert.match(css, /series-clean-team\.is-left[\s\S]*grid-template-columns:\s*58px minmax\(0, 1fr\)/);
  assert.match(css, /series-clean-team\.is-right[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 58px/);
});

test('score values are separate and safely spaced', () => {
  assert.match(script, /value\.append\(left, separator, right\)/);
  assert.match(script, /available \? \(leftScore \?\? '—'\) : '—'/);
  assert.match(script, /detail: available \? `[\s\S]*` : 'No completed games'/);
  assert.match(css, /series-clean-score-value[\s\S]*grid-template-columns:\s*minmax\(40px, 1fr\) auto minmax\(40px, 1fr\)/);
  assert.match(css, /series-clean-score-value[\s\S]*column-gap:\s*20px\s*!important/);
});

test('game navigation owns a dedicated full-width row', () => {
  assert.match(script, /bottom\.className = 'series-clean-bottom'/);
  assert.match(script, /games\.className = 'series-clean-games'/);
  assert.match(script, /panel\.append\(top, matchup, bottom\)/);
  assert.match(css, /series-clean-bottom[\s\S]*border-top:\s*1px solid var\(--series-line\)/);
  assert.match(css, /series-clean-bottom[\s\S]*background:\s*rgba\(8, 13, 20, \.38\)/);
  assert.match(css, /series-clean-games[\s\S]*repeat\(var\(--series-clean-count\), minmax\(120px, 1fr\)\)/);
});

test('outer analysis shell is borderless and the series card owns one frame', () => {
  assert.match(css, /\.game-panel[\s\S]*border:\s*0\s*!important[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(css, /\.game-content[\s\S]*border:\s*0\s*!important[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(css, /series-clean-panel[\s\S]*border:\s*1px solid var\(--series-line-strong\)\s*!important/);
  assert.match(css, /series-clean-panel[\s\S]*border-radius:\s*10px\s*!important/);
  assert.match(css, /series-clean-panel::before,[\s\S]*display:\s*none\s*!important/);
});

test('current-game scoreboard remains mirrored around the clock', () => {
  assert.match(symmetry, /analysis-v2-scoreboard[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 144px minmax\(0, 1fr\)/);
  assert.match(symmetry, /analysis-v2-team\.is-blue[\s\S]*grid-template-areas:\s*"logo copy kills"/);
  assert.match(symmetry, /analysis-v2-team\.is-red[\s\S]*grid-template-areas:\s*"kills copy logo"/);
});