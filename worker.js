const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const DEFAULT_LOCALE = 'en-US';
const LIVE_FRAME_MAX_AGE_MS = 30 * 60 * 1000;
const MATCH_CACHE_MS = 5 * 60 * 1000;

const gameCursors = new Map();
const matchCache = new Map();

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
  if (!key) throw new Error('LOL_ESPORTS_API_KEY is not configured in the Worker.');

  const url = new URL(`${PERSISTED_BASE}/${path}`);
  url.searchParams.set('hl', DEFAULT_LOCALE);

  for (const [name, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value
        .filter(item => item !== undefined && item !== null && item !== '')
        .forEach(item => url.searchParams.append(name, String(item)));
    } else if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-api-key': key
    },
    cache: 'no-store'
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Riot ${path} returned ${response.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

async function riotLive(path, params = {}) {
  const url = new URL(`${LIVE_BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`Riot live feed returned ${response.status}: ${text.slice(0, 180)}`);
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function frameList(payload) {
  const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
  return Array.isArray(frames) ? frames : [];
}

function latestFrame(payload) {
  const frames = frameList(payload);
  return frames.length ? frames[frames.length - 1] : payload?.frame || null;
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    const millis = value > 1e12 ? value : value * 1000;
    return Number.isFinite(millis) ? millis : null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function participantId(player, index) {
  return number(player?.participantId ?? player?.participantID ?? index + 1);
}

function teamPayload(frame, side) {
  if (side === 'blue' && frame?.blueTeam) return frame.blueTeam;
  if (side === 'red' && frame?.redTeam) return frame.redTeam;

  const id = side === 'blue' ? 100 : 200;
  const teams = frame?.teams || frame?.teamStats || [];
  return teams.find(team => String(team?.teamID ?? team?.teamId ?? team?.id) === String(id)) ||
    teams[side === 'blue' ? 0 : 1] ||
    {};
}

function telemetryInfo(payload) {
  const frame = latestFrame(payload);
  const timestampMs = parseTimestamp(frame?.rfc460Timestamp ?? frame?.timestamp);
  const ageMs = timestampMs === null ? null : Math.max(0, Date.now() - timestampMs);
  const blue = teamPayload(frame, 'blue');
  const red = teamPayload(frame, 'red');
  const participantCount = (blue?.participants?.length || 0) + (red?.participants?.length || 0);
  const meaningful = Boolean(
    frame &&
    (frame?.gameState === 'in_game' || participantCount > 0 || number(blue?.totalGold) > 0 || number(red?.totalGold) > 0)
  );

  return {
    hasFrame: Boolean(frame),
    meaningful,
    fresh: Boolean(meaningful && timestampMs !== null && ageMs <= LIVE_FRAME_MAX_AGE_MS),
    timestamp: timestampMs === null ? null : new Date(timestampMs).toISOString(),
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000)
  };
}

function rememberCursor(gameId, payload) {
  const frame = latestFrame(payload);
  const timestampMs = parseTimestamp(frame?.rfc460Timestamp ?? frame?.timestamp);
  if (timestampMs !== null) gameCursors.set(String(gameId), timestampMs);
}

function round10Seconds(valueMs) {
  return Math.floor(valueMs / 10000) * 10000;
}

async function fetchProgressingWindow(gameId) {
  const key = String(gameId);
  const cursor = gameCursors.get(key);

  if (cursor) {
    const startingTime = new Date(round10Seconds(cursor + 10000)).toISOString();
    const nextPayload = await riotLive(`window/${encodeURIComponent(key)}`, { startingTime });
    if (frameList(nextPayload).length) {
      rememberCursor(key, nextPayload);
      return nextPayload;
    }
  }

  const currentPayload = await riotLive(`window/${encodeURIComponent(key)}`);
  if (currentPayload) rememberCursor(key, currentPayload);
  return currentPayload;
}

async function getEventCached(matchId, env) {
  const key = String(matchId);
  const cached = matchCache.get(key);
  if (cached && Date.now() - cached.savedAt < MATCH_CACHE_MS) return cached.event;

  const payload = await riotPersisted('getEventDetails', { id: key }, env);
  const event = payload?.data?.event || payload?.event || payload?.data || payload;
  matchCache.set(key, { event, savedAt: Date.now() });
  return event;
}

function matchIdOf(event) {
  return String(event?.match?.id || event?.id || '');
}

function mergeScheduleWithLive(schedulePayload, livePayload) {
  const scheduleEvents = schedulePayload?.data?.schedule?.events || [];
  const liveEvents = livePayload?.data?.schedule?.events || [];
  const liveByMatch = new Map(liveEvents.map(event => [matchIdOf(event), event]));

  for (const event of scheduleEvents) {
    const live = liveByMatch.get(matchIdOf(event));
    if (!live || event.state === 'completed') continue;
    event.state = 'inProgress';
    event.liveSource = 'getLive';
    if (live.match) event.match = { ...event.match, ...live.match };
  }

  return schedulePayload;
}

function metadataMap(teamMetadata = {}) {
  return new Map(
    (teamMetadata.participantMetadata || []).map(player => [number(player.participantId), player])
  );
}

function detailMap(detailsFrame) {
  return new Map(
    (detailsFrame?.participants || []).map((player, index) => [participantId(player, index), player])
  );
}

function normalizePlayer(raw, index, metaById, detailById) {
  const id = participantId(raw, index);
  const meta = metaById.get(id) || {};
  const detail = detailById.get(id) || {};
  const combined = { ...raw, ...detail };

  return {
    participantId: id,
    name: meta.summonerName || combined.summonerName || combined.name || `Player ${id}`,
    champion: meta.championId || combined.championId || combined.championName || null,
    role: meta.role || combined.role || null,
    level: number(combined.level),
    kills: number(combined.kills),
    deaths: number(combined.deaths),
    assists: number(combined.assists),
    creepScore: number(combined.creepScore ?? combined.cs ?? combined.minionsKilled),
    totalGold: number(combined.totalGold ?? combined.totalGoldEarned ?? combined.gold),
    currentGold: number(combined.currentGold),
    items: Array.isArray(combined.items) ? combined.items : []
  };
}

function normalizeSide(frame, side, teamMetadata, detailById, teamInfo = {}) {
  const team = teamPayload(frame, side);
  const metaById = metadataMap(teamMetadata);
  const players = (team?.participants || []).map((player, index) =>
    normalizePlayer(player, index, metaById, detailById)
  );
  const dragons = Array.isArray(team?.dragons) ? team.dragons : [];

  return {
    id: side === 'blue' ? 100 : 200,
    side,
    esportsTeamId: teamMetadata?.esportsTeamId || teamInfo.id || null,
    name: teamInfo.name || (side === 'blue' ? 'Blue side' : 'Red side'),
    code: teamInfo.code || null,
    image: teamInfo.image || null,
    gold: number(team?.totalGold ?? team?.gold) || players.reduce((sum, player) => sum + player.totalGold, 0),
    kills: number(team?.totalKills ?? team?.kills) || players.reduce((sum, player) => sum + player.kills, 0),
    towers: number(team?.towers ?? team?.towerKills ?? team?.turretsDestroyed),
    inhibitors: number(team?.inhibitors ?? team?.inhibitorKills),
    barons: number(team?.barons ?? team?.baronKills),
    heralds: number(team?.heralds ?? team?.riftHeraldKills),
    dragons,
    players
  };
}

function summarize(blue, red) {
  const goldDiff = blue.gold - red.gold;
  const leader = goldDiff === 0 ? null : goldDiff > 0 ? blue : red;
  if (!leader) return `Gold is even. The kill score is ${blue.kills}-${red.kills} and towers are ${blue.towers}-${red.towers}.`;
  return `${leader.name} leads by ${Math.abs(goldDiff).toLocaleString('en-US')} gold. Kills: ${blue.kills}-${red.kills}; towers: ${blue.towers}-${red.towers}.`;
}

function teamContext(event, gameId, side) {
  const match = event?.match || {};
  const game = (match.games || []).find(item => String(item.id) === String(gameId));
  const sideEntry = game?.teams?.find(team => team.side === side);
  return (match.teams || []).find(team => String(team.id) === String(sideEntry?.id)) || {};
}

function durationClock(value) {
  const total = Math.max(0, Math.floor(number(value) / (number(value) > 10000 ? 1000 : 1)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function buildChatGptSnapshot(gameId, env, historical = false) {
  const windowPayload = historical
    ? await riotLive(`window/${encodeURIComponent(gameId)}`)
    : await fetchProgressingWindow(gameId);
  const frame = latestFrame(windowPayload);
  const telemetry = telemetryInfo(windowPayload);

  if (!frame || !telemetry.meaningful) {
    return {
      schemaVersion: '1.2',
      status: 'telemetry_unavailable',
      updatedAt: new Date().toISOString(),
      source: {
        provider: 'Riot LoL Esports web feed',
        gameId: String(gameId),
        live: false
      },
      message: 'Riot is not publishing live-stat telemetry for this game or league.'
    };
  }

  const frameTimestamp = frame.rfc460Timestamp || frame.timestamp || telemetry.timestamp;
  let detailsFrame = null;
  try {
    const detailsPayload = await riotLive(`details/${encodeURIComponent(gameId)}`, {
      startingTime: frameTimestamp,
      participantIds: '1_2_3_4_5_6_7_8_9_10'
    });
    detailsFrame = latestFrame(detailsPayload);
  } catch {
    detailsFrame = null;
  }

  const gameMetadata = windowPayload?.gameMetadata || {};
  const blueMetadata = gameMetadata.blueTeamMetadata || {};
  const redMetadata = gameMetadata.redTeamMetadata || {};
  let event = null;
  const matchId = windowPayload?.esportsMatchId;
  if (matchId) {
    try {
      event = await getEventCached(matchId, env);
    } catch {
      event = null;
    }
  }

  const detailsById = detailMap(detailsFrame);
  const blue = normalizeSide(frame, 'blue', blueMetadata, detailsById, teamContext(event, gameId, 'blue'));
  const red = normalizeSide(frame, 'red', redMetadata, detailsById, teamContext(event, gameId, 'red'));
  const game = event?.match?.games?.find(item => String(item.id) === String(gameId));

  return {
    schemaVersion: '1.2',
    status: 'ok',
    updatedAt: new Date().toISOString(),
    source: {
      provider: 'Riot LoL Esports web feed',
      gameId: String(gameId),
      matchId: matchId ? String(matchId) : null,
      unofficialIntegration: true,
      live: telemetry.fresh,
      frameTimestamp: telemetry.timestamp,
      dataAgeSeconds: telemetry.ageSeconds
    },
    match: {
      league: event?.league?.name || null,
      bestOf: number(event?.match?.strategy?.count) || null,
      gameNumber: number(game?.number) || null,
      patch: gameMetadata.patchVersion || null,
      state: telemetry.fresh && !historical ? 'in_game' : 'historical_snapshot'
    },
    clock: frame?.gameTime !== undefined ? durationClock(frame.gameTime) : null,
    blue,
    red,
    differences: {
      gold: blue.gold - red.gold,
      kills: blue.kills - red.kills,
      towers: blue.towers - red.towers,
      dragons: blue.dragons.length - red.dragons.length,
      barons: blue.barons - red.barons
    },
    summary: summarize(blue, red)
  };
}

async function resolveActiveGame(matchId, env) {
  const event = await getEventCached(matchId, env);
  let games = Array.isArray(event?.match?.games) ? event.match.games.map(game => ({ ...game })) : [];
  let selectedGame = games.find(game => game.state === 'inProgress') || null;
  let resolutionSource = selectedGame ? 'eventDetails' : null;
  const diagnostics = {};

  let broadcastLive = false;
  try {
    const livePayload = await riotPersisted('getLive', {}, env);
    const liveEvents = livePayload?.data?.schedule?.events || [];
    broadcastLive = liveEvents.some(item => matchIdOf(item) === String(matchId));
  } catch (error) {
    diagnostics.getLive = error instanceof Error ? error.message : 'Unknown getLive error';
  }

  if (!selectedGame && games.length) {
    try {
      const ids = games.map(game => game.id).filter(Boolean);
      const gamePayload = await riotPersisted('getGames', { id: ids }, env);
      const refreshedGames = Array.isArray(gamePayload?.data?.games) ? gamePayload.data.games : [];
      const byId = new Map(refreshedGames.map(game => [String(game.id), game]));
      games = games.map(game => ({ ...game, ...(byId.get(String(game.id)) || {}) }));
      selectedGame = games.find(game => game.state === 'inProgress') || null;
      if (selectedGame) resolutionSource = 'getGames';
    } catch (error) {
      diagnostics.getGames = error instanceof Error ? error.message : 'Unknown getGames error';
    }
  }

  if (!selectedGame && games.length) {
    diagnostics.liveWindowProbe = {};
    let freshest = null;

    for (const candidate of [...games].reverse()) {
      if (!candidate?.id) continue;
      try {
        const probe = await riotLive(`window/${encodeURIComponent(candidate.id)}`);
        const info = telemetryInfo(probe);
        diagnostics.liveWindowProbe[String(candidate.id)] = info;
        if (info.fresh && (!freshest || Date.parse(info.timestamp) > Date.parse(freshest.info.timestamp))) {
          freshest = { candidate, info };
        }
      } catch (error) {
        diagnostics.liveWindowProbe[String(candidate.id)] = {
          error: error instanceof Error ? error.message : 'Unknown live-window error'
        };
      }
    }

    if (freshest) {
      selectedGame = {
        ...freshest.candidate,
        state: 'inProgress',
        telemetryTimestamp: freshest.info.timestamp,
        telemetryAgeSeconds: freshest.info.ageSeconds
      };
      resolutionSource = 'liveWindowProbe';
    }
  }

  return {
    event,
    games,
    selectedGame,
    broadcastLive,
    telemetryAvailable: Boolean(selectedGame),
    resolutionSource: resolutionSource || (broadcastLive ? 'getLive' : null),
    checkedAt: new Date().toISOString(),
    diagnostics
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({
          ok: true,
          service: 'LoL Live Analyzer API',
          apiKeyConfigured: Boolean(env.LOL_ESPORTS_API_KEY),
          version: '1.2'
        });
      }

      if (url.pathname === '/api/schedule') {
        const [schedule, live] = await Promise.all([
          riotPersisted('getSchedule', { leagueId: url.searchParams.get('leagueId') || undefined }, env),
          riotPersisted('getLive', {}, env).catch(() => null)
        ]);
        return json(mergeScheduleWithLive(schedule, live), 200, { 'Cache-Control': 'public, max-age=15' });
      }

      if (url.pathname === '/api/live') {
        return json(await riotPersisted('getLive', {}, env), 200, { 'Cache-Control': 'public, max-age=10' });
      }

      if (url.pathname === '/api/event' || url.pathname === '/api/match-details') {
        const id = required(url.searchParams.get('matchId') || url.searchParams.get('id'), 'match id');
        return json(await riotPersisted('getEventDetails', { id }, env));
      }

      if (url.pathname === '/api/resolve-game') {
        const matchId = required(url.searchParams.get('matchId'), 'match id');
        return json(await resolveActiveGame(matchId, env));
      }

      if (url.pathname === '/api/window') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        return json(await riotLive(`window/${encodeURIComponent(gameId)}`, {
          startingTime: url.searchParams.get('startingTime') || undefined
        }));
      }

      if (url.pathname === '/api/details') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        return json(await riotLive(`details/${encodeURIComponent(gameId)}`, {
          startingTime: url.searchParams.get('startingTime') || undefined,
          participantIds: url.searchParams.get('participantIds') || undefined
        }));
      }

      if (url.pathname === '/api/chatgpt') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        const historical = url.searchParams.get('historical') === '1';
        return json(await buildChatGptSnapshot(gameId, env, historical));
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