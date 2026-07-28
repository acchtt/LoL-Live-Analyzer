// Persistent game navigation for active multi-game series.
(() => {
  'use strict';

  const DETAILS_REFRESH_MS = 30000;
  const NAV_ID = 'liveSeriesGameNav';
  let detailsPromise = null;

  state.liveSeries = state.liveSeries || null;
  state.seriesArchiveMode = Boolean(state.seriesArchiveMode);
  state.seriesArchiveLoading = false;

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function finiteScore(team = {}) {
    const value = team?.result?.gameWins;
    const parsed = Number(value);
    return value === undefined || value === null || !Number.isFinite(parsed) || parsed < 0
      ? null
      : parsed;
  }

  function gameNumber(game = {}, index = 0) {
    const parsed = Number(game.number);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 1;
  }

  function hasCompletionEvidence(game = {}) {
    return game.state === 'completed' || (Array.isArray(game.vods) && game.vods.length > 0);
  }

  function playedSeriesGames(event = {}, currentGameId = '') {
    const rawGames = (Array.isArray(event?.match?.games) ? event.match.games : [])
      .filter(game => game?.id)
      .sort((left, right) => gameNumber(left) - gameNumber(right));
    if (!rawGames.length) return [];

    const currentIndex = rawGames.findIndex(game => String(game.id) === String(currentGameId));
    const scores = (event?.match?.teams || []).map(finiteScore);
    const scoreCount = scores.length >= 2 && scores.every(score => score !== null)
      ? scores.reduce((sum, score) => sum + score, 0)
      : 0;
    const evidenceCount = rawGames.reduce((highest, game, index) => (
      hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index)) : highest
    ), 0);
    const playedCount = Math.min(rawGames.length, Math.max(scoreCount, evidenceCount, currentIndex + 1));

    return playedCount > 0 ? rawGames.slice(0, playedCount) : rawGames.filter(hasCompletionEvidence);
  }

  function resetSeries() {
    state.liveSeries = null;
    state.seriesArchiveMode = false;
    state.seriesArchiveLoading = false;
    document.getElementById(NAV_ID)?.remove();
  }

  function selectedGameLabel(game, index) {
    const number = gameNumber(game, index);
    const liveId = String(state.liveSeries?.liveGameId || '');
    const gameId = String(game.id || '');
    if (gameId === liveId) return `Game ${number} · Live`;
    if (hasCompletionEvidence(game) || gameId !== liveId) return `Game ${number} · Final`;
    return `Game ${number}`;
  }

  function renderSeriesNavigation() {
    document.getElementById(NAV_ID)?.remove();

    const context = state.liveSeries;
    const isActiveSeries = state.selectedMatchState === 'inProgress' || state.seriesArchiveMode;
    if (!isActiveSeries || !context || String(context.matchId) !== String(state.selectedEventId)) return;
    if (!Array.isArray(context.games) || context.games.length <= 1) return;

    const shell = gameContent.querySelector('.analysis-v2-shell, .analysis-shell');
    if (!shell) return;

    const nav = document.createElement('section');
    nav.id = NAV_ID;
    nav.className = 'live-series-nav';
    nav.setAttribute('aria-label', 'Series games');

    const activeId = String(state.selectedGameId || '');
    nav.innerHTML = `
      <div class="live-series-nav-copy">
        <span>Series games</span>
        <strong>${context.games.length} played / active</strong>
      </div>
      <div class="live-series-nav-buttons" role="tablist" aria-label="Series game navigation">
        ${context.games.map((game, index) => {
          const id = String(game.id || '');
          const selected = id === activeId;
          const isLive = id === String(context.liveGameId || '');
          return `<button class="live-series-game ${selected ? 'is-selected' : ''} ${isLive ? 'is-live' : ''}" data-live-series-game-id="${escapeHtml(id)}" type="button" role="tab" aria-selected="${selected}">
            <span>Game ${gameNumber(game, index)}</span>
            <small>${isLive ? 'Live' : 'Final'}</small>
          </button>`;
        }).join('')}
      </div>
      ${state.seriesArchiveMode ? '<button class="live-series-return" data-return-live-game type="button">Return to live game</button>' : ''}`;

    const header = shell.querySelector('.analysis-v2-header, .analysis-header');
    if (header) header.insertAdjacentElement('afterend', nav);
    else shell.prepend(nav);
  }

  async function refreshSeriesDetails(force = false) {
    const matchId = String(state.selectedEventId || '');
    const active = state.selectedMatchState === 'inProgress' || state.seriesArchiveMode;
    if (!matchId || !active) return;

    const existing = state.liveSeries;
    const now = Date.now();
    const liveGameId = state.seriesArchiveMode
      ? String(existing?.liveGameId || '')
      : String(state.selectedGameId || existing?.liveGameId || '');

    if (
      !force &&
      existing &&
      String(existing.matchId) === matchId &&
      now - Number(existing.fetchedAt || 0) < DETAILS_REFRESH_MS
    ) {
      if (liveGameId) existing.liveGameId = liveGameId;
      renderSeriesNavigation();
      return;
    }

    if (detailsPromise) return detailsPromise;
    detailsPromise = (async () => {
      try {
        const payload = await api(`/api/match-details?matchId=${encodeURIComponent(matchId)}`);
        if (String(state.selectedEventId || '') !== matchId) return;
        const event = payload.data?.event || payload.event || payload.data || payload;
        const currentId = liveGameId || String(state.selectedGameId || '');
        state.liveSeries = {
          matchId,
          event,
          games: playedSeriesGames(event, currentId),
          liveGameId: currentId,
          fetchedAt: Date.now()
        };
        renderSeriesNavigation();
      } catch (error) {
        console.warn('Series game navigation unavailable:', error);
      } finally {
        detailsPromise = null;
      }
    })();
    return detailsPromise;
  }

  const previousRenderGame = renderGame;
  renderGame = function liveSeriesAwareRenderGame(...args) {
    const result = previousRenderGame(...args);
    if (!state.seriesArchiveMode && state.selectedMatchState === 'inProgress' && state.selectedGameId) {
      state.liveSeries = {
        ...(state.liveSeries || {}),
        matchId: String(state.selectedEventId || ''),
        liveGameId: String(state.selectedGameId),
        games: state.liveSeries?.games || [],
        fetchedAt: state.liveSeries?.fetchedAt || 0
      };
    }
    queueMicrotask(() => {
      renderSeriesNavigation();
      refreshSeriesDetails().catch(() => {});
    });
    return result;
  };

  const previousLoadGame = loadGame;
  loadGame = async function liveSeriesAwareLoadGame(...args) {
    if (state.seriesArchiveMode && state.selectedMatchState === 'inProgress' && !state.seriesArchiveLoading) return;
    return previousLoadGame(...args);
  };

  const previousSelectEvent = selectEvent;
  selectEvent = async function liveSeriesAwareSelectEvent(id) {
    if (String(id) !== String(state.selectedEventId || '')) resetSeries();
    return previousSelectEvent(id);
  };

  gameContent.addEventListener('click', async event => {
    const returnButton = event.target.closest('[data-return-live-game]');
    if (returnButton) {
      const liveGameId = String(state.liveSeries?.liveGameId || '');
      if (!liveGameId) return;

      state.seriesArchiveMode = false;
      state.seriesArchiveLoading = false;
      state.selectedMatchState = 'inProgress';
      state.selectedGameId = liveGameId;
      setJsonEndpoint(liveGameId, false);
      setConnection('Returning to live game…', '');
      await loadGame();
      startPolling();
      await refreshSeriesDetails(true);
      return;
    }

    const button = event.target.closest('[data-live-series-game-id]');
    const gameId = String(button?.dataset.liveSeriesGameId || '');
    if (!gameId || !state.liveSeries) return;
    if (gameId === String(state.selectedGameId || '')) return;

    if (gameId === String(state.liveSeries.liveGameId || '')) {
      state.seriesArchiveMode = false;
      state.selectedMatchState = 'inProgress';
      state.selectedGameId = gameId;
      setJsonEndpoint(gameId, false);
      await loadGame();
      startPolling();
      renderSeriesNavigation();
      return;
    }

    const game = state.liveSeries.games.find(item => String(item.id) === gameId);
    const number = game ? gameNumber(game, state.liveSeries.games.indexOf(game)) : '?';
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.seriesArchiveMode = true;
    state.seriesArchiveLoading = true;
    state.selectedGameId = gameId;
    state.selectedMatchState = 'completed';
    setJsonEndpoint(gameId, true);
    setConnection(`Loading Game ${number} archive…`, '');

    try {
      await loadGame();
    } finally {
      state.selectedMatchState = 'inProgress';
      state.seriesArchiveLoading = false;
      renderSeriesNavigation();
    }
    setConnection(`Series archive · Game ${number} · live game paused`, '');
  });

  globalThis.RiftPulseLiveSeries = { playedSeriesGames };
})();
