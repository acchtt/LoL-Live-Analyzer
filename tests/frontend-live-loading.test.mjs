import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function scriptSources(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
}

test('authoritative live loader remains the final data renderer before lifecycle recovery', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = scriptSources(html);
  const authorityIndex = scripts.findIndex(src => src.startsWith('assets/authoritative-ui.js'));
  const lifecycleIndex = scripts.findIndex(src => src.startsWith('assets/reliable-lifecycle.js'));

  assert.ok(authorityIndex >= 0, 'authoritative-ui.js must be loaded');
  assert.ok(lifecycleIndex > authorityIndex, 'reliable-lifecycle.js must wrap the authoritative loader');
  assert.equal(
    scripts.some(src => src.includes('live-fetch-acceleration.js')),
    false,
    'a later loader override must not bypass authoritative status handling and game re-resolution'
  );
});

test('authoritative loader requests advancing frames without replacing lifecycle handling', async () => {
  const source = await readFile(new URL('../assets/authoritative-ui.js', import.meta.url), 'utf8');

  assert.match(source, /query\.set\('after', after\)/);
  assert.match(source, /state\.lastSnapshot\s*=\s*snapshot/);
  assert.match(source, /\['degraded', 'telemetry_stale'\]/);
});

test('main analysis panel is a bounded scroll container with compact sizing', async () => {
  const css = await readFile(new URL('../assets/analysis-priority.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(css, /\.game-panel \.game-content\s*\{[^}]*height:\s*100%\s*!important;[^}]*max-height:\s*100%\s*!important;[^}]*overflow-y:\s*auto\s*!important;/s);
  assert.match(css, /\.analysis-v2-team\s*\{[^}]*min-height:\s*88px\s*!important;/s);
  assert.match(css, /\.analysis-v2-lineup \.player-row,[\s\S]*min-height:\s*48px\s*!important;/);
  assert.match(html, /assets\/analysis-priority\.css\?v=20260729-2/);
});

test('missing player and map values are not converted into fake zeroes', async () => {
  const playerSource = await readFile(new URL('../assets/live-player-ui.js', import.meta.url), 'utf8');
  const analysisSource = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');

  assert.match(playerSource, /function displayInteger\(value\)/);
  assert.doesNotMatch(playerSource, /player\?\.(?:kills|deaths|assists|creepScore)\s*\|\|\s*0/);
  assert.match(analysisSource, /function finiteNumber\(value\)/);
  assert.match(analysisSource, /Gold lead unavailable/);
});

test('analysis clock uses the reliability-aware clock helper and freezes stale frames', async () => {
  const playerSource = await readFile(new URL('../assets/live-player-ui.js', import.meta.url), 'utf8');
  const analysisSource = await readFile(new URL('../assets/analysis-workspace-v2.js', import.meta.url), 'utf8');

  assert.match(playerSource, /snapshot\?\.status === 'telemetry_stale'/);
  assert.match(playerSource, /document\.querySelector\('\.analysis-v2-clock, \.clock'\)/);
  assert.match(playerSource, /globalThis\.RiftPulsePlayerUI/);
  assert.match(analysisSource, /RiftPulsePlayerUI\?\.configureClock/);
});