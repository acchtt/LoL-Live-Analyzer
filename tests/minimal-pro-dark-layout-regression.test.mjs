import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const fixes = await readFile(new URL('../assets/minimal-pro-dark-v2-fixes.css', import.meta.url), 'utf8');
const initialSelection = await readFile(new URL('../assets/initial-match-selection.js', import.meta.url), 'utf8');

test('collapsed data drawer does not retain full panel height', () => {
  assert.match(html, /minimal-pro-dark-v2-fixes\.css\?v=20260729-2/);
  assert.match(fixes, /\.machine-panel\.data-drawer:not\(\.is-open\)[\s\S]*height:\s*46px\s*!important/);
  assert.match(fixes, /max-height:\s*46px\s*!important/);
});

test('legacy artwork background is disabled for the compact wordmark', () => {
  assert.match(fixes, /\.brand-identity[\s\S]*background-image:\s*none\s*!important/);
  assert.match(fixes, /\.brand-wordmark[\s\S]*display:\s*inline-flex\s*!important/);
});

test('the first active match is opened after the schedule loads', () => {
  assert.match(html, /initial-match-selection\.js\?v=20260729-1/);
  assert.match(initialSelection, /displayState\(event\) === 'inProgress'/);
  assert.match(initialSelection, /Promise\.resolve\(selectEvent\(id\)\)/);
});
