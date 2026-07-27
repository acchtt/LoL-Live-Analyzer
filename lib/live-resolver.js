import { finiteOrNull } from './reliability-policy.js';
import { candidateFromPayload } from './riot-client.js';
import { seriesTeams } from './live-normalizer.js';

const MAX_RESOLVER_GAMES = 2;

function matchIdOf(event) {
  return String(event?.match?.id || event?.id || '');
}

function mergeGameState(eventGames, refreshedGames) {
  const byId = new Map((refreshedGames || []).map(game => [String(game?.id), game]));
  return (eventGames || []).map(game => ({ ...game, ...(byId.get(String(game?.id)) || {}) }));
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
  let broadcastLive = false;
  if (liveResult.status === 'fulfilled') {
    broadcastLive = (liveResult.value?.data?.schedule?.events || []).some(item => matchIdOf(item) === String(matchId));
  } else {
    diagnostics.getLive = liveResult.reason instanceof Error ? liveResult.reason.message : 'getLive failed';
  }

  const reported = games.filter(game => game?.state === 'inProgress');
  const fallback = [...games]
    .filter(game => game?.id && game?.state !== 'completed' && !reported.some(item => String(item?.id) === String(game?.id)))
    .sort((left, right) => (finiteOrNull(right?.number) || 0) - (finiteOrNull(left?.number) || 0));
  const candidates = [...reported, ...fallback].slice(0, MAX_RESOLVER_GAMES);
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
    broadcastLive,
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
