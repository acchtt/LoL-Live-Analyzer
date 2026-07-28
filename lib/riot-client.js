import {
  FUTURE_TOLERANCE_SECONDS,
  classifyTimestamp,
  finiteOrNull,
  parseTimestamp
} from './reliability-policy.js';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const DEFAULT_LOCALE = 'en-US';
const STARTING_TOTAL_GOLD = 5000;
const EVENT_CACHE_MS = 15_000;
const LIVE_CATALOG_CACHE_MS = 2_000;
const GAME_CATALOG_CACHE_MS = 3_000;
const SCHEDULE_CACHE_MS = 8_000;
const MAX_DETAILS_PROBES = 3;

const inFlight = new Map();
const memoryCache = new Map();

function roundedIso(timestampMs) {
  return new Date(Math.floor(timestampMs / 10_000) * 10_000).toISOString();
}

export function detailProbeTimes(value) {
  const timestampMs = parseTimestamp(value);
  if (timestampMs === null) return [];

  const exact = new Date(timestampMs).toISOString();
  const rounded = roundedIso(timestampMs);
  const nearby = [exact, rounded, roundedIso(timestampMs - 10_000), roundedIso(timestampMs + 10_000)];
  return [...new Set(nearby)].slice(0, MAX_DETAILS_PROBES);
}

function coalesce(key, loader) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(loader).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function cached(key, ttlMs, loader) {
  const hit = memoryCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  return coalesce(`cache:${key}`, async () => {
    const secondHit = memoryCache.get(key);
    if (secondHit && secondHit.expiresAt > Date.now()) return secondHit.value;
    const value = await loader();
    memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });
}

async function riotPersisted(path, params, env) {
  const key = env.LOL_ESPORTS_API_KEY;
  if (!key) throw new Error('LOL_ESPORTS_API_KEY is not configured in the Worker.');
  const url = new URL(`${PERSISTED_BASE}/${path}`);
  url.searchParams.set('hl', DEFAULT_LOCALE);
  for (const [name, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value.filter(item => item !== undefined && item !== null && item !== '')
        .forEach(item => url.searchParams.append(name, String(item)));
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
  return text.trim() ? JSON.parse(text) : null;
}

async function riotFeed(path, params = {}, { tolerateMiss = false } = {}) {
  const url = new URL(`${LIVE_BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const text = await response.text();
  if (response.status === 204) return null;
  if (!response.ok) {
    const cacheMiss = response.status === 404 && /cache\s*miss/i.test(text);
    if (tolerateMiss && cacheMiss) return null;
    throw new Error(`Riot live feed returned ${response.status}: ${text.slice(0, 180)}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

export function framesOf(payload) {
  const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
  return Array.isArray(frames) ? frames : [];
}

export function latestFrame(payload) {
  const frames = framesOf(payload);
  return frames.length ? frames[frames.length - 1] : payload?.frame || null;
}

export function teamFrame(frame, side) {
  if (side === 'blue' && frame?.blueTeam) return frame.blueTeam;
  if (side === 'red' && frame?.redTeam) return frame.redTeam;
  const numericId = side === 'blue' ? 100 : 200;
  const teams = frame?.teams || frame?.teamStats || [];
  return teams.find(team => String(team?.teamID ?? team?.teamId ?? team?.id) === String(numericId))
    || teams[side === 'blue' ? 0 : 1]
    || {};
}

function gameplayProgress(frame) {
  if (!frame) return false;
  const blue = teamFrame(frame, 'blue');
  const red = teamFrame(frame, 'red');
  const players = [...(blue.participants || []), ...(red.participants || [])];
  const totalCs = players.reduce((sum, player) => sum + (finiteOrNull(player?.creepScore ?? player?.cs) || 0), 0);
  const combinedGold = (finiteOrNull(blue?.totalGold ?? blue?.gold) || 0) + (finiteOrNull(red?.totalGold ?? red?.gold) || 0);
  const highestLevel = players.reduce((max, player) => Math.max(max, finiteOrNull(player?.level) || 0), 0);
  const kills = (finiteOrNull(blue?.totalKills ?? blue?.kills) || 0) + (finiteOrNull(red?.totalKills ?? red?.kills) || 0);
  const objectiveCount = team => {
    const dragons = Array.isArray(team?.dragons) ? team.dragons.length : (finiteOrNull(team?.dragons) || 0);
    return (finiteOrNull(team?.towers ?? team?.towerKills) || 0)
      + (finiteOrNull(team?.barons ?? team?.baronKills) || 0)
      + dragons;
  };
  return totalCs > 0 || combinedGold > STARTING_TOTAL_GOLD || highestLevel > 1 || kills > 0
    || objectiveCount(blue) + objectiveCount(red) > 0;
}

function pregameFrame(frame) {
  if (!frame) return false;
  const blue = teamFrame(frame, 'blue');
  const red = teamFrame(frame, 'red');
  const playerCount = (blue?.participants?.length || 0) + (red?.participants?.length || 0);
  return playerCount >= 10 && !gameplayProgress(frame);
}

export function candidateFromPayload(payload, nowMs = Date.now()) {
  const frame = latestFrame(payload);
  const timestampMs = parseTimestamp(frame?.rfc460Timestamp ?? frame?.timestamp);
  const timestampQuality = classifyTimestamp(timestampMs, nowMs);
  if (!frame || !timestampQuality.timestampValid) return null;
  return {
    payload,
    frame,
    timestampMs,
    timestampQuality,
    phase: gameplayProgress(frame) ? 'gameplay' : pregameFrame(frame) ? 'pregame' : 'unknown'
  };
}

function newestCandidate(candidates, phase) {
  return candidates.filter(candidate => candidate.phase === phase)
    .sort((left, right) => right.timestampMs - left.timestampMs)[0] || null;
}

function detailedFrame(payload) {
  const frame = latestFrame(payload);
  return Boolean(frame && Array.isArray(frame?.participants) && frame.participants.length > 0);
}

export function createRiotClient(env) {
  async function getEvent(matchId) {
    return cached(`event:${matchId}`, EVENT_CACHE_MS, async () => {
      const payload = await riotPersisted('getEventDetails', { id: matchId }, env);
      return payload?.data?.event || payload?.event || payload?.data || payload;
    });
  }

  async function fetchWindow(gameId, startingTime) {
    return coalesce(`window:${gameId}:${startingTime || 'latest'}`, () => riotFeed(
      `window/${encodeURIComponent(gameId)}`,
      { startingTime: startingTime || undefined },
      { tolerateMiss: true }
    ));
  }

  async function fetchDetails(gameId, timestampIso) {
    return coalesce(`details:${gameId}:${timestampIso}`, () => riotFeed(
      `details/${encodeURIComponent(gameId)}`,
      { startingTime: timestampIso, participantIds: '1_2_3_4_5_6_7_8_9_10' },
      { tolerateMiss: true }
    ));
  }

  async function fetchBestDetails(gameId, timestampIso) {
    const times = detailProbeTimes(timestampIso);
    if (!times.length) return null;

    // Riot may key the same details frame by either its exact timestamp or the
    // rounded 10-second boundary. Probe those two likely keys together, then
    // use the remaining nearby key only as a fallback.
    const primaryTimes = times.slice(0, 2);
    const primaryPayloads = await Promise.all(
      primaryTimes.map(startingTime => fetchDetails(gameId, startingTime).catch(() => null))
    );
    for (const payload of primaryPayloads) {
      if (detailedFrame(payload)) return payload;
    }

    for (const startingTime of times.slice(2)) {
      const payload = await fetchDetails(gameId, startingTime).catch(() => null);
      if (detailedFrame(payload)) return payload;
    }
    return null;
  }

  async function fetchBestLiveWindow(gameId, after) {
    const candidates = [];
    const attempted = new Set();
    const afterMs = parseTimestamp(after);
    const now = Date.now();
    const attempt = async startingTime => {
      const key = startingTime || 'latest';
      if (attempted.has(key)) return null;
      attempted.add(key);
      const candidate = candidateFromPayload(await fetchWindow(gameId, startingTime).catch(() => null));
      if (candidate) candidates.push(candidate);
      return candidate;
    };

    const primary = await attempt(null);
    if (primary?.phase === 'gameplay' && primary.timestampQuality.freshness === 'fresh'
        && (afterMs === null || primary.timestampMs > afterMs)) return primary;

    if (afterMs !== null && afterMs <= now + FUTURE_TOLERANCE_SECONDS * 1000) {
      const next = await attempt(roundedIso(afterMs + 10_000));
      if (next?.phase === 'gameplay' && next.timestampQuality.freshness === 'fresh' && next.timestampMs > afterMs) return next;
    } else {
      const recent = await attempt(roundedIso(now - 20_000));
      if (recent?.phase === 'gameplay' && recent.timestampQuality.freshness === 'fresh') return recent;
    }

    const newestGameplay = newestCandidate(candidates, 'gameplay');
    if (!newestGameplay || newestGameplay.timestampQuality.freshness === 'stale') {
      await attempt(roundedIso(now - 60_000));
    }
    return newestCandidate(candidates, 'gameplay') || newestCandidate(candidates, 'pregame');
  }

  return {
    fetchBestDetails,
    fetchBestLiveWindow,
    fetchWindow,
    fetchDetails,
    getEvent,
    getGames: ids => {
      const normalizedIds = [...new Set((ids || []).map(String).filter(Boolean))].sort();
      return cached(`games:${normalizedIds.join(',')}`, GAME_CATALOG_CACHE_MS, () => (
        riotPersisted('getGames', { id: normalizedIds }, env)
      ));
    },
    getLive: () => cached('live-catalog', LIVE_CATALOG_CACHE_MS, () => riotPersisted('getLive', {}, env)),
    getSchedule: leagueId => cached(`schedule:${leagueId || 'all'}`, SCHEDULE_CACHE_MS, () => (
      riotPersisted('getSchedule', { leagueId: leagueId || undefined }, env)
    ))
  };
}