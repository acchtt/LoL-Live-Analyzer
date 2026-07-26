import workerV16 from './worker-v1.6.js';

const WORKER_VERSION = '1.7';
const MAX_REASONABLE_GAME_SECONDS = 6 * 60 * 60;
const CLOCK_ANCHOR_TTL_SECONDS = 6 * 60 * 60;

const CONFIRMED_SERIES = new Map([
  ['115548681803406191', {
    source: 'confirmed game results',
    confirmedThroughGame: 2,
    winsByTeamId: {
      '99322214695067838': 1,
      '103461966965149786': 1
    }
  }]
]);

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

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function framesOf(payload) {
  const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
  return Array.isArray(frames) ? frames : [];
}

function frameTimestamp(frame) {
  return parseTimestamp(frame?.rfc460Timestamp ?? frame?.timestamp);
}

function frameLooksLikeGameStart(frame) {
  if (!frame) return false;
  const state = String(frame?.gameState || '').toLowerCase().replace(/[^a-z]/g, '');
  const blue = frame?.blueTeam || {};
  const red = frame?.redTeam || {};
  const participants = [...(blue.participants || []), ...(red.participants || [])];
  const combinedGold = asNumber(blue.totalGold ?? blue.gold) + asNumber(red.totalGold ?? red.gold);
  return state === 'ingame' || participants.length >= 10 || combinedGold >= 5000;
}

function clockAnchorCacheKey(gameId) {
  return new Request(`https://clock-anchor.invalid/game/${encodeURIComponent(gameId)}`);
}

async function readClockAnchor(gameId) {
  try {
    const response = await caches.default.match(clockAnchorCacheKey(gameId));
    if (!response) return null;
    const payload = await response.json();
    const anchorMs = Number(payload?.anchorMs);
    return Number.isFinite(anchorMs) ? anchorMs : null;
  } catch {
    return null;
  }
}

async function writeClockAnchor(gameId, anchorMs) {
  try {
    await caches.default.put(clockAnchorCacheKey(gameId), new Response(JSON.stringify({
      gameId: String(gameId),
      anchorMs,
      savedAt: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CLOCK_ANCHOR_TTL_SECONDS}`
      }
    }));
  } catch {
    // Cache API may be unavailable in local preview.
  }
}

async function fetchInitialFrameAnchor(requestUrl, gameId, env, ctx) {
  const cached = await readClockAnchor(gameId);
  if (cached !== null) return cached;

  const url = new URL('/api/window', requestUrl.origin);
  url.searchParams.set('gameId', String(gameId));
  const response = await workerV16.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  }), env, ctx);
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  const frames = framesOf(payload)
    .map(frame => ({ frame, timestampMs: frameTimestamp(frame) }))
    .filter(item => item.timestampMs !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  if (!frames.length) return null;

  const anchor = frames.find(item => frameLooksLikeGameStart(item.frame)) || frames[0];
  await writeClockAnchor(gameId, anchor.timestampMs);
  return anchor.timestampMs;
}

function matchIdFromPayload(payload) {
  return String(
    payload?.source?.matchId
    || payload?.event?.match?.id
    || payload?.event?.id
    || payload?.match?.id
    || payload?.id
    || ''
  );
}

function applyConfirmedWinsToTeams(teams, matchId) {
  const confirmed = CONFIRMED_SERIES.get(String(matchId));
  if (!confirmed || !Array.isArray(teams)) return false;

  const currentTotal = teams.reduce((sum, team) => sum + asNumber(team?.wins ?? team?.result?.gameWins), 0);
  if (currentTotal > confirmed.confirmedThroughGame) return false;

  let changed = false;
  for (const team of teams) {
    const id = String(team?.id || team?.esportsTeamId || '');
    if (!Object.prototype.hasOwnProperty.call(confirmed.winsByTeamId, id)) continue;
    const wins = confirmed.winsByTeamId[id];
    if ('wins' in team || !team.result) team.wins = wins;
    if (team.result) team.result = { ...team.result, gameWins: wins };
    changed = true;
  }
  return changed;
}

function applyConfirmedSeries(payload) {
  const matchId = matchIdFromPayload(payload);
  const confirmed = CONFIRMED_SERIES.get(matchId);
  if (!confirmed) return payload;

  if (payload?.series?.teams) {
    applyConfirmedWinsToTeams(payload.series.teams, matchId);
    payload.series = {
      ...payload.series,
      source: confirmed.source,
      confirmedThroughGame: confirmed.confirmedThroughGame
    };
  }

  if (payload?.event?.match?.teams) {
    applyConfirmedWinsToTeams(payload.event.match.teams, matchId);
    payload.event.scoreSource = confirmed.source;
  }

  if (payload?.match?.teams) {
    applyConfirmedWinsToTeams(payload.match.teams, matchId);
    payload.scoreSource = confirmed.source;
  }

  return payload;
}

function applyConfirmedSchedule(payload) {
  const events = payload?.data?.schedule?.events || payload?.schedule?.events || [];
  for (const event of events) {
    const matchId = String(event?.match?.id || event?.id || '');
    const confirmed = CONFIRMED_SERIES.get(matchId);
    if (!confirmed) continue;
    applyConfirmedWinsToTeams(event?.match?.teams || [], matchId);
    event.scoreSource = confirmed.source;
  }
  return payload;
}

async function addFallbackClock(snapshot, requestUrl, gameId, env, ctx) {
  if (!snapshot || snapshot.status !== 'ok') return snapshot;
  const rawClockSeconds = snapshot.clockSeconds;
  const existing = rawClockSeconds === null || rawClockSeconds === undefined || rawClockSeconds === ''
    ? null
    : Number(rawClockSeconds);
  if (existing !== null && Number.isFinite(existing) && existing >= 0) return snapshot;

  const currentFrameMs = parseTimestamp(snapshot?.source?.frameTimestamp);
  if (currentFrameMs === null) return snapshot;

  const anchorMs = await fetchInitialFrameAnchor(requestUrl, gameId, env, ctx).catch(() => null);
  if (anchorMs === null || currentFrameMs < anchorMs) return snapshot;

  const seconds = Math.round((currentFrameMs - anchorMs) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_REASONABLE_GAME_SECONDS) return snapshot;

  return {
    ...snapshot,
    clockSeconds: seconds,
    clock: formatClock(seconds),
    source: {
      ...(snapshot.source || {}),
      clockSource: 'Riot initial telemetry frame',
      clockAnchorTime: new Date(anchorMs).toISOString(),
      clockRecovered: true
    }
  };
}

function jsonResponse(data, original, extraHeaders = {}) {
  const headers = new Headers(original.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Worker-Version', WORKER_VERSION);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(data, null, 2), {
    status: original.status,
    statusText: original.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await workerV16.fetch(request, env, ctx);

    if (url.pathname === '/' || url.pathname === '/health') {
      const payload = await response.clone().json().catch(() => null);
      return payload ? jsonResponse({ ...payload, version: WORKER_VERSION }, response) : response;
    }

    if (!response.ok) return response;

    if (url.pathname === '/api/chatgpt') {
      let snapshot = await response.clone().json().catch(() => null);
      if (!snapshot) return response;
      const gameId = url.searchParams.get('gameId');
      snapshot = applyConfirmedSeries(snapshot);
      if (gameId) snapshot = await addFallbackClock(snapshot, url, gameId, env, ctx);
      snapshot.schemaVersion = WORKER_VERSION;
      return jsonResponse(snapshot, response, {
        'X-Clock-Source': snapshot?.source?.clockSource || 'unavailable',
        'X-Series-Source': snapshot?.series?.source || 'riot'
      });
    }

    if (url.pathname === '/api/resolve-game') {
      const resolution = await response.clone().json().catch(() => null);
      if (!resolution) return response;
      applyConfirmedSeries(resolution);
      return jsonResponse(resolution, response, {
        'X-Series-Source': resolution?.series?.source || 'riot'
      });
    }

    if (url.pathname === '/api/schedule') {
      const schedule = await response.clone().json().catch(() => null);
      return schedule ? jsonResponse(applyConfirmedSchedule(schedule), response) : response;
    }

    if (url.pathname === '/api/event' || url.pathname === '/api/match-details') {
      const payload = await response.clone().json().catch(() => null);
      if (!payload) return response;
      const event = payload?.data?.event || payload?.event;
      if (event) {
        applyConfirmedWinsToTeams(event?.match?.teams || [], String(event?.match?.id || event?.id || ''));
      }
      return jsonResponse(payload, response);
    }

    return response;
  }
};
