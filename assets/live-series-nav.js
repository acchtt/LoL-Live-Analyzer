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

  function safeImageUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
    return '';
  }

  function initials(name = '') {
    return String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || '?';
  }

  function teamLogo(team = {}) {
    const image = safeImageUrl(team?.image);
    return image
      ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
      : `<span>${escapeHtml(initials(team?.name))}</span>`;
  }

  function liveIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"></circle><path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2m14.2-14.2a10 10 0 0 1 0 14.2"></path></svg>';
  }

  function statusIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.4-2.7 8.2-7 10-4.3-1.8-7-5.6-7-10V6l7-3Z"></path><path d="M9 12h6"></path></svg>';
  }

  function contextIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"></path><circle cx="12" cy="12" r="8"></circle></svg>';
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

  function currentSlotNumber(games, context, activeId, format) {
    const priorityIds = [activeId, context.currentGameId, context.liveGameId].map(String).filter(Boolean);
    for (const id of priorityIds) {
      const index = games.findIndex(game => String(game?.id || '') === id);
      if (index >= 0) return Math.min(format, gameNumber(games[index], index));
    }
    const played = context.games.filter(hasCompletionEvidence).length;
    return Math.max(1, Math.min(format, played + 1));
  }

  function telemetryState(activeId) {
    const snapshot = state.lastSnapshot || {};
    const sameGame = Boolean(activeId) && String(snapshot?.source?.gameId || '') === String(activeId);
    if (!sameGame) return { status: '', age: null };
    const age = Number(snapshot?.quality?.frameAgeSeconds ?? snapshot?.source?.dataAgeSeconds);
    return {
      status: String(snapshot?.status || ''),
      age: Number.isFinite(age) ? age : null
    };
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
    nav.className = `live-series-nav series-hero series-hero--live ${shell ? '' : 'is-waiting'}`.trim();
    nav.dataset.seriesLength = String(format);
    nav.setAttribute('aria-label', `Best of ${format} series games`);

    const activeId = String(state.selectedGameId || '');
    const teams = context.event?.match?.teams || [];
    const a = teams[0] || {};
    const b = teams[1] || {};
    const aScore = finiteScore(a);
    const bScore = finiteScore(b);
    const scoreCount = [aScore, bScore].every(value => value !== null) ? aScore + bScore : 0;
    const evidenceCount = context.games.filter(hasCompletionEvidence).length;
    const playedCount = Math.min(format, Math.max(scoreCount, evidenceCount));
    const currentNumber = currentSlotNumber(availableGames, context, activeId, format);
    const league = context.event?.league?.name || context.event?.league?.slug || 'League of Legends';
    const snapshotState = telemetryState(activeId);
    const isPending = state.selectedMatchState === 'postGame';
    const isStale = !state.seriesArchiveMode && !isPending && snapshotState.status === 'telemetry_stale';
    const isPartial = !state.seriesArchiveMode && !isPending && snapshotState.status === 'degraded';
    const isPregame = !state.seriesArchiveMode && !isPending && snapshotState.status === 'pregame';
    const modeLabel = state.seriesArchiveMode
      ? 'Series archive'
      : isPending
        ? 'Result pending'
        : isStale
          ? 'Stale context'
          : isPartial
            ? 'Partial telemetry'
            : isPregame
              ? 'Waiting for gameplay'
              : 'Live series';
    const scoreLabel = state.seriesArchiveMode
      ? 'Archive'
      : isPending
        ? 'Pending'
        : isStale
          ? 'Stale'
          : isPartial
            ? 'Context'
            : isPregame
              ? 'Waiting'
              : 'Live';
    const ageText = snapshotState.age === null ? '' : `${Math.round(snapshotState.age)}s old · `;
    const scoreDetail = isPending
      ? `Game ${currentNumber} result pending`
      : isStale
        ? `${ageText}Game ${currentNumber}`
        : isPregame
          ? `Game ${currentNumber} has not started`
          : `${playedCount} completed · Game ${currentNumber}`;
    const badgeLabel = state.seriesArchiveMode
      ? 'Archive view'
      : isPending
        ? 'Result pending'
        : isStale
          ? 'Stale frame'
          : isPartial
            ? 'Partial telemetry'
            : isPregame
              ? 'Waiting for stats'
              : 'Live telemetry';
    const badgeClass = state.seriesArchiveMode
      ? 'is-archive'
      : isPending || isPartial || isPregame
        ? 'is-pending'
        : isStale
          ? 'is-stale'
          : 'is-live';
    const scoreClass = state.seriesArchiveMode
      ? 'is-archive'
      : isPending || isPartial || isPregame
        ? 'is-pending'
        : isStale
          ? 'is-stale'
          : 'is-live';

    nav.innerHTML = `
      <div class="series-hero-top">
        <div class="series-hero-main">
          <div class="series-hero-kicker">
            <span class="series-hero-kicker-icon">${liveIcon()}</span>
            <span><strong>${modeLabel}</strong><small>Best of ${format}</small></span>
          </div>
          <div class="series-hero-matchup">
            <article class="series-hero-team is-left">
              <span class="series-hero-team-logo">${teamLogo(a)}</span>
              <strong>${escapeHtml(a.name || 'Team 1')}</strong>
            </article>
            <span class="series-hero-versus">vs</span>
            <article class="series-hero-team is-right">
              <span class="series-hero-team-logo">${teamLogo(b)}</span>
              <strong>${escapeHtml(b.name || 'Team 2')}</strong>
            </article>
          </div>
        </div>
        <div class="series-hero-score ${scoreClass}">
          <span>${scoreLabel}</span>
          <strong>${aScore ?? '—'}–${bScore ?? '—'}</strong>
          <small>${scoreDetail}</small>
        </div>
      </div>
      <div class="series-hero-rail">
        <div class="live-series-nav-buttons series-hero-games" role="tablist" aria-label="Series game navigation">
          ${Array.from({ length: format }, (_, index) => {
            const number = index + 1;
            const game = gameForSlot(availableGames, number, context, activeId);
            const id = String(game?.id || '');
            const selected = Boolean(id) && id === activeId;
            const currentStale = isStale && selected;
            const isLive = Boolean(id) && id === String(context.liveGameId || '') && !currentStale;
            const completed = Boolean(game) && hasCompletionEvidence(game);
            const isWaiting = Boolean(id) && !isLive && !completed && id === String(context.currentGameId || '') && !currentStale;
            const isLocked = !id || (!completed && !isLive && !isWaiting && !currentStale);
            const label = currentStale
              ? 'Stale'
              : isLive
                ? 'Live'
                : selected && state.seriesArchiveMode
                  ? 'Selected'
                  : completed
                    ? 'Final'
                    : isWaiting
                      ? 'Waiting'
                      : 'Locked';
            const disabled = isWaiting || isLocked;
            return `<button class="live-series-game series-hero-game ${selected ? 'is-selected' : ''} ${completed ? 'is-complete' : ''} ${isLive ? 'is-live' : ''} ${currentStale ? 'is-stale' : ''} ${isWaiting ? 'is-waiting' : ''} ${isLocked ? 'is-locked' : ''}" ${id ? `data-live-series-game-id="${escapeHtml(id)}"` : ''} type="button" role="tab" aria-selected="${selected}" ${disabled ? 'disabled aria-disabled="true"' : ''}>
              <span>Game ${number}</span>
              <small>${label}</small>
            </button>`;
          }).join('')}
        </div>
        <div class="series-hero-actions">
          <span class="series-hero-badge ${badgeClass}">${statusIcon()}<span>${badgeLabel}</span></span>
          ${state.seriesArchiveMode ? '<button class="live-series-return" data-return-live-game type="button">Return to live</button>' : ''}
        </div>
      </div>
      <div class="series-hero-context">
        <span class="series-hero-context-icon">${contextIcon()}</span>
        <strong>${escapeHtml(league)}</strong><i>•</i><span>${modeLabel}</span><i>•</i><span>Game ${currentNumber}</span>
      </div>`;

    const header = shell?.querySelector('.analysis-v2-header, .analysis-header');
    if (header) header.insertAdjacentElement('beforebegin', nav);
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