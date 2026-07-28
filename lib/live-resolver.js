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

function mergeGameState(eventGames, refreshedGames) {
  const byId = new Map((refreshedGames || []).map(game => [String(game?.id), game]));
  return (eventGames || []).map(game => ({ ...game, ...(byId.get(String(game?.id)) || {}) }));
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

export async function resolveActiveGame(matchId, riot) {
  const event = await riot.getEvent(matchId);
  let games = Array.isArray(event?.match?.games) ? event.match.games.map(game => ({ ...game })) : [];
  const diagnostics = {};
  const [gamesResult, liveResult] = await Promise.allSettled([
    games.length ? riot.getGames(games.map(game => game?.id).filter(Boolean)) : null,
    riot.getLive()
  ]);
  if (gamesResult.status === 'fulfilled' && gamesResult.value) {
    games = mergeGameState(games, gamesResult.value?.data?.games || []);
  } else if (gamesResult.status === 'rejected') {
    diagnostics.getGames = gamesResult.reason instanceof Error ? gamesResult.reason.message : 'getGames failed';
  }

  let broadcastReportedLive = false;
  if (liveResult.status === 'fulfilled') {
    broadcastReportedLive = (liveResult.value?.data?.schedule?.events || [])
      .some(item => matchIdOf(item) === String(matchId));
  } else {
    diagnostics.getLive = liveResult.reason instanceof Error ? liveResult.reason.message : 'getLive failed';
  }

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
  let selectedGame = null;
  let selectedPhase = null;
  let selectedQuality = null;
  for (const game of candidates) {
    const payload = await riot.fetchWindow(String(game.id), null).catch(error => {
      diagnostics[String(game.id)] = error instanceof Error ? error.message : 'window failed';
      return null;
    });
    const candidate = candidateFromPayload(payload);
    if (!candidate || candidate.timestampQuality.freshness === 'stale' || candidate.phase === 'unknown') continue;
    selectedGame = { ...game, state: 'inProgress' };
    selectedPhase = candidate.phase;
    selectedQuality = candidate.timestampQuality;
    break;
  }
  return {
    schemaVersion: '2.4',
    event,
    games,
    selectedGame,
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
      safeForLiveAnalysis: selectedQuality.freshness === 'fresh' && selectedPhase === 'gameplay'
    } : { freshness: 'unavailable', frameAgeSeconds: null, safeForLiveAnalysis: false },
    diagnostics
  };
}
