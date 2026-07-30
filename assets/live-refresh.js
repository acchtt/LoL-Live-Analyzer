// Keeps the selected live game updating without requiring another click.
(() => {
  const BUILD = '20260731-1';
  const LIVE_REFRESH_MS = 3_000;
  const RESOLVE_REFRESH_MS = 5_000;

  let refreshTimer = null;
  let inFlight = false;
  let generation = 0;

  function selectedEvent() {
    return typeof selectedScheduleEvent === 'function' ? selectedScheduleEvent() : null;
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

    // Visibility/focus handlers restart polling. Do not keep background timers
    // alive while the tab is hidden.
    if (document.hidden || isFinished() || !state.selectedEventId) return;

    if (inFlight) {
      scheduleRefresh(500);
      return;
    }

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
      scheduleRefresh(state.selectedGameId ? LIVE_REFRESH_MS : RESOLVE_REFRESH_MS);
    }
  }

  // The base resolver already loads the first frame before calling startPolling.
  // Start the next refresh at the normal interval instead of immediately issuing
  // a duplicate request for the same frame.
  startPolling = function resilientStartPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    stopRefresh();
    scheduleRefresh(LIVE_REFRESH_MS);
  };

  const previousSelectEvent = selectEvent;
  selectEvent = async function refreshAwareSelectEvent(id) {
    stopRefresh();
    const result = await previousSelectEvent(id);
    if (!isFinished()) scheduleRefresh(state.selectedGameId ? LIVE_REFRESH_MS : RESOLVE_REFRESH_MS);
    return result;
  };

  const previousResolveLiveEvent = resolveLiveEvent;
  resolveLiveEvent = async function refreshAwareResolveLiveEvent(id, isRetry = false) {
    const result = await previousResolveLiveEvent(id, isRetry);
    if (!isFinished()) scheduleRefresh(state.selectedGameId ? LIVE_REFRESH_MS : RESOLVE_REFRESH_MS);
    return result;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      return;
    }
    if (state.selectedEventId && !isFinished()) scheduleRefresh(25);
  });

  window.addEventListener('focus', () => {
    if (state.selectedEventId && !isFinished()) scheduleRefresh(25);
  });

  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark"> Live refresh · ${BUILD}</span>`);

  if (state.selectedEventId && !isFinished()) scheduleRefresh(200);
})();
