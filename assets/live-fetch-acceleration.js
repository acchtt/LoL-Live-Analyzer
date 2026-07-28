// Faster live retrieval: ask Riot for a frame newer than the one already shown.
(() => {
  'use strict';

  function lastFrameForSelectedGame() {
    const snapshot = state?.lastSnapshot;
    if (!snapshot?.source?.frameTimestamp) return null;
    if (String(snapshot.source.gameId || '') !== String(state.selectedGameId || '')) return null;
    return snapshot.source.frameTimestamp;
  }

  function selectedSnapshotStillVisible() {
    return Boolean(
      state?.lastSnapshot
      && String(state.lastSnapshot?.source?.gameId || '') === String(state.selectedGameId || '')
      && gameContent?.querySelector('.analysis-v2-shell')
    );
  }

  loadGame = async function acceleratedLoadGame() {
    if (!state.selectedGameId || document.hidden) return;

    const historical = state.selectedMatchState === 'completed';
    const startedAt = performance.now();
    let path = `/api/chatgpt?gameId=${encodeURIComponent(state.selectedGameId)}${historical ? '&historical=1' : ''}`;
    const after = historical ? null : lastFrameForSelectedGame();
    if (after) path += `&after=${encodeURIComponent(after)}`;

    try {
      const snapshot = await api(path);
      snapshot.request = {
        ...(snapshot.request || {}),
        clientFetchMs: Math.round(performance.now() - startedAt),
        requestedAfter: after || null
      };

      if (snapshot.status === 'telemetry_unavailable') {
        showTelemetryUnavailable(selectedScheduleEvent(), snapshot);
        return;
      }

      if (historical) snapshot.match = { ...(snapshot.match || {}), state: 'finished' };
      else markMatchLive(state.selectedEventId);

      renderGame(snapshot);
      if (historical) {
        setConnection('Finished · historical snapshot', '');
      } else {
        const frameTime = snapshot.source?.frameTimestamp
          ? new Date(snapshot.source.frameTimestamp).toLocaleTimeString()
          : new Date(snapshot.updatedAt).toLocaleTimeString();
        const latency = snapshot.request.clientFetchMs;
        setConnection(`LIVE · frame ${frameTime} · ${latency}ms`, 'live');
      }
    } catch (error) {
      // A transient upstream miss should not replace a valid live board with a
      // blank error state. Keep the last frame visible and retry on the next tick.
      if (!historical && selectedSnapshotStillVisible()) {
        setConnection(`LIVE · retrying · ${error.message}`, 'error');
        return;
      }
      setConnection(error.message, 'error');
      gameContent.innerHTML = `<div class="empty hero-empty"><strong>Feed unavailable</strong><span>${error.message}</span></div>`;
    }
  };
})();