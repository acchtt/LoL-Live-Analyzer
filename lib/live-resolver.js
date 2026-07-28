import { finiteOrNull } from './reliability-policy.js';
import { candidateFromPayload } from './riot-client.js';
import { seriesTeams } from './live-normalizer.js';
import { normalizeAuthoritativeCompletion } from './series-integrity.js';

const MAX_RESOLVER_GAMES = 3;

function matchIdOf(event) {
  return String(event?.match?.id || event?.id || '');
}

function gameNumber(game = {}, fallback = 0) {
  return finiteOrNull(game?.number) || fallback;
}

function mergeGameCatalog(...catalogs) {
  const merged = [];
  for (const games of catalogs) {
    for (const game of games || []) {
      if (!game) continue;
      const id = String(game?.id || '');
      const number = gameNumber(game);
      const index = merged.findIndex(item => (
        (id && String(item?.id || '') === id)
        || (number > 0 && gameNumber(item) === number)
      ));
      if (index >= 0) merged[index] = { ...merged[index], ...game };
      else merged.push({ ...game });
    }
  }
  return merged.sort((left, right) => gameNumber(left) - gameNumber(right));
}

function mergeTeams(baseTeams = [], liveTeams = []) {
  const length = Math.max(baseTeams.length, liveTeams.length);
  return Array.from({ length }, (_, index) => {
    const base = baseTeams[index] || {};
    const live = liveTeams[index] || {};
    return {
      ...base,
      ...live,
      result: { ...(base.result || {}), ...(live.result || {}) }
    };
  });
}

function mergeLiveEvent(baseEvent = {}, liveEvent = {}) {
  const baseMatch = baseEvent?.match || {};
  const liveMatch = liveEvent?.match || {};
  return {
    ...baseEvent,
    ...liveEvent,
    league: { ...(baseEvent?.league || {}), ...(liveEvent?.league || {}) },
    match: {
      ...baseMatch,
      ...liveMatch,
      teams: mergeTeams(baseMatch.teams || [], liveMatch.teams || []),
      games: mergeGameCatalog(baseMatch.games || [], liveMatch.games || [])
    }
  };
}

function hasCompletionEvidence(game = {}) {
  return game?.state === 'completed' || (Array.isArray(game?.vods) && game.vods.length > 0);
}

function expectedGameNumber(event = {}, games = []) {
  const scores = (event?.match?.teams || []).map(team => finiteOrNull(team?.result?.gameWins));
  const scoreCount = scores.length >= 2 && scores.every(score => score !== null && score >= 0)
    ? scores.reduce((sum, score) => sum + score, 0)
    : 0;
  const evidenceCount = games.reduce((highest, game, index) => (
    hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index + 1)) : highest
  ), 0);
  return Math.max(scoreCount, evidenceCount) + 1;
}

function resolverCandidates(event = {}, games = []) {
  const expected = expectedGameNumber(event, games);
  const unresolved = games.filter(game => game?.id && game?.state !== 'completed');
  const exact = unresolved.filter(game => gameNumber(game) === expected);
  const reported = unresolved
    .filter(game => game?.state === 'inProgress')
    .sort((left, right) => gameNumber(right) - gameNumber(left));
  const remaining = unresolved
    .filter(game => !exact.includes(game) && !reported.includes(game))
    .sort((left, right) => {
      const distance = Math.abs(gameNumber(left) - expected) - Math.abs(gameNumber(right) - expected);
      return distance || gameNumber(left) - gameNumber(right);
    });

  const unique = [];
  const seen = new Set();
  for (const game of [...exact, ...reported, ...remaining]) {
    const id = String(game?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(game);
  }
  return unique.slice(0, MAX_RESOLVER_GAMES);
}

async function probeGame(riot, game, useResilientLookup, diagnostics) {
  const gameId = String(game.id);
  let payload = null;
  try {
    if (useResilientLookup && typeof riot.fetchBestLiveWindow === 'function') {
      payload = await riot.fetchBestLiveWindow(gameId, null);
    } else {
      payload = await riot.fetchWindow(gameId, null);
    }
  } catch (error) {
    diagnostics[gameId] = {
      error: error instanceof Error ? error.message : 'window failed',
      lookup: useResilientLookup ? 'best-live-window' : 'latest-window'
    };
    return null;
  }

  const candidate = candidateFromPayload(payload);
  diagnostics[gameId] = {
    lookup: useResilientLookup ? 'best-live-window' : 'latest-window',
    found: Boolean(candidate),
    phase: candidate?.phase || null,
    freshness: candidate?.timestampQuality?.freshness || null,
    frameAgeSeconds: candidate?.timestampQuality?.dataAgeSeconds ?? null,
    timestamp: candidate?.frame?.rfc460Timestamp || candidate?.frame?.timestamp || null
  };
  return candidate;
}

function usableCandidate(candidate) {
  return Boolean(candidate
    && candidate.timestampQuality.freshness !== 'stale'
    && candidate.phase !== 'unknown');
}

export async function resolveActiveGame(matchId, riot) {
  const diagnostics = {};

  // Event details and getLive are independent. Starting them together also lets
  // us merge a newly published Game 2/3 ID before making a single getGames call.
  const [eventResult, liveResult] = await Promise.allSettled([
    riot.getEvent(matchId),
    riot.getLive()
  ]);
  if (eventResult.status === 'rejected') throw eventResult.reason;

  let event = eventResult.value;
  let broadcastReportedLive = false;
  if (liveResult.status === 'fulfilled') {
    const liveEvents = liveResult.value?.data?.schedule?.events || [];
    const liveEvent = liveEvents.find(item => matchIdOf(item) === String(matchId)) || null;
    broadcastReportedLive = Boolean(liveEvent);
    if (liveEvent) {
      event = mergeLiveEvent(event, liveEvent);
      diagnostics.liveEventMerged = true;
    }
  } else {
    diagnostics.getLive = liveResult.reason instanceof Error ? liveResult.reason.message : 'getLive failed';
  }

  let games = Array.isArray(event?.match?.games) ? event.match.games.map(game => ({ ...game })) : [];
  const gameIds = games.map(game => game?.id).filter(Boolean);
  if (gameIds.length) {
    try {
      const gamesPayload = await riot.getGames(gameIds);
      games = mergeGameCatalog(games, gamesPayload?.data?.games || []);
    } catch (error) {
      diagnostics.getGames = error instanceof Error ? error.message : 'getGames failed';
    }
  }

  event = {
    ...event,
    match: { ...(event?.match || {}), games }
  };

  const seriesComplete = normalizeAuthoritativeCompletion(event);
  if (seriesComplete) {
    return {
      schemaVersion: '2.4',
      event,
      games,
      selectedGame: null,
      selectedPhase: 'series_complete',
      series: { teams: seriesTeams(event) },
      seriesComplete: true,
      completionSource: event?.completionSource || 'riot_series_score',
      broadcastLive: false,
      broadcastReportedLive,
      telemetryAvailable: false,
      checkedAt: new Date().toISOString(),
      quality: { freshness: 'unavailable', frameAgeSeconds: null, safeForLiveAnalysis: false },
      diagnostics
    };
  }

  const candidates = resolverCandidates(event, games);
  diagnostics.expectedGameNumber = expectedGameNumber(event, games);
  diagnostics.candidateOrder = candidates.map(game => ({
    id: String(game.id),
    number: gameNumber(game),
    state: game.state || null
  }));

  let selectedGame = null;
  let selectedPhase = null;
  let selectedQuality = null;
  let pregameGame = null;

  const firstGame = candidates[0] || null;
  if (firstGame) {
    const firstCandidate = await probeGame(riot, firstGame, true, diagnostics);
    if (usableCandidate(firstCandidate)) {
      if (firstCandidate.phase === 'pregame') {
        pregameGame = { ...firstGame, state: 'inProgress' };
        selectedPhase = 'pregame';
        selectedQuality = firstCandidate.timestampQuality;
      } else {
        selectedGame = { ...firstGame, state: 'inProgress' };
        selectedPhase = firstCandidate.phase;
        selectedQuality = firstCandidate.timestampQuality;
      }
    }
  }

  // Only probe fallback IDs when the expected game did not resolve. These
  // lightweight latest-window checks run together instead of adding one full
  // network round trip per stale game left in Riot's catalog.
  if (!selectedGame && !pregameGame && candidates.length > 1) {
    const fallbackGames = candidates.slice(1);
    const fallbackCandidates = await Promise.all(
      fallbackGames.map(game => probeGame(riot, game, false, diagnostics))
    );
    for (let index = 0; index < fallbackCandidates.length; index += 1) {
      const candidate = fallbackCandidates[index];
      if (!usableCandidate(candidate)) continue;
      const game = fallbackGames[index];
      if (candidate.phase === 'pregame') {
        pregameGame = { ...game, state: 'inProgress' };
        selectedPhase = 'pregame';
      } else {
        selectedGame = { ...game, state: 'inProgress' };
        selectedPhase = candidate.phase;
      }
      selectedQuality = candidate.timestampQuality;
      break;
    }
  }

  return {
    schemaVersion: '2.4',
    event,
    games,
    selectedGame,
    pregameGame,
    selectedPhase,
    series: { teams: seriesTeams(event) },
    seriesComplete: false,
    broadcastLive: broadcastReportedLive,
    broadcastReportedLive,
    telemetryAvailable: Boolean(selectedGame),
    checkedAt: new Date().toISOString(),
    quality: selectedQuality ? {
      freshness: selectedQuality.freshness,
      frameAgeSeconds: selectedQuality.dataAgeSeconds,
      safeForLiveAnalysis: Boolean(selectedGame)
        && selectedQuality.freshness === 'fresh'
        && selectedPhase === 'gameplay'
    } : { freshness: 'unavailable', frameAgeSeconds: null, safeForLiveAnalysis: false },
    diagnostics
  };
}