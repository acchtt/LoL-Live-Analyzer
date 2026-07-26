// Keeps the selected live game updating without requiring another click.
(() => {
  const BUILD = '20260726-27';
  const LIVE_REFRESH_MS = 5_000;
  const RESOLVE_REFRESH_MS = 8_000;

  let refreshTimer = null;
  let inFlight = false;
  let generation = 0;

  function selectedEvent() {
    return typeof selectedScheduleEvent === 'function' ? selectedScheduleEvent() : null;
  }

  function selectionKey() {
    return `${state.selectedEventId || ''}:${state.selectedGameId || ''}:${state.selectedMatchState || ''}`;
  }

  function isFinished() {
    const event = selectedEvent();
    return state.selectedMatchState === 'completed' || event?.state === 'completed';
  }

  function stopRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    generation += 1;
  }

  function scheduleRefresh(delay = LIVE_REFRESH_MS) {
    clearTimeout(refreshTimer);
    const token = generation;
    refreshTimer = setTimeout(() => {
      if (token !== generation) return;
      refreshSelectedGame();
    }, delay);
  }

  async function refreshSelectedGame() {
    clearTimeout(refreshTimer);
    refreshTimer = null;

    if (document.hidden || isFinished() || !state.selectedEventId) {
      if (!isFinished() && state.selectedEventId) scheduleRefresh(LIVE_REFRESH_MS);
      return;
    }

    if (inFlight) {
      scheduleRefresh(1_000);
      return;
    }

    const before = selectionKey();
    inFlight = true;
    try {
      if (state.selectedGameId) {
        await loadGame();
      } else if (typeof resolveLiveEvent === 'function') {
        await resolveLiveEvent(state.selectedEventId, true);
      }
    } catch (error) {
      console.warn('Automatic live refresh failed:', error);
    } finally {
      inFlight = false;
      const changed = before !== selectionKey();
      scheduleRefresh(changed || !state.selectedGameId ? 500 : (state.selectedGameId ? LIVE_REFRESH_MS : RESOLVE_REFRESH_MS));
    }
  }

  // Replace the older interval with one non-overlapping recursive timer.
  startPolling = function resilientStartPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    stopRefresh();
    scheduleRefresh(100);
  };

  const previousSelectEvent = selectEvent;
  selectEvent = async function refreshAwareSelectEvent(id) {
    stopRefresh();
    const result = await previousSelectEvent(id);
    if (!isFinished()) scheduleRefresh(100);
    return result;
  };

  const previousResolveLiveEvent = resolveLiveEvent;
  resolveLiveEvent = async function refreshAwareResolveLiveEvent(id, isRetry = false) {
    const result = await previousResolveLiveEvent(id, isRetry);
    if (!isFinished()) scheduleRefresh(state.selectedGameId ? 100 : RESOLVE_REFRESH_MS);
    return result;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      return;
    }
    if (state.selectedEventId && !isFinished()) scheduleRefresh(50);
  });

  window.addEventListener('focus', () => {
    if (state.selectedEventId && !isFinished()) scheduleRefresh(50);
  });

  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark"> Live refresh · ${BUILD}</span>`);

  if (state.selectedEventId && !isFinished()) scheduleRefresh(500);
})();
