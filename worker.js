const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const DEFAULT_LOCALE = 'en-US';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Type, Cache-Control',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors(),
      ...extra
    }
  });
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function riotPersisted(path, params, env) {
  const key = env.LOL_ESPORTS_API_KEY;
  if (!key) {
    throw new Error('LOL_ESPORTS_API_KEY is not configured in the Worker.');
  }

  const url = new URL(`${PERSISTED_BASE}/${path}`);
  url.searchParams.set('hl', DEFAULT_LOCALE);
  for (const [name, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-api-key': key
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Riot ${path} returned ${response.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

async function riotLive(path) {
  const response = await fetch(`${LIVE_BASE}/${path}`, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Riot live feed returned ${response.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

function latestFrame(payload) {
  const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
  return Array.isArray(frames) && frames.length ? frames[frames.length - 1] : payload?.frame || payload;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationClock(value) {
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value)) return value;
  const total = Math.max(0, Math.floor(number(value) / (number(value) > 10000 ? 1000 : 1)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function participantList(frame) {
  return frame?.participants || frame?.participantFrames || frame?.players || [];
}

function participantTeamId(player, index) {
  return player?.teamID || player?.teamId || (number(player?.participantID || player?.participantId || index + 1) <= 5 ? 100 : 200);
}

function normalizePlayer(player, index) {
  return {
    participantId: player?.participantID || player?.participantId || index + 1,
    name: player?.summonerName || player?.name || player?.playerName || `Player ${index + 1}`,
    champion: player?.championName || player?.champion || player?.championId || null,
    level: number(player?.level),
    kills: number(player?.kills),
    deaths: number(player?.deaths),
    assists: number(player?.assists),
    creepScore: number(player?.creepScore ?? player?.cs ?? player?.minionsKilled),
    totalGold: number(player?.totalGold ?? player?.gold),
    currentGold: number(player?.currentGold),
    items: player?.items || []
  };
}

function findTeam(frame, id, side) {
  const teams = frame?.teams || frame?.teamStats || [];
  return teams.find(team => String(team?.teamID ?? team?.teamId ?? team?.id) === String(id)) || teams[side === 'blue' ? 0 : 1] || {};
}

function objectiveCount(team, names) {
  for (const name of names) {
    if (team?.[name] !== undefined) return number(team[name]);
  }
  return 0;
}

function normalizeSide(frame, side, metadata = {}) {
  const id = side === 'blue' ? 100 : 200;
  const team = findTeam(frame, id, side);
  const players = participantList(frame)
    .map((player, index) => ({ raw: player, index }))
    .filter(({ raw, index }) => String(participantTeamId(raw, index)) === String(id))
    .map(({ raw, index }) => normalizePlayer(raw, index));

  const killsFromPlayers = players.reduce((sum, player) => sum + player.kills, 0);
  const totalGoldFromPlayers = players.reduce((sum, player) => sum + player.totalGold, 0);
  const dragons = team?.dragons || team?.dragonTypes || [];

  return {
    id,
    side,
    name: metadata.name || team?.name || (side === 'blue' ? 'Blue side' : 'Red side'),
    code: metadata.code || null,
    image: metadata.image || null,
    gold: number(team?.totalGold ?? team?.gold) || totalGoldFromPlayers,
    kills: number(team?.kills) || killsFromPlayers,
    towers: objectiveCount(team, ['towers', 'towerKills', 'turretsDestroyed']),
    inhibitors: objectiveCount(team, ['inhibitors', 'inhibitorKills']),
    barons: objectiveCount(team, ['barons', 'baronKills']),
    heralds: objectiveCount(team, ['heralds', 'riftHeraldKills']),
    dragons: Array.isArray(dragons) ? dragons : objectiveCount(team, ['dragonKills', 'dragons']),
    players
  };
}

function summarize(blue, red) {
  const goldDiff = blue.gold - red.gold;
  const leader = goldDiff === 0 ? null : goldDiff > 0 ? blue : red;
  const towerDiff = blue.towers - red.towers;
  const killDiff = blue.kills - red.kills;
  if (!leader) return `Gold is even. The kill score is ${blue.kills}-${red.kills} and towers are ${blue.towers}-${red.towers}.`;
  return `${leader.name} leads by ${Math.abs(goldDiff).toLocaleString('en-US')} gold. Kill difference: ${Math.abs(killDiff)}; tower difference: ${Math.abs(towerDiff)}.`;
}

async function buildChatGptSnapshot(gameId) {
  const windowPayload = await riotLive(`window/${encodeURIComponent(gameId)}`);
  const frame = latestFrame(windowPayload);
  const gameMetadata = windowPayload?.gameMetadata || windowPayload?.metadata || frame?.gameMetadata || {};
  const blueMeta = gameMetadata?.blueTeamMetadata || gameMetadata?.teams?.[0] || {};
  const redMeta = gameMetadata?.redTeamMetadata || gameMetadata?.teams?.[1] || {};

  const blue = normalizeSide(frame, 'blue', {
    name: blueMeta?.name || blueMeta?.esportsTeamName,
    code: blueMeta?.code,
    image: blueMeta?.image
  });
  const red = normalizeSide(frame, 'red', {
    name: redMeta?.name || redMeta?.esportsTeamName,
    code: redMeta?.code,
    image: redMeta?.image
  });

  const gameTime = frame?.gameTime ?? frame?.rfc460Timestamp ?? frame?.timestamp ?? 0;
  return {
    schemaVersion: '1.0',
    updatedAt: new Date().toISOString(),
    source: {
      provider: 'Riot LoL Esports web feed',
      gameId: String(gameId),
      unofficialIntegration: true
    },
    match: {
      league: gameMetadata?.league || gameMetadata?.leagueName || null,
      gameNumber: number(gameMetadata?.gameNumber) || null,
      patch: gameMetadata?.patchVersion || null,
      state: 'in_game'
    },
    clock: durationClock(gameTime),
    blue,
    red,
    differences: {
      gold: blue.gold - red.gold,
      kills: blue.kills - red.kills,
      towers: blue.towers - red.towers,
      dragons: (Array.isArray(blue.dragons) ? blue.dragons.length : blue.dragons) - (Array.isArray(red.dragons) ? red.dragons.length : red.dragons),
      barons: blue.barons - red.barons
    },
    summary: summarize(blue, red)
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ ok: true, service: 'LoL Live Analyzer API', apiKeyConfigured: Boolean(env.LOL_ESPORTS_API_KEY) });
      }

      if (url.pathname === '/api/schedule') {
        const data = await riotPersisted('getSchedule', { leagueId: url.searchParams.get('leagueId') || undefined }, env);
        return json(data, 200, { 'Cache-Control': 'public, max-age=30' });
      }

      if (url.pathname === '/api/event' || url.pathname === '/api/match-details') {
        const id = required(url.searchParams.get('matchId') || url.searchParams.get('id'), 'match id');
        const data = await riotPersisted('getEventDetails', { id }, env);
        return json(data, 200, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === '/api/window') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        return json(await riotLive(`window/${encodeURIComponent(gameId)}`));
      }

      if (url.pathname === '/api/details') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        return json(await riotLive(`details/${encodeURIComponent(gameId)}`));
      }

      if (url.pathname === '/api/chatgpt') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        return json(await buildChatGptSnapshot(gameId));
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : 'Unknown error',
        path: url.pathname,
        updatedAt: new Date().toISOString()
      }, 502);
    }
  }
};