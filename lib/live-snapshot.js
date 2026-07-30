import { parseTimestamp, finiteOrNull } from './reliability-policy.js';
import { normalizeGameplay, pregameTeams, seriesTeams } from './live-normalizer.js';
import { readSnapshot, recoveredSnapshot, writeSnapshot } from './snapshot-store.js';

function timingResult(promise, startedAt = Date.now()) {
  return Promise.resolve(promise).then(
    value => ({ value, elapsedMs: Date.now() - startedAt }),
    () => ({ value: null, elapsedMs: Date.now() - startedAt })
  );
}

export async function buildLiveSnapshot(gameId, env, after, riot) {
  const startedAt = Date.now();
  const afterMs = parseTimestamp(after);
  const windowStartedAt = Date.now();
  const candidate = await riot.fetchBestLiveWindow(gameId, after);
  const windowLookupMs = Date.now() - windowStartedAt;
  const retrievalBase = {
    windowLookupMs,
    windowRequests: candidate?.retrieval?.requestCount ?? null,
    selectedStartingTime: candidate?.retrieval?.selectedStartingTime ?? null,
    attemptedStartingTimes: candidate?.retrieval?.attemptedStartingTimes ?? [],
    requestedAfter: after || null
  };

  if (!candidate) {
    const cached = await readSnapshot(gameId);
    const retrieval = { ...retrievalBase, totalMs: Date.now() - startedAt };
    if (cached) return { ...recoveredSnapshot(cached), retrieval };
    return {
      schemaVersion: '2.4',
      status: 'telemetry_unavailable',
      updatedAt: new Date().toISOString(),
      source: { provider: 'Riot LoL Esports web feed', gameId: String(gameId), live: false },
      retrieval,
      quality: {
        timestampValid: false,
        freshness: 'unavailable',
        frameAgeSeconds: null,
        telemetryAdvancing: null,
        teamMappingVerified: false,
        detailsAvailable: false,
        criticalMissingFields: ['frame'],
        missingFields: ['frame'],
        safeForLiveAnalysis: false
      },
      message: 'No valid Riot telemetry frame is available.'
    };
  }

  const metadata = candidate?.payload?.gameMetadata || candidate?.frame?.gameMetadata || {};
  const matchId = String(candidate?.payload?.esportsMatchId || metadata?.esportsMatchId || '');
  const timestampIso = new Date(candidate.timestampMs).toISOString();
  const detailLoader = typeof riot.fetchBestDetails === 'function'
    ? riot.fetchBestDetails.bind(riot)
    : riot.fetchDetails.bind(riot);

  // Event metadata and player details are independent once the window supplies a
  // match ID and timestamp. Load details even for stale gameplay so post-game and
  // delayed context can retain champion and player boards. Freshness still controls
  // whether the snapshot is safe for live analysis.
  const eventStartedAt = Date.now();
  const eventPromise = matchId
    ? timingResult(riot.getEvent(matchId), eventStartedAt)
    : Promise.resolve({ value: null, elapsedMs: 0 });
  const detailsStartedAt = Date.now();
  const detailsPromise = candidate.phase === 'gameplay'
    ? timingResult(detailLoader(gameId, timestampIso), detailsStartedAt)
    : Promise.resolve({ value: null, elapsedMs: 0 });
  const [eventResult, detailsResult] = await Promise.all([eventPromise, detailsPromise]);
  const event = eventResult.value;
  const detailedPayload = detailsResult.value;
  const game = (event?.match?.games || []).find(item => String(item?.id) === String(gameId));
  const retrieval = {
    ...retrievalBase,
    eventMs: eventResult.elapsedMs,
    detailsMs: detailsResult.elapsedMs,
    totalMs: Date.now() - startedAt
  };

  if (candidate.phase !== 'gameplay') {
    const teams = pregameTeams(candidate, event, gameId);
    const snapshot = {
      schemaVersion: '2.4',
      status: 'pregame',
      updatedAt: new Date().toISOString(),
      source: {
        provider: 'Riot LoL Esports web feed',
        gameId: String(gameId),
        matchId: matchId || null,
        live: candidate.timestampQuality.freshness !== 'stale',
        frameTimestamp: timestampIso,
        dataAgeSeconds: candidate.timestampQuality.dataAgeSeconds
      },
      retrieval,
      quality: {
        timestampValid: true,
        freshness: candidate.timestampQuality.freshness,
        frameAgeSeconds: candidate.timestampQuality.dataAgeSeconds,
        futureSkewSeconds: candidate.timestampQuality.futureSkewSeconds,
        telemetryAdvancing: afterMs === null ? null : candidate.timestampMs > afterMs,
        teamMappingVerified: teams.teamMappingVerified,
        detailsAvailable: false,
        criticalMissingFields: [],
        missingFields: [],
        safeForLiveAnalysis: false
      },
      match: {
        league: event?.league?.name || null,
        bestOf: finiteOrNull(event?.match?.strategy?.count),
        gameNumber: finiteOrNull(game?.number),
        patch: teams.metadata?.patchVersion || null,
        state: 'pregame'
      },
      series: { teams: seriesTeams(event) },
      clock: null,
      clockSeconds: null,
      blue: teams.blue,
      red: teams.red,
      message: 'Champion selections are available, but Riot has not published a progressing gameplay frame.'
    };
    await writeSnapshot(gameId, snapshot);
    return snapshot;
  }

  const normalized = normalizeGameplay({ candidate, event, gameId, detailedPayload, afterMs });
  const status = candidate.timestampQuality.freshness === 'stale'
    ? 'telemetry_stale'
    : normalized.quality.safeForLiveAnalysis ? 'ok' : 'degraded';
  const snapshot = {
    schemaVersion: '2.4',
    status,
    updatedAt: new Date().toISOString(),
    source: {
      provider: 'Riot LoL Esports web feed',
      gameId: String(gameId),
      matchId: matchId || null,
      live: status === 'ok' || status === 'degraded',
      frameTimestamp: timestampIso,
      dataAgeSeconds: candidate.timestampQuality.dataAgeSeconds
    },
    retrieval,
    quality: normalized.quality,
    match: {
      league: event?.league?.name || null,
      bestOf: finiteOrNull(event?.match?.strategy?.count),
      gameNumber: finiteOrNull(game?.number),
      patch: normalized.metadata?.patchVersion || null,
      state: status === 'telemetry_stale' ? 'stale_frame' : 'in_game'
    },
    series: { teams: seriesTeams(event) },
    clock: normalized.clock,
    clockSeconds: normalized.clockSeconds,
    blue: normalized.blue,
    red: normalized.red,
    differences: normalized.differences,
    summary: normalized.summary,
    message: status === 'ok'
      ? 'Fresh verified Riot telemetry frame.'
      : status === 'degraded'
        ? 'Current Riot map data is available, but one or more betting-critical detail fields are incomplete.'
        : 'The last Riot frame is stale. Treat it as historical context only.'
  };
  if (status !== 'telemetry_stale') await writeSnapshot(gameId, snapshot);
  return snapshot;
}
