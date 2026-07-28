// Re-resolve the active series when Riot's selected game frame is stale or unavailable.
// This module never infers a winner or changes a series score.
(() => {
  'use strict';

  const RETRYABLE_STATUSES = new Set(['telemetry_stale', 'telemetry_unavailable']);
  let resolving = false;

  function shouldResolveAgain(snapshot) {
    return !resolving
      && state.selectedMatchState === 'inProgress'
      && Boolean(state.selectedEventId)
      && RETRYABLE_STATUSES.has(String(snapshot?.status || ''));
  }

  const authoritativeLoadGame = loadGame;
  loadGame = async function reliableLifecycleLoadGame(...args) {
    const result = await authoritativeLoadGame(...args);
    const snapshot = state.lastSnapshot;
    if (!shouldResolveAgain(snapshot)) return result;

    resolving = true;
    const matchId = String(state.selectedEventId);
    state.selectedGameId = null;
    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    setConnection('Rechecking active game after stale telemetry…', '');

    try {
      await resolveLiveEvent(matchId, true);
    } catch (error) {
      console.warn('Reliable next-game resolution failed:', error);
      setConnection(error instanceof Error ? error.message : 'Unable to resolve the active game', 'error');
    } finally {
      resolving = false;
    }
    return result;
  };
})();
