// Re-resolve the active series when Riot's selected game frame is stale, unavailable, or no longer advancing.
// This module never infers a winner or changes a series score.
(() => {
  'use strict';

  const RETRYABLE_STATUSES = new Set(['telemetry_stale', 'telemetry_unavailable']);
  const STAGNANT_FRAME_LIMIT = 3;
  const STAGNANT_MIN_AGE_SECONDS = 20;
  const RESOLUTION_COOLDOWN_MS = 15_000;

  let resolving = false;
  let stagnantFrames = 0;
  let stagnantGameId = '';
  let lastResolutionAt = 0;

  function activeSelection() {
    return state.selectedMatchState === 'inProgress' && Boolean(state.selectedEventId);
  }

  function updateStagnation(snapshot) {
    const gameId = String(snapshot?.source?.gameId || state.selectedGameId || '');
    if (gameId !== stagnantGameId) {
      stagnantGameId = gameId;
      stagnantFrames = 0;
    }

    const status = String(snapshot?.status || '');
    const advancing = snapshot?.quality?.telemetryAdvancing;
    if (['ok', 'degraded'].includes(status) && advancing === false) {
      stagnantFrames += 1;
    } else if (advancing === true || !['ok', 'degraded'].includes(status)) {
      stagnantFrames = 0;
    }
    return stagnantFrames;
  }

  function retryReason(snapshot) {
    if (resolving || !activeSelection()) return null;

    const status = String(snapshot?.status || '');
    const stagnantCount = updateStagnation(snapshot);
    const sinceLastResolution = Date.now() - lastResolutionAt;
    if (sinceLastResolution < RESOLUTION_COOLDOWN_MS) return null;

    if (RETRYABLE_STATUSES.has(status)) return 'stale';

    const age = Number(snapshot?.quality?.frameAgeSeconds ?? snapshot?.source?.dataAgeSeconds);
    if (
      stagnantCount >= STAGNANT_FRAME_LIMIT
      && Number.isFinite(age)
      && age >= STAGNANT_MIN_AGE_SECONDS
    ) {
      return 'stagnant';
    }
    return null;
  }

  const authoritativeLoadGame = loadGame;
  loadGame = async function reliableLifecycleLoadGame(...args) {
    const result = await authoritativeLoadGame(...args);
    const snapshot = state.lastSnapshot;
    const reason = retryReason(snapshot);
    if (!reason) return result;

    resolving = true;
    lastResolutionAt = Date.now();
    stagnantFrames = 0;
    const matchId = String(state.selectedEventId);
    state.selectedGameId = null;
    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    setConnection(
      reason === 'stagnant'
        ? 'Rechecking active game after telemetry stopped advancing…'
        : 'Rechecking active game after stale telemetry…',
      ''
    );

    try {
      await resolveLiveEvent(matchId, true);
    } catch (error) {
      console.warn('Reliable next-game resolution failed:', error);
      setConnection(error instanceof Error ? error.message : 'Unable to resolve the active game', 'error');
    } finally {
      resolving = false;
      stagnantGameId = String(state.selectedGameId || '');
      stagnantFrames = 0;
    }
    return result;
  };
})();
