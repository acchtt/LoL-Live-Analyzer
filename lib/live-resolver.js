import { finiteOrNull } from './reliability-policy.js';
import { candidateFromPayload } from './riot-client.js';
import { seriesTeams } from './live-normalizer.js';
import { normalizeAuthoritativeCompletion } from './series-integrity.js';

const MAX_RESOLVER_GAMES = 8;

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
  return merged.sort((left, right) => gameNumber(left, 999) - gameNumber(right, 999));
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

function assignExpectedNumberToLiveIds(event, games, livePriorityIds) {
  if (!livePriorityIds.size) return games;
  const expected = expectedGameNumber(event, games);
  const numberedIds = new Set(
    games.filter(game => gameNumber(game) > 0).map(game => String(game.id || ''))
  );
  const expectedIds = games
    .filter(game => gameNumber(game) === expected)
    .map(game => String(game.id || ''));

  return games.map(game => {
    const id = String(game?.id || '');
    if (!id || !livePriorityIds.has(id) || numberedIds.has(id)) return game;

    // Riot occasionally publishes the newly created deciding-game ID through
    // getLive before attaching its game number. Keep any existing placeholder,
    // but annotate the live ID so it is probed alongside that placeholder.
    return {
      ...game,
      number: expected,
      inferredNumber: true,
      duplicateExpectedNumber: expectedIds.length > 0
    };
  });
}

function resolverCandidates(event = {}, games = [], livePriorityIds = new Set()) {
  const expected = expectedGameNumber(event, games);
  const unresolved = games.filter(game => game?.id && game?.state !== 'completed');
  const eligibleLive = unresolved.filter(game => {
    const id = String(game?.id || '');
    const number = gameNumber(game);
    return livePriorityIds.has(id) && (number === 0 || number >= expected);
  });
  const exact = unresolved.filter(game => gameNumber(game) === expected);
  const reported = unresolved
    .filter(game => game?.state === 'inProgress' && gameNumber(game) >= expected)
    .sort((left, right) => gameNumber(right) - gameNumber(left));
  const remaining = unresolved
    .filter(game => !eligibleLive.includes(game) && !exact.includes(game) && !reported.includes(game))
    .sort((left, right) => {
      const leftNumber = gameNumber(left);
      const rightNumber = gameNumber(right);
      const leftDistance = leftNumber > 0 ? Math.abs(leftNumber - expected) : 999;
      const rightDistance = rightNumber > 0 ? Math.abs(rightNumber - expected) : 999;
      return leftDistance - rightDistance || leftNumber - rightNumber;
    });

  const unique = [];
  const seen = new Set();
  for (const game of [...eligibleLive, ...exact, ...reported, ...remaining]) {
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
    timestamp: candidate?.frame?.rfc460Timestamp || candidate?.frame?.timestamp || null,
    gameNumber: gameNumber(game) || null,
    inferredNumber: Boolean(game?.inferredNumber)
  };
  return candidate;
}

function usableCandidate(candidate) {
  return Boolean(candidate
    && candidate.timestampQuality.freshness !== 'stale'
    && candidate.phase !== 'unknown');
}

function chooseProbeResult(results, phase) {
  return results
    .filter(result => result && usableCandidate(result.candidate) && result.candidate.phase === phase)
    .sort((left, right) => right.candidate.timestampMs - left.candidate.timestampMs)[0] || null;
}

export async function resolveActiveGame(matchId, riot) {
  const diagnostics = {};

  // Event details and getLive are independent. Starting them together also lets
  // us merge a newly published deciding-game ID before refreshing the catalog.
  const [eventResult, liveResult] = await Promise.allSettled([
    riot.getEvent(matchId),
    riot.getLive()
  ]);
  if (eventResult.status === 'rejected') throw eventResult.reason;

  let event = eventResult.value;
  const initialGames = Array.isArray(event?.match?.games) ? event.match.games : [];
  const initialGameIds = new Set(initialGames.map(game => String(game?.id || '')).filter(Boolean));
  const initialExpected = expectedGameNumber(event, initialGames);
  const livePriorityIds = new Set();
  let broadcastReportedLive = false;

  if (liveResult.status === 'fulfilled') {
    const liveEvents = liveResult.value?.data?.schedule?.events || [];
    const liveEvent = liveEvents.find(item => matchIdOf(item) === String(matchId)) || null;
    broadcastReportedLive = Boolean(liveEvent);
    if (liveEvent) {
      for (const game of liveEvent?.match?.games || []) {
        const id = String(game?.id || '');
        const number = gameNumber(game);
        const expectedOrUnknown = number === 0 || number >= initialExpected;
        if (id && (!initialGameIds.has(id) || (game?.state === 'inProgress' && expectedOrUnknown))) {
          livePriorityIds.add(id);
        }
      }
      event = mergeLiveEvent(event, liveEvent);
      diagnostics.liveEventMerged = true;
    }
  } else {
    diagnostics.getLive = liveResult.reason instanceof Error ? liveResult.reason.message : 'getLive failed';
  }

  let games = Array.isArray(event?.match?.games) ? event.match.games.map(game => ({ ...game })) : [];
  games = assignExpectedNumberToLiveIds(event, games, livePriorityIds);
  const gameIds = games.map(game => game?.id).filter(Boolean);
  if (gameIds.length) {
    try {
      const gamesPayload = await riot.getGames(gameIds);
      games = mergeGameCatalog(games, gamesPayload?.data?.games || []);
      games = assignExpectedNumberToLiveIds(event, games, livePriorityIds);
    } catch (error) {
      diagnostics.getGames = error instanceof Error ? error.message : 'getGames failed';
    }
  }

  const liveAddedGameIds = [...livePriorityIds].filter(id => !initialGameIds.has(id));
  if (liveAddedGameIds.length) diagnostics.liveAddedGameIds = liveAddedGameIds;
  diagnostics.livePriorityGameIds = [...livePriorityIds];

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

  const expected = expectedGameNumber(event, games);
  const candidates = resolverCandidates(event, games, livePriorityIds);
  diagnostics.expectedGameNumber = expected;
  diagnostics.candidateOrder = candidates.map(game => ({
    id: String(game.id),
    number: gameNumber(game) || null,
    state: game.state || null,
    livePriority: livePriorityIds.has(String(game.id || '')),
    inferredNumber: Boolean(game?.inferredNumber)
  }));

  let selectedGame = null;
  let selectedPhase = null;
  let selectedQuality = null;
  let pregameGame = null;

  // Probe all IDs that could represent the expected game together. Riot can
  // temporarily expose both a numbered placeholder and a second live-only ID.
  const priorityGames = candidates.filter(game => {
    const id = String(game?.id || '');
    const number = gameNumber(game);
    return number === expected || (livePriorityIds.has(id) && (number === 0 || number >= expected));
  });
  const priorityResults = await Promise.all(
    priorityGames.map(async game => ({
      game,
      candidate: await probeGame(riot, game, true, diagnostics)
    }))
  );

  const priorityGameplay = chooseProbeResult(priorityResults, 'gameplay');
  const priorityPregame = chooseProbeResult(priorityResults, 'pregame');
  if (priorityGameplay) {
    selectedGame = { ...priorityGameplay.game, state: 'inProgress' };
    selectedPhase = 'gameplay';
    selectedQuality = priorityGameplay.candidate.timestampQuality;
  } else if (priorityPregame) {
    pregameGame = { ...priorityPregame.game, state: 'inProgress' };
    selectedPhase = 'pregame';
    selectedQuality = priorityPregame.candidate.timestampQuality;
  }

  // Only consider remaining IDs when the expected-game group produced no usable
  // frame. Earlier completed-game telemetry is deliberately excluded.
  if (!selectedGame && !pregameGame) {
    const fallbackGames = candidates.filter(game => !priorityGames.includes(game) && gameNumber(game) >= expected);
    const fallbackResults = await Promise.all(
      fallbackGames.map(async game => ({
        game,
        candidate: await probeGame(riot, game, false, diagnostics)
      }))
    );
    const fallbackGameplay = chooseProbeResult(fallbackResults, 'gameplay');
    const fallbackPregame = chooseProbeResult(fallbackResults, 'pregame');
    const selected = fallbackGameplay || fallbackPregame;
    if (selected) {
      selectedPhase = selected.candidate.phase;
      selectedQuality = selected.candidate.timestampQuality;
      if (selectedPhase === 'gameplay') selectedGame = { ...selected.game, state: 'inProgress' };
      else pregameGame = { ...selected.game, state: 'inProgress' };
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
