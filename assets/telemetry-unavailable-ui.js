// Keeps the live-series header honest when Riot is not publishing telemetry.
(() => {
  'use strict';

  state.telemetryUnavailable = Boolean(state.telemetryUnavailable);

  function patchSeriesHeader() {
    if (!state.telemetryUnavailable) return;
    const nav = document.querySelector('#liveSeriesGameNav');
    if (!nav) return;

    nav.classList.add('is-telemetry-unavailable');

    const kicker = nav.querySelector('.series-hero-kicker strong');
    if (kicker) kicker.textContent = 'Broadcast live';

    const score = nav.querySelector('.series-hero-score');
    if (score) {
      score.classList.remove('is-live', 'is-stale');
      score.classList.add('is-pending');
      const label = score.querySelector(':scope > span');
      if (label) label.textContent = 'No telemetry';
      const detail = score.querySelector(':scope > small');
      if (detail) detail.textContent = 'Riot live stats unavailable';
    }

    const badge = nav.querySelector('.series-hero-badge');
    if (badge) {
      badge.classList.remove('is-live', 'is-stale');
      badge.classList.add('is-pending');
      const text = badge.querySelector('span');
      if (text) text.textContent = 'Telemetry unavailable';
    }

    const current = nav.querySelector('.series-hero-game.is-live, .series-hero-game.is-waiting, .series-hero-game.is-selected');
    if (current) {
      current.classList.remove('is-live');
      current.classList.add('is-waiting');
      const status = current.querySelector('small');
      if (status) status.textContent = 'No feed';
    }
  }

  function patchAfterSeriesRender() {
    queueMicrotask(() => queueMicrotask(patchSeriesHeader));
    setTimeout(patchSeriesHeader, 0);
  }

  const baseShowTelemetryUnavailable = showTelemetryUnavailable;
  showTelemetryUnavailable = function honestTelemetryUnavailable(...args) {
    state.telemetryUnavailable = true;
    const result = baseShowTelemetryUnavailable(...args);
    patchAfterSeriesRender();
    return result;
  };

  const baseRenderGame = renderGame;
  renderGame = function clearUnavailableOnSnapshot(...args) {
    state.telemetryUnavailable = false;
    return baseRenderGame(...args);
  };

  const baseShowWaiting = showWaiting;
  showWaiting = function clearUnavailableBeforeResolution(...args) {
    state.telemetryUnavailable = false;
    const result = baseShowWaiting(...args);
    if (state.telemetryUnavailable) patchAfterSeriesRender();
    return result;
  };

  const baseShowUpcoming = showUpcoming;
  showUpcoming = function clearUnavailableForUpcoming(...args) {
    state.telemetryUnavailable = false;
    return baseShowUpcoming(...args);
  };

  const baseSelectEvent = selectEvent;
  selectEvent = async function clearUnavailableOnSelection(...args) {
    state.telemetryUnavailable = false;
    return baseSelectEvent(...args);
  };
})();