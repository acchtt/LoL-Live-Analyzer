// Keeps the active schedule limited to real, unfinished series.
(() => {
  'use strict';

  const PLACEHOLDER_TEAM_KEYS = new Set(['', 'tbd', 'tba', 'unknown', 'tobedetermined', 'team1', 'team2']);
  let transitioningToHistory = false;

  function normalized(value = '') {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function teamWins(team = {}) {
    const value = team?.result?.gameWins ?? team?.wins;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function targetWins(event = {}) {
    const count = Number(event?.match?.strategy?.count);
    return Number.isInteger(count) && count > 0 ? Math.floor(count / 2) + 1 : null;
  }

  function seriesComplete(event = {}) {
    if (event?.state === 'completed' || event?.match?.state === 'completed') return true;
    const target = targetWins(event);
    const teams = Array.isArray(event?.match?.teams) ? event.match.teams : [];
    return target !== null && teams.length >= 2 && teams.some(team => {
      const wins = teamWins(team);
      return wins !== null && wins >= target;
    });
  }

  function normalizeCompletion(event = {}) {
    if (!seriesComplete(event)) return false;
    event.state = 'completed';
    if (event.match) event.match.state = 'completed';
    if (!event.completionSource) event.completionSource = 'riot_series_score';
    return true;
  }

  function resolvedTeam(team = {}) {
    if (String(team?.id || '').trim() || String(team?.image || '').trim()) return true;
    return !PLACEHOLDER_TEAM_KEYS.has(normalized(team?.code))
      || !PLACEHOLDER_TEAM_KEYS.has(normalized(team?.name));
  }

  function placeholderEvent(event = {}) {
    const teams = Array.isArray(event?.match?.teams) ? event.match.teams : [];
    return teams.length < 2 || teams.every(team => !resolvedTeam(team));
  }

  globalThis.riftPulseSeriesComplete = seriesComplete;
  globalThis.riftPulsePlaceholderEvent = placeholderEvent;

  const baseDisplayState = displayState;
  displayState = function integrityDisplayState(event) {
    if (seriesComplete(event)) return 'completed';
    return baseDisplayState(event);
  };

  const baseShouldResolveAsLive = shouldResolveAsLive;
  shouldResolveAsLive = function integrityShouldResolveAsLive(event, now = Date.now()) {
    if (seriesComplete(event) || placeholderEvent(event)) return false;
    return baseShouldResolveAsLive(event, now);
  };

  const baseMarkMatchLive = markMatchLive;
  markMatchLive = function integrityMarkMatchLive(id) {
    const event = state.events.find(item => eventId(item) === String(id));
    if (event && seriesComplete(event)) {
      state.liveMatchIds.delete(String(id));
      normalizeCompletion(event);
      renderSchedule();
      return;
    }
    return baseMarkMatchLive(id);
  };

  async function transitionSelectedMatchToHistory(event) {
    if (transitioningToHistory || !event || state.selectedMatchState === 'completed') return;
    transitioningToHistory = true;
    const id = eventId(event);
    normalizeCompletion(event);
    state.liveMatchIds.delete(id);
    clearMatchTimers();
    if ('scheduleTab' in state) state.scheduleTab = 'finished';
    renderSchedule();
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Series finished</strong><span>Moving this match to history and loading its archived games…</span></div>';
    setConnection('Series finished · loading history', '');

    try {
      await loadFinishedMatch(id);
    } catch (error) {
      state.selectedMatchState = 'completed';
      gameContent.innerHTML = `<div class="empty hero-empty"><strong>Series finished</strong><span>${error instanceof Error ? error.message : 'Archived telemetry is unavailable.'}</span></div>`;
      setConnection('Series finished · archive unavailable', '');
    } finally {
      transitioningToHistory = false;
    }
  }

  const baseShowWaiting = showWaiting;
  showWaiting = function integrityShowWaiting(event, resolution = {}) {
    if (resolution?.seriesComplete || normalizeCompletion(event)) {
      const stored = state.events.find(item => eventId(item) === String(state.selectedEventId));
      if (stored && stored !== event) Object.assign(stored, event);
      state.liveMatchIds.delete(String(state.selectedEventId));
      renderSchedule();
      queueMicrotask(() => transitionSelectedMatchToHistory(stored || event));
      return;
    }
    return baseShowWaiting(event, resolution);
  };

  const baseLoadSchedule = loadSchedule;
  loadSchedule = async function integrityLoadSchedule(...args) {
    const result = await baseLoadSchedule(...args);
    const filtered = [];
    for (const event of state.events || []) {
      normalizeCompletion(event);
      if (seriesComplete(event)) state.liveMatchIds.delete(eventId(event));
      if (!placeholderEvent(event)) filtered.push(event);
    }
    state.events = filtered;
    renderSchedule();

    const selected = selectedScheduleEvent();
    if (selected && seriesComplete(selected) && state.selectedMatchState !== 'completed') {
      await transitionSelectedMatchToHistory(selected);
    }
    return result;
  };

  loadSchedule(true).catch(error => console.warn('Schedule integrity refresh failed:', error));
})();
