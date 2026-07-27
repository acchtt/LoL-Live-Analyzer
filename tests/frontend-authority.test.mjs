import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REMOVED_AUTHORITY_LAYERS = [
  'assets/data-enrichment.js',
  'assets/game-transition-score.js',
  'assets/lifecycle-integrity.js',
  'assets/bookmaker-series-score.js',
  'assets/schedule-tabs.js'
];

test('production UI does not load inferred or hardcoded score authority layers', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const script of REMOVED_AUTHORITY_LAYERS) {
    assert.equal(html.includes(script), false, `${script} must remain disabled`);
  }
  assert.equal(html.includes('assets/authoritative-ui.js'), true);
  assert.equal(html.includes('assets/reliable-lifecycle.js'), true);
  assert.equal(html.includes('assets/match-history.js'), true);
});
