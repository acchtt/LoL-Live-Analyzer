const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const DEFAULT_LOCALE = 'en-US';
const MAX_FRAME_AGE_MS = 45 * 60 * 1000;
const STARTING_TOTAL_GOLD = 5000;
const PROBE_OFFSETS_SECONDS = [20, 40, 60, 90, 120, 150, 180, 210, 240, 300, 360, 480, 600, 900];

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

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundedIso(timestampMs) {
  return new Date(Math.floor(timestampMs / 10000) * 10000).toISOString();
}

async function riotPersisted(path, params, env) {
  const key = env.LOL_ESPORTS_API_KEY;
  if (!key) throw new Error('LOL_ESPORTS_API_KEY is not configured in the Worker.');

  const url = new URL(`${PERSISTED_BASE}/${path}`);
  url.searchParams.set('hl', DEFAULT_LOCALE);
  for (const [name, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach(item => url.searchParams.append(name, String(item)));
    } else if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'x-api-key': key },
    cache: 'no-store'
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Riot ${path} returned ${response.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

async function riotFeed(path, params = {}) {
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
  return text.trim() ? JSON.parse(text) : null;
}

function framesOf(payload) {
  const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
  return Array.isArray(frames) ? frames : [];
}

function latestFrame(payload) {
  const frames = framesOf(payload);
  return frames.length ? frames[frames.length - 1] : payload?.frame || null;
}

function teamFrame(frame, side) {
  if (side === 'blue' && frame?.blueTeam) return frame.blueTeam;
  if (side === 'red' && frame?.redTeam) return frame.redTeam;
  const id = side === 'blue' ? 100 : 200;
  const teams = frame?.teams || frame?.teamStats || [];
  return teams.find(team => String(team?.teamID ?? team?.teamId ?? team?.id) === String(id)) ||
    teams[side === 'blue' ? 0 : 1] || {};
}

function frameTimestamp(frame) {
  return parseTimestamp(frame?.rfc460Timestamp ?? frame?.timestamp);
}

function frameFresh(frame) {
  const timestamp = frameTimestamp(frame);
  return timestamp !== null && Date.now() - timestamp <= MAX_FRAME_AGE_MS;
}

function gameplayProgress(frame) {
  if (!frame) return false;
  const blue = teamFrame(frame, 'blue');
  const red = teamFrame(frame, 'red');
  const players = [...(blue.participants || []), ...(red.participants || [])];
  const totalCs = players.reduce((sum, player) => sum + asNumber(player.creepScore ?? player.cs), 0);
  const combinedGold = asNumber(blue.totalGold ?? blue.gold) + asNumber(red.totalGold ?? red.gold);
  const highestLevel = players.reduce((max, player) => Math.max(max, asNumber(player.level)), 0);
  const kills = asNumber(blue.totalKills ?? blue.kills) + asNumber(red.totalKills ?? red.kills);
  const objectives = asNumber(blue.towers) + asNumber(red.towers) +
    asNumber(blue.barons) + asNumber(red.barons) +
    (Array.isArray(blue.dragons) ? blue.dragons.length : asNumber(blue.dragons)) +
    (Array.isArray(red.dragons) ? red.dragons.length : asNumber(red.dragons));
  return totalCs > 0 || combinedGold > STARTING_TOTAL_GOLD || highestLevel > 1 || kills > 0 || objectives > 0;
}

function pregameFrame(frame) {
  if (!frame) return false;
  const blue = teamFrame(frame, 'blue');
  const red = teamFrame(frame, 'red');
  const players = [...(blue.participants || []), ...(red.participants || [])];
  return players.length >= 10 && !gameplayProgress(frame);
}

function payloadCandidate(payload, allowStale = false) {
  const frame = latestFrame(payload);
  if (!frame || (!allowStale && !frameFresh(frame))) return null;
  return {
    payload,
    frame,
    timestampMs: frameTimestamp(frame),
    phase: gameplayProgress(frame) ? 'gameplay' : pregameFrame(frame) ? 'pregame' : 'unknown'
  };
}

async function fetchBestWindow(gameId, after, allowStale = false) {
  const requests = [riotFeed(`window/${encodeURIComponent(gameId)}`)];
  const times = [];
  const afterMs = parseTimestamp(after);
  if (!allowStale && afterMs !== null) {
    for (let step = 1; step <= 9; step += 1) times.push(afterMs + step * 10000);
  }
  if (!allowStale) {
    for (const offset of PROBE_OFFSETS_SECONDS) times.push(Date.now() - offset * 1000);
  }
  const uniqueTimes = [...new Set(times.map(roundedIso))];
  for (const startingTime of uniqueTimes) {
    requests.push(riotFeed(`window/${encodeURIComponent(gameId)}`, { startingTime }));
  }

  const settled = await Promise.allSettled(requests);
  const candidates = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const candidate = payloadCandidate(result.value, allowStale);
    if (candidate) candidates.push(candidate);
  }

  const gameplay = candidates
    .filter(candidate => candidate.phase === 'gameplay')
    .sort((a, b) => b.timestampMs - a.timestampMs)[0];
  if (gameplay) return gameplay;

  const pregame = candidates
    .filter(candidate => candidate.phase === 'pregame')
    .sort((a, b) => b.timestampMs - a.timestampMs)[0];
  return pregame || null;
}

function eventFromPayload(payload) {
  return payload?.data?.event || payload?.event || payload?.data || payload;
}

function matchIdOf(event) {
  return String(event?.match?.id || event?.id || '');
}

async function getEvent(matchId, env) {
  return eventFromPayload(await riotPersisted('getEventDetails', { id: matchId }, env));
}

function seriesTeams(event) {
  return (event?.match?.teams || []).map(team => ({
    id: String(team?.id || ''),
    name: team?.name || null,
    code: team?.code || null,
    image: team?.image || null,
    wins: asNumber(team?.result?.gameWins)
  }));
}

function mergeGameState(eventGames, refreshedGames) {
  const byId = new Map((refreshedGames || []).map(game => [String(game.id), game]));
  return (eventGames || []).map(game => ({ ...game, ...(byId.get(String(game.id)) || {}) }));
}

function metadataMap(teamMetadata = {}) {
  return new Map((teamMetadata.participantMetadata || []).map(player => [asNumber(player.participantId), player]));
}

function detailsMap(frame) {
  return new Map((frame?.participants || []).map((player, index) => [
    asNumber(player.participantId ?? player.participantID ?? index + 1),
    player
  ]));
}

function teamInfoFromMetadata(event, teamMetadata, gameId, side) {
  const teams = event?.match?.teams || [];
  const metadataTeamId = String(teamMetadata?.esportsTeamId || '');
  const byMetadata = teams.find(team => String(team?.id || '') === metadataTeamId);
  if (byMetadata) return byMetadata;

  const game = (event?.match?.games || []).find(item => String(item.id) === String(gameId));
  const sideTeamId = String(game?.teams?.find(team => team.side === side)?.id || '');
  return teams.find(team => String(team?.id || '') === sideTeamId) || {};
}

function normalizePlayer(raw, index, metadataById, detailedById) {
  const id = asNumber(raw?.participantId ?? raw?.participantID ?? index + 1);
  const metadata = metadataById.get(id) || {};
  const detail = detailedById.get(id) || {};
  const combined = { ...raw, ...detail };
  return {
    participantId: id,
    name: metadata.summonerName || combined.summonerName || combined.name || `Player ${id}`,
    champion: metadata.championId || combined.championId || combined.championName || null,
    role: metadata.role || combined.role || null,
    level: asNumber(combined.level),
    kills: asNumber(combined.kills),
    deaths: asNumber(combined.deaths),
    assists: asNumber(combined.assists),
    creepScore: asNumber(combined.creepScore ?? combined.cs ?? combined.minionsKilled),
    totalGold: asNumber(combined.totalGold ?? combined.totalGoldEarned ?? combined.gold),
    currentGold: asNumber(combined.currentGold),
    items: Array.isArray(combined.items) ? combined.items : []
  };
}

function normalizeSide(frame, side, teamMetadata, detailedById, teamInfo) {
  const rawTeam = teamFrame(frame, side);
  const metadataById = metadataMap(teamMetadata);
  const players = (rawTeam?.participants || []).map((player, index) =>
    normalizePlayer(player, index, metadataById, detailedById)
  );
  return {
    id: String(teamInfo?.id || teamMetadata?.esportsTeamId || ''),
    side,
    name: teamInfo?.name || (side === 'blue' ? 'Blue side' : 'Red side'),
    code: teamInfo?.code || null,
    image: teamInfo?.image || null,
    gold: asNumber(rawTeam?.totalGold ?? rawTeam?.gold),
    kills: asNumber(rawTeam?.totalKills ?? rawTeam?.kills),
    towers: asNumber(rawTeam?.towers ?? rawTeam?.towerKills ?? rawTeam?.turretsDestroyed),
    inhibitors: asNumber(rawTeam?.inhibitors ?? rawTeam?.inhibitorKills),
    barons: asNumber(rawTeam?.barons ?? rawTeam?.baronKills),
    heralds: asNumber(rawTeam?.heralds ?? rawTeam?.riftHeraldKills),
    dragons: Array.isArray(rawTeam?.dragons) ? rawTeam.dragons : [],
    players
  };
}

function lineupSide(side, teamMetadata, teamInfo) {
  return {
    id: String(teamInfo?.id || teamMetadata?.esportsTeamId || ''),
    side,
    name: teamInfo?.name || (side === 'blue' ? 'Blue side' : 'Red side'),
    code: teamInfo?.code || null,
    image: teamInfo?.image || null,
    gold: null,
    kills: null,
    towers: null,
    inhibitors: null,
    barons: null,
    heralds: null,
    dragons: [],
    players: (teamMetadata?.participantMetadata || []).map(player => ({
      participantId: asNumber(player.participantId),
      name: player.summonerName || null,
      champion: player.championId || null,
      role: player.role || null,
      level: null,
      kills: null,
      deaths: null,
      assists: null,
      creepScore: null,
      totalGold: null,
      currentGold: null,
      items: []
    }))
  };
}

function gameStartFromVod(event, gameId) {
  const game = (event?.match?.games || []).find(item => String(item.id) === String(gameId));
  for (const vod of game?.vods || []) {
    const firstFrame = parseTimestamp(vod?.firstFrameTime);
    const hasOffset = vod?.startMillis !== null && vod?.startMillis !== undefined && vod?.startMillis !== '';
    if (firstFrame !== null && hasOffset && Number.isFinite(Number(vod.startMillis))) {
      return firstFrame + Number(vod.startMillis);
    }
  }
  return null;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function summarize(blue, red) {
  const goldDiff = blue.gold - red.gold;
  if (goldDiff === 0) return `Gold is even. Kills are ${blue.kills}-${red.kills}; towers are ${blue.towers}-${red.towers}.`;
  const leader = goldDiff > 0 ? blue : red;
  return `${leader.name} leads by ${Math.abs(goldDiff).toLocaleString('en-US')} gold. Kills are ${blue.kills}-${red.kills}; towers are ${blue.towers}-${red.towers}.`;
}

async function buildSnapshot(gameId, env, after, historical = false) {
  const best = await fetchBestWindow(gameId, after, historical);
  if (!best) {
    return {
      schemaVersion: '1.3',
      status: 'telemetry_unavailable',
      updatedAt: new Date().toISOString(),
      source: { provider: 'Riot LoL Esports web feed', gameId: String(gameId), live: false },
      message: 'No fresh Riot telemetry frame is available.'
    };
  }

  const payload = best.payload;
  const frame = best.frame;
  const metadata = payload?.gameMetadata || {};
  const matchId = String(payload?.esportsMatchId || '');
  let event = null;
  if (matchId) {
    try { event = await getEvent(matchId, env); } catch { event = null; }
  }

  const blueMetadata = metadata?.blueTeamMetadata || {};
  const redMetadata = metadata?.redTeamMetadata || {};
  const blueTeamInfo = teamInfoFromMetadata(event, blueMetadata, gameId, 'blue');
  const redTeamInfo = teamInfoFromMetadata(event, redMetadata, gameId, 'red');
  const game = (event?.match?.games || []).find(item => String(item.id) === String(gameId));
  const series = { teams: seriesTeams(event) };
  const timestampIso = new Date(best.timestampMs).toISOString();

  if (best.phase !== 'gameplay') {
    return {
      schemaVersion: '1.3',
      status: 'pregame',
      updatedAt: new Date().toISOString(),
      source: {
        provider: 'Riot LoL Esports web feed',
        gameId: String(gameId),
        matchId: matchId || null,
        live: true,
        frameTimestamp: timestampIso
      },
      match: {
        league: event?.league?.name || null,
        bestOf: asNumber(event?.match?.strategy?.count) || null,
        gameNumber: asNumber(game?.number) || null,
        patch: metadata?.patchVersion || null,
        state: 'pregame'
      },
      series,
      clock: null,
      clockSeconds: null,
      blue: lineupSide('blue', blueMetadata, blueTeamInfo),
      red: lineupSide('red', redMetadata, redTeamInfo),
      message: 'Champion selections are available, but Riot has not published a progressing gameplay frame yet.'
    };
  }

  let detailedFrame = null;
  try {
    const detailsPayload = await riotFeed(`details/${encodeURIComponent(gameId)}`, {
      startingTime: timestampIso,
      participantIds: '1_2_3_4_5_6_7_8_9_10'
    });
    detailedFrame = latestFrame(detailsPayload);
  } catch {
    detailedFrame = null;
  }

  const detailedById = detailsMap(detailedFrame);
  const blue = normalizeSide(frame, 'blue', blueMetadata, detailedById, blueTeamInfo);
  const red = normalizeSide(frame, 'red', redMetadata, detailedById, redTeamInfo);
  const startMs = gameStartFromVod(event, gameId);
  const clockSeconds = startMs !== null && best.timestampMs >= startMs
    ? Math.round((best.timestampMs - startMs) / 1000)
    : null;

  return {
    schemaVersion: '1.3',
    status: 'ok',
    updatedAt: new Date().toISOString(),
    source: {
      provider: 'Riot LoL Esports web feed',
      gameId: String(gameId),
      matchId: matchId || null,
      live: !historical,
      frameTimestamp: timestampIso,
      dataAgeSeconds: Math.max(0, Math.round((Date.now() - best.timestampMs) / 1000))
    },
    match: {
      league: event?.league?.name || null,
      bestOf: asNumber(event?.match?.strategy?.count) || null,
      gameNumber: asNumber(game?.number) || null,
      patch: metadata?.patchVersion || null,
      state: historical ? 'historical_snapshot' : 'in_game'
    },
    series,
    clock: formatClock(clockSeconds),
    clockSeconds,
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
  const event = await getEvent(matchId, env);
  const eventGames = Array.isArray(event?.match?.games) ? event.match.games : [];
  let games = eventGames.map(game => ({ ...game }));
  const diagnostics = {};

  try {
    const ids = games.map(game => game.id).filter(Boolean);
    const refreshed = await riotPersisted('getGames', { id: ids }, env);
    games = mergeGameState(games, refreshed?.data?.games || []);
  } catch (error) {
    diagnostics.getGames = error instanceof Error ? error.message : 'getGames failed';
  }

  let broadcastLive = false;
  try {
    const livePayload = await riotPersisted('getLive', {}, env);
    broadcastLive = (livePayload?.data?.schedule?.events || [])
      .some(item => matchIdOf(item) === String(matchId));
  } catch (error) {
    diagnostics.getLive = error instanceof Error ? error.message : 'getLive failed';
  }

  let selectedGame = games.find(game => game.state === 'inProgress') || null;
  let selectedPhase = selectedGame ? 'state_reported_live' : null;

  if (!selectedGame) {
    let freshest = null;
    for (const game of [...games].sort((a, b) => asNumber(b.number) - asNumber(a.number))) {
      if (!game?.id) continue;
      try {
        const candidate = payloadCandidate(await riotFeed(`window/${encodeURIComponent(game.id)}`));
        if (candidate && (!freshest || candidate.timestampMs > freshest.candidate.timestampMs)) {
          freshest = { game, candidate };
        }
      } catch (error) {
        diagnostics[String(game.id)] = error instanceof Error ? error.message : 'window failed';
      }
    }
    if (freshest) {
      selectedGame = { ...freshest.game, state: 'inProgress' };
      selectedPhase = freshest.candidate.phase;
    }
  }

  return {
    event,
    games,
    selectedGame,
    selectedPhase,
    series: { teams: seriesTeams(event) },
    broadcastLive,
    telemetryAvailable: Boolean(selectedGame),
    checkedAt: new Date().toISOString(),
    diagnostics
  };
}

async function scheduleWithFreshLiveScores(env, leagueId) {
  const [schedulePayload, livePayload] = await Promise.all([
    riotPersisted('getSchedule', { leagueId: leagueId || undefined }, env),
    riotPersisted('getLive', {}, env).catch(() => null)
  ]);
  const events = schedulePayload?.data?.schedule?.events || [];
  const liveEvents = livePayload?.data?.schedule?.events || [];
  const liveByMatch = new Map(liveEvents.map(event => [matchIdOf(event), event]));

  const liveMatches = [];
  for (const event of events) {
    const live = liveByMatch.get(matchIdOf(event));
    if (!live || event.state === 'completed') continue;
    event.state = 'inProgress';
    event.liveSource = 'getLive';
    if (live.match) event.match = { ...event.match, ...live.match };
    liveMatches.push(event);
  }

  await Promise.all(liveMatches.slice(0, 10).map(async event => {
    try {
      const fresh = await getEvent(matchIdOf(event), env);
      if (fresh?.match) event.match = { ...event.match, ...fresh.match };
      if (fresh?.league) event.league = fresh.league;
    } catch {
      // Keep schedule/getLive data when event details lag or fail.
    }
  }));

  return schedulePayload;
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
          version: '1.3'
        });
      }

      if (url.pathname === '/api/schedule') {
        return json(
          await scheduleWithFreshLiveScores(env, url.searchParams.get('leagueId')),
          200,
          { 'Cache-Control': 'public, max-age=10' }
        );
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
        return json(await riotFeed(`window/${encodeURIComponent(gameId)}`, {
          startingTime: url.searchParams.get('startingTime') || undefined
        }));
      }

      if (url.pathname === '/api/details') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        return json(await riotFeed(`details/${encodeURIComponent(gameId)}`, {
          startingTime: url.searchParams.get('startingTime') || undefined,
          participantIds: url.searchParams.get('participantIds') || undefined
        }));
      }

      if (url.pathname === '/api/chatgpt') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        return json(await buildSnapshot(
          gameId,
          env,
          url.searchParams.get('after'),
          url.searchParams.get('historical') === '1'
        ));
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