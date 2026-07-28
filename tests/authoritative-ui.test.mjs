import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadAuthority(snapshot) {
  const source = await readFile(new URL('../assets/authoritative-ui.js', import.meta.url), 'utf8');
  const calls = { renders: 0, connection: null, banner: null };
  const header = {
    insertAdjacentElement: (_position, element) => { calls.banner = element; }
  };
  const shell = {
    querySelector: () => header,
    prepend: element => { calls.banner = element; }
  };
  const gameContent = {
    innerHTML: '',
    querySelector: () => shell,
    prepend: element => { calls.banner = element; }
  };
  const event = {
    match: {
      teams: [
        { id: 'blue', name: 'DK Challengers', result: { gameWins: 1 } },
        { id: 'red', name: 'KT Challengers', result: { gameWins: 1 } }
      ]
    },
    league: { name: 'LCK Challengers' }
  };
  const context = {
    console,
    URLSearchParams,
    document: {
      hidden: false,
      head: { appendChild: () => {} },
      createElement: tag => ({
        tag,
        className: '',
        textContent: '',
        innerHTML: '',
        setAttribute: () => {}
      })
    },
    window: null,
    state: {
      selectedGameId: 'game-3',
      selectedEventId: 'match-1',
      selectedMatchState: 'inProgress',
      lastSnapshot: null
    },
    gameContent,
    jsonPreview: { textContent: '' },
    selectedScheduleEvent: () => event,
    eventTeams: value => value?.match?.teams || [],
    renderSchedule: () => {},
    markMatchLive: () => {},
    playerRows: () => '',
    setJsonEndpoint: () => {},
    setConnection: label => { calls.connection = label; },
    renderGame: value => {
      calls.renders += 1;
      context.state.lastSnapshot = value;
    },
    api: async () => snapshot,
    loadGame: async () => {}
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'authoritative-ui.js' });
  return { context, calls };
}

function degradedSnapshot(status = 'degraded') {
  return {
    status,
    updatedAt: new Date().toISOString(),
    source: {
      gameId: 'game-3',
      frameTimestamp: new Date(Date.now() - 70_000).toISOString(),
      dataAgeSeconds: 70
    },
    quality: {
      frameAgeSeconds: 70,
      safeForLiveAnalysis: false,
      criticalMissingFields: ['blue.players.0.items', 'red.players.0.items']
    },
    match: { gameNumber: 3, league: 'LCK Challengers' },
    series: { teams: [] },
    clock: '18:42',
    clockSeconds: 1122,
    blue: { name: 'DK Challengers', gold: 31000, kills: 8, towers: 3, barons: 0, inhibitors: 0 },
    red: { name: 'KT Challengers', gold: 32500, kills: 10, towers: 4, barons: 0, inhibitors: 0 },
    differences: { gold: -1500 }
  };
}

test('degraded map data with only item details missing stays visible and gets a compact label', async () => {
  const { context, calls } = await loadAuthority(degradedSnapshot());
  await context.loadGame();

  assert.equal(calls.renders, 1);
  assert.match(calls.connection, /^LIVE · map stats · items pending/);
  assert.match(calls.banner?.innerHTML || '', /Live map data/);
  assert.doesNotMatch(context.gameContent.innerHTML, /Live stats unavailable/);
});

test('other missing betting-critical fields remain labeled partial', async () => {
  const snapshot = degradedSnapshot();
  snapshot.quality.criticalMissingFields = ['blue.players.0.level'];
  const { context, calls } = await loadAuthority(snapshot);
  await context.loadGame();

  assert.equal(calls.renders, 1);
  assert.match(calls.connection, /^LIVE · partial stats/);
  assert.match(calls.banner?.innerHTML || '', /Partial live telemetry/);
});

test('stale cached gameplay renders as clearly labeled context', async () => {
  const { context, calls } = await loadAuthority(degradedSnapshot('telemetry_stale'));
  await context.loadGame();

  assert.equal(calls.renders, 1);
  assert.match(calls.connection, /^LIVE · stale context/);
  assert.match(calls.banner?.innerHTML || '', /Stale telemetry context/);
});

test('a snapshot without usable map totals still fails closed', async () => {
  const snapshot = degradedSnapshot('telemetry_unavailable');
  snapshot.blue = {};
  snapshot.red = {};
  snapshot.clockSeconds = null;
  const { context, calls } = await loadAuthority(snapshot);
  await context.loadGame();

  assert.equal(calls.renders, 0);
  assert.equal(calls.connection, 'LIVE · stats unavailable');
  assert.match(context.gameContent.innerHTML, /Live stats unavailable/);
});
