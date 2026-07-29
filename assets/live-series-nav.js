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

  function seriesLength(event = {}, games = []) {
    const configured = Number(event?.match?.strategy?.count);
    if ([1, 2, 3, 5].includes(configured)) return configured;

    const highestNumber = games.reduce(
      (highest, game, index) => Math.max(highest, gameNumber(game, index)),
      0
    );
    if ([1, 2, 3, 5].includes(highestNumber)) return highestNumber;
    return Math.max(1, Math.min(5, highestNumber || games.length || 1));
  }

  function hasCompletionEvidence(game = {}) {
    return game.state === 'completed' || (Array.isArray(game.vods) && game.vods.length > 0);
  }

  function orderedGames(event = {}) {
    return (Array.isArray(event?.match?.games) ? event.match.games : [])
      .filter(game => game?.id)
      .sort((left, right) => gameNumber(left) - gameNumber(right));
  }

  function playedSeriesGames(event = {}, currentGameId = '') {
    const rawGames = orderedGames(event);
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

  function inferredCurrentGameId(event = {}, selectedGameId = '') {
    const games = orderedGames(event);
    if (!games.length) return '';

    if (selectedGameId && games.some(game => String(game.id) === String(selectedGameId))) {
      return String(selectedGameId);
    }

    const reported = [...games]
      .filter(game => game.state === 'inProgress')
      .sort((left, right) => gameNumber(right) - gameNumber(left))[0];
    if (reported?.id) return String(reported.id);

    const scores = (event?.match?.teams || []).map(finiteScore);
    const scoreCount = scores.length >= 2 && scores.every(score => score !== null)
      ? scores.reduce((sum, score) => sum + score, 0)
      : 0;
    const evidenceCount = games.reduce((highest, game, index) => (
      hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index)) : highest
    ), 0);
    const nextNumber = Math.max(scoreCount, evidenceCount) + 1;
    const next = games.find((game, index) => gameNumber(game, index) === nextNumber);
    return next?.id ? String(next.id) : '';
  }

  function resetSeries() {
    state.liveSeries = null;
    state.seriesArchiveMode = false;
    state.seriesArchiveLoading = false;
    document.getElementById(NAV_ID)?.remove();
  }

  function seriesEvent(event = {}, games = []) {
    return {
      ...event,
      match: {
        ...(event?.match || {}),
        games: Array.isArray(games) && games.length ? games : (event?.match?.games || [])
      }
    };
  }

  function syncSeriesFromResolution(event = {}, resolution = {}) {
    const matchId = String(state.selectedEventId || event?.match?.id || event?.id || '');
    if (!matchId) return;

    const resolvedEvent = seriesEvent(
      resolution.event || event || selectedScheduleEvent() || {},
      resolution.games || []
    );
    const selectedId = String(resolution.selectedGame?.id || '');
    const currentGameId = inferredCurrentGameId(resolvedEvent, selectedId);
    const previous = state.liveSeries;

    state.liveSeries = {
      matchId,
      event: resolvedEvent,
      games: playedSeriesGames(resolvedEvent, currentGameId),
      liveGameId: selectedId || (state.seriesArchiveMode ? String(previous?.liveGameId || '') : ''),
      currentGameId,
      fetchedAt: Date.now()
    };
  }

  function gameForSlot(games, number, context, activeId) {
    const matches = games.filter((game, index) => gameNumber(game, index) === number);
    if (!matches.length) return null;
    const priorityIds = [activeId, context.liveGameId, context.currentGameId].map(String).filter(Boolean);
    for (const id of priorityIds) {
      const match = matches.find(game => String(game.id || '') === id);
      if (match) return match;
    }
    return matches.find(hasCompletionEvidence) || matches[0];
  }

  function renderSeriesNavigation() {
    document.getElementById(NAV_ID)?.remove();

    const context = state.liveSeries;
    const isActiveSeries = ['inProgress', 'postGame'].includes(state.selectedMatchState) || state.seriesArchiveMode;
    if (!isActiveSeries || !context || String(context.matchId) !== String(state.selectedEventId)) return;

    const allGames = orderedGames(context.event);
    const availableGames = allGames.length ? allGames : (context.games || []);
    if (!availableGames.length) return;
    const format = seriesLength(context.event, availableGames);

    const shell = gameContent.querySelector('.analysis-v2-shell, .analysis-shell');
    const waitingView = gameContent.querySelector('.hero-empty, .analysis-empty');
    if (!shell && !waitingView) return;

    const nav = document.createElement('section');
    nav.id = NAV_ID;
    nav.className = `live-series-nav ${shell ? '' : 'is-waiting'}`.trim();
    nav.dataset.seriesLength = String(format);
    nav.setAttribute('aria-label', `Best of ${format} series games`);

    const activeId = String(state.selectedGameId || '');
    const playedCount = context.games.filter(hasCompletionEvidence).length;
    nav.innerHTML = `
      <div class="live-series-nav-copy">
        <span>BO${format} series</span>
        <strong>${playedCount} played · ${format} slot${format === 1 ? '' : 's'}</strong>
      </div>
      <div class="live-series-nav-buttons" role="tablist" aria-label="Series game navigation">
        ${Array.from({ length: format }, (_, index) => {
          const number = index + 1;
          const game = gameForSlot(availableGames, number, context, activeId);
          const id = String(game?.id || '');
          const selected = Boolean(id) && id === activeId;
          const isLive = Boolean(id) && id === String(context.liveGameId || '');
          const completed = Boolean(game) && hasCompletionEvidence(game);
          const isWaiting = Boolean(id) && !isLive && !completed && id === String(context.currentGameId || '');
          const isLocked = !id || (!completed && !isLive && !isWaiting);
          const label = isLive
            ? 'Live'
            : selected && state.seriesArchiveMode
              ? 'Selected'
              : completed
                ? 'Final'
                : isWaiting
                  ? 'Waiting'
                  : 'Locked';
          const disabled = isWaiting || isLocked;
          return `<button class="live-series-game ${selected ? 'is-selected' : ''} ${completed ? 'is-complete' : ''} ${isLive ? 'is-live' : ''} ${isWaiting ? 'is-waiting' : ''} ${isLocked ? 'is-locked' : ''}" ${id ? `data-live-series-game-id="${escapeHtml(id)}"` : ''} type="button" role="tab" aria-selected="${selected}" ${disabled ? 'disabled aria-disabled="true"' : ''}>
            <span>Game ${number}</span>
            <small>${label}</small>
          </button>`;
        }).join('')}
      </div>
      ${state.seriesArchiveMode ? '<button class="live-series-return" data-return-live-game type="button">Return to series</button>' : ''}`;

    const header = shell?.querySelector('.analysis-v2-header, .analysis-header');
    if (header) header.insertAdjacentElement('afterend', nav);
    else if (shell) shell.prepend(nav);
    else gameContent.prepend(nav);
  }

  async function refreshSeriesDetails(force = false) {
    const matchId = String(state.selectedEventId || '');
    const active = ['inProgress', 'postGame'].includes(state.selectedMatchState) || state.seriesArchiveMode;
    if (!matchId || !active) return;

    const existing = state.liveSeries;
    const now = Date.now();
    const selectedId = state.seriesArchiveMode
      ? String(existing?.liveGameId || '')
      : String(state.selectedGameId || existing?.liveGameId || '');

    if (
      !force &&
      existing &&
      String(existing.matchId) === matchId &&
      now - Number(existing.fetchedAt || 0) < DETAILS_REFRESH_MS
    ) {
      if (selectedId) {
        existing.liveGameId = selectedId;
        existing.currentGameId = selectedId;
      }
      renderSeriesNavigation();
      return;
    }

    if (detailsPromise) return detailsPromise;
    detailsPromise = (async () => {
      try {
        const payload = await api(`/api/match-details?matchId=${encodeURIComponent(matchId)}`);
        if (String(state.selectedEventId || '') !== matchId) return;
        const event = payload.data?.event || payload.event || payload.data || payload;
        const resolvedEvent = seriesEvent(event, event?.match?.games || []);
        const currentGameId = inferredCurrentGameId(resolvedEvent, selectedId);
        state.liveSeries = {
          matchId,
          event: resolvedEvent,
          games: playedSeriesGames(resolvedEvent, currentGameId),
          liveGameId: selectedId,
          currentGameId,
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

  const previousShowWaiting = showWaiting;
  showWaiting = function liveSeriesAwareShowWaiting(event, resolution = {}) {
    const result = previousShowWaiting(event, resolution);
    syncSeriesFromResolution(event, resolution);
    queueMicrotask(renderSeriesNavigation);
    return result;
  };

  const previousRenderGame = renderGame;
  renderGame = function liveSeriesAwareRenderGame(...args) {
    const result = previousRenderGame(...args);
    if (!state.seriesArchiveMode && ['inProgress', 'postGame'].includes(state.selectedMatchState) && state.selectedGameId) {
      state.liveSeries = {
        ...(state.liveSeries || {}),
        matchId: String(state.selectedEventId || ''),
        liveGameId: String(state.selectedGameId),
        currentGameId: String(state.selectedGameId),
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
      state.seriesArchiveMode = false;
      state.seriesArchiveLoading = false;
      state.selectedMatchState = 'inProgress';

      if (!liveGameId) {
        state.selectedGameId = null;
        jsonUrl.value = '';
        copyJsonUrl.disabled = true;
        setConnection('Returning to active series…', '');
        await resolveLiveEvent(String(state.selectedEventId), true);
        await refreshSeriesDetails(true);
        return;
      }

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
    if (!gameId || !state.liveSeries || button.disabled) return;
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

    const game = state.liveSeries.games.find(item => String(item.id) === gameId)
      || orderedGames(state.liveSeries.event).find(item => String(item.id) === gameId);
    const number = game ? gameNumber(game, orderedGames(state.liveSeries.event).indexOf(game)) : '?';
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
    setConnection(`Series archive · Game ${number} · active series paused`, '');
  });

  globalThis.RiftPulseLiveSeries = {
    playedSeriesGames,
    seriesLength,
    syncSeriesFromResolution,
    renderSeriesNavigation
  };
})();