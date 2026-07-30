import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('delayed telemetry status distinguishes Riot source lag from retrieval time', async () => {
  const source = await readFile(new URL('../assets/analysis-cleanup.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(source, /function retrievalMs\(snapshot\)/);
  assert.match(source, /Riot feed delayed/);
  assert.match(source, /source lag/);
  assert.match(source, /retrieval/);
  assert.match(source, /betting verification remains paused until Riot advances to a fresh frame/);
  assert.match(html, /assets\/analysis-cleanup\.js\?v=20260731-1/);
});
