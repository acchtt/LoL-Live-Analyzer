import { finiteOrNull, parseTimestamp } from './reliability-policy.js';
import { candidateFromPayload } from './riot-client.js';
import { normalizeGameplay, pregameTeams, seriesTeams } from './live-normalizer.js';

const END_DELTAS_MS = [-10 * 60_000, -5 * 60_000, -3 * 60_000, -2 * 60_000, -60_000, -30_000, -10_000, 0, 10_000];
const FALLBACK_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];
const MAX_WINDOW_PROBES = 40;

function roundedIso(timestampMs) {
  return new Date(Math.floor(timestampMs / 10_000) * 10_000).toISOString();
}

function gameRecords(payload) {
  const games = payload?.data?.games || payload?.games || [];
  return Array.isArray(games) ? games : [];
}

function uniqueTimes(values) {
  return [...new Set(values
    .filter(value => Number.isFinite(value))
    .map(roundedIso))];
}

export function historicalCursorTimes(game = {}) {
  const highConfidence = [];
  const fallback = [];

  for (const vod of Array.isArray(game?.vods) ? game.vods : []) {
    const firstFrame = parseTimestamp(vod?.firstFrameTime);
    if (firstFrame === null) continue;

    const startMillis = finiteOrNull(vod?.startMillis);
    const endMillis = finiteOrNull(vod?.endMillis);
    const anchors = [firstFrame];
    if (startMillis !== null) anchors.push(firstFrame + startMillis);

    for (const anchor of anchors) {
      highConfidence.push(anchor);
      if (endMillis !== null && endMillis > 0) {
        for (const delta of END_DELTAS_MS) highConfidence.push(anchor + endMillis + delta);
      }
      for (const minute of FALLBACK_MINUTES) fallback.push(anchor + minute * 60_000);
    }
  }

  for (const field of ['startTime', 'beginTime', 'endTime', 'completedAt']) {
    const parsed = parseTimestamp(game?.[field]);
    if (parsed !== null) highConfidence.push(parsed);
  }

  return uniqueTimes([...highConfidence.reverse(), ...fallback.reverse()]).slice(0, MAX_WINDOW_PROBES);
}

function newest(candidates, phase) {
  return candidates
    .filter(candidate => candidate?.phase === phase)
    .sort((left, right) => right.timestampMs - left.timestampMs)[0] || null;
}

async function historicalCandidate(gameId, game, riot) {
  const candidates = [];
  const attempted = [];

  const inspect = async startingTime => {
    attempted.push(startingTime || 'latest');
    const payload = await riot.fetchWindow(gameId, startingTime).catch(() => null);
    const candidate = candidateFromPayload(payload);
    if (candidate) candidates.push(candidate);
    return candidate;
  };

  await inspect(null);
  const cursorTimes = historicalCursorTimes(game);
  const batchSize = 6;
  for (let offset = 0; offset < cursorTimes.length; offset += batchSize) {
    await Promise.all(cursorTimes.slice(offset, offset + batchSize).map(inspect));
  }

  return {
    candidate: newest(candidates, 'gameplay'),
    pregame: newest(candidates, 'pregame'),
    attempted
  };
}

function unavailableSnapshot(gameId, game, event, result) {
  const candidate = result?.pregame || null;
  const teams = candidate ? pregameTeams(candidate, event, gameId) : null;
  return {
    schemaVersion: '2.4',
    status: 'historical_unavailable',
    updatedAt: new Date().toISOString(),
    source: {
      provider: 'Riot LoL Esports web feed',
      gameId: String(gameId),
      matchId: String(event?.match?.id || ''),
      live: false,
      historicalProbe: true,
      probeCount: result?.attempted?.length || 0,
      lastPregameFrameTimestamp: candidate ? new Date(candidate.timestampMs).toISOString() : null
    },
    quality: {
      timestampValid: Boolean(candidate),
      freshness: 'historical',
      frameAgeSeconds: candidate?.timestampQuality?.dataAgeSeconds ?? null,
      telemetryAdvancing: false,
      teamMappingVerified: teams?.teamMappingVerified || false,
      detailsAvailable: false,
      criticalMissingFields: ['historicalGameplayFrame'],
      missingFields: ['historicalGameplayFrame'],
      safeForLiveAnalysis: false,
      historical: true
    },
    match: {
      league: event?.league?.name || null,
      bestOf: finiteOrNull(event?.match?.strategy?.count),
      gameNumber: finiteOrNull(game?.number),
      state: 'historical_unavailable'
    },
    series: { teams: seriesTeams(event) },
    blue: teams?.blue || null,
    red: teams?.red || null,
    message: 'No progressing archived gameplay frame was recovered. Pregame lineups are not presented as final game statistics.'
  };
}

export async function buildHistoricalSnapshot(gameId, env, riot) {
  const gamesPayload = await riot.getGames([gameId]).catch(() => null);
  const game = gameRecords(gamesPayload).find(item => String(item?.id) === String(gameId))
    || gameRecords(gamesPayload)[0]
    || {};

  const result = await historicalCandidate(gameId, game, riot);
  const candidate = result.candidate;
  const metadata = candidate?.payload?.gameMetadata || candidate?.frame?.gameMetadata || {};
  const matchId = String(candidate?.payload?.esportsMatchId || metadata?.esportsMatchId || game?.esportsMatchId || '');
  const event = matchId ? await riot.getEvent(matchId).catch(() => null) : null;

  if (!candidate) return unavailableSnapshot(gameId, game, event, result);

  const timestampIso = new Date(candidate.timestampMs).toISOString();
  const detailedPayload = await riot.fetchDetails(gameId, timestampIso).catch(() => null);
  const normalized = normalizeGameplay({ candidate, event, gameId, detailedPayload, afterMs: null });

  return {
    schemaVersion: '2.4',
    status: 'ok',
    updatedAt: new Date().toISOString(),
    source: {
      provider: 'Riot LoL Esports web feed',
      gameId: String(gameId),
      matchId: matchId || null,
      live: false,
      frameTimestamp: timestampIso,
      dataAgeSeconds: candidate.timestampQuality.dataAgeSeconds,
      historicalProbe: true,
      finalFrameRecovered: true,
      probeCount: result.attempted.length
    },
    quality: {
      ...normalized.quality,
      freshness: 'historical',
      telemetryAdvancing: false,
      safeForLiveAnalysis: false,
      historical: true
    },
    match: {
      league: event?.league?.name || null,
      bestOf: finiteOrNull(event?.match?.strategy?.count),
      gameNumber: finiteOrNull(game?.number),
      patch: normalized.metadata?.patchVersion || null,
      state: 'finished'
    },
    series: { teams: seriesTeams(event) },
    clock: normalized.clock,
    clockSeconds: normalized.clockSeconds,
    blue: normalized.blue,
    red: normalized.red,
    differences: normalized.differences,
    summary: normalized.summary,
    message: 'Recovered archived gameplay frame. This is historical context and is never safe for live analysis.'
  };
}
