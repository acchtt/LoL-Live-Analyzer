// Clean series panel implementation. Replaces every previous live/history series renderer.
(() => {
  'use strict';

  const root = document.getElementById('gameContent');
  if (!root) return;

  const PANEL_ID = 'seriesPanelClean';
  const DETAILS_REFRESH_MS = 30000;
  const LEGACY_SELECTOR = [
    '#liveSeriesGameNav',
    '#historySeriesSummary',
    '#unifiedSeriesPanel',
    '.series-hero',
    '.rp-series-panel'
  ].join(',');

  let detailsPromise = null;
  let rendering = false;
  let scheduled = false;

  state.liveSeries = state.liveSeries || null;
  state.seriesArchiveMode = Boolean(state.seriesArchiveMode);
  state.seriesArchiveLoading = false;

  function finiteScore(team = {}) {
    const raw = team?.result?.gameWins;
    const value = Number(raw);
    return raw === undefined || raw === null || !Number.isFinite(value) || value < 0 ? null : value;
  }

  function gameNumber(game = {}, index = 0) {
    const value = Number(game?.number);
    return Number.isInteger(value) && value > 0 ? value : index + 1;
  }

  function hasCompletionEvidence(game = {}) {
    return game?.state === 'completed' || (Array.isArray(game?.vods) && game.vods.length > 0);
  }

  function orderedGames(event = {}) {
    return (Array.isArray(event?.match?.games) ? event.match.games : [])
      .filter(game => game?.id)
      .sort((left, right) => gameNumber(left) - gameNumber(right));
  }

  function seriesLength(event = {}, games = []) {
    const configured = Number(event?.match?.strategy?.count);
    if ([1, 2, 3, 5].includes(configured)) return configured;

    const highest = games.reduce(
      (current, game, index) => Math.max(current, gameNumber(game, index)),
      0
    );
    if ([1, 2, 3, 5].includes(highest)) return highest;
    return Math.max(1, Math.min(5, highest || games.length || 1));
  }

  function playedGames(event = {}) {
    const games = orderedGames(event);
    if (!games.length) return [];

    const scores = (event?.match?.teams || []).map(finiteScore);
    const scoreCount = scores.length >= 2 && scores.every(score => score !== null)
      ? scores.reduce((total, score) => total + score, 0)
      : 0;
    const evidenceCount = games.reduce((highest, game, index) => (
      hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index)) : highest
    ), 0);
    const count = Math.min(games.length, Math.max(scoreCount, evidenceCount));
    return count > 0 ? games.slice(0, count) : games.filter(hasCompletionEvidence);
  }

  function playedSeriesGames(event = {}, currentGameId = '') {
    const games = orderedGames(event);
    if (!games.length) return [];

    const currentIndex = games.findIndex(game => String(game?.id || '') === String(currentGameId));
    const scores = (event?.match?.teams || []).map(finiteScore);
    const scoreCount = scores.length >= 2 && scores.every(score => score !== null)
      ? scores.reduce((total, score) => total + score, 0)
      : 0;
    const evidenceCount = games.reduce((highest, game, index) => (
      hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index)) : highest
    ), 0);
    const count = Math.min(games.length, Math.max(scoreCount, evidenceCount, currentIndex + 1));
    return count > 0 ? games.slice(0, count) : games.filter(hasCompletionEvidence);
  }

  function inferredCurrentGameId(event = {}, selectedGameId = '') {
    const games = orderedGames(event);
    if (!games.length) return '';

    if (selectedGameId && games.some(game => String(game?.id || '') === String(selectedGameId))) {
      return String(selectedGameId);
    }

    const reported = [...games]
      .filter(game => game?.state === 'inProgress')
      .sort((left, right) => gameNumber(right) - gameNumber(left))[0];
    if (reported?.id) return String(reported.id);

    const scores = (event?.match?.teams || []).map(finiteScore);
    const scoreCount = scores.length >= 2 && scores.every(score => score !== null)
      ? scores.reduce((total, score) => total + score, 0)
      : 0;
    const evidenceCount = games.reduce((highest, game, index) => (
      hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index)) : highest
    ), 0);
    const nextNumber = Math.max(scoreCount, evidenceCount) + 1;
    return String(games.find((game, index) => gameNumber(game, index) === nextNumber)?.id || '');
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

  function gameForSlot(games, number, context, activeId) {
    const matches = games.filter((game, index) => gameNumber(game, index) === number);
    if (!matches.length) return null;
    const preferred = [activeId, context?.liveGameId, context?.currentGameId].map(String).filter(Boolean);
    for (const id of preferred) {
      const match = matches.find(game => String(game?.id || '') === id);
      if (match) return match;
    }
    return matches.find(hasCompletionEvidence) || matches[0];
  }

  function currentSlotNumber(games, context, activeId, format) {
    const preferred = [activeId, context?.currentGameId, context?.liveGameId].map(String).filter(Boolean);
    for (const id of preferred) {
      const index = games.findIndex(game => String(game?.id || '') === id);
      if (index >= 0) return Math.min(format, gameNumber(games[index], index));
    }
    const completed = (context?.games || []).filter(hasCompletionEvidence).length;
    return Math.max(1, Math.min(format, completed + 1));
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

  function resetSeries() {
    state.liveSeries = null;
    state.seriesArchiveMode = false;
    state.seriesArchiveLoading = false;
    document.getElementById(PANEL_ID)?.remove();
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

  function liveModel() {
    const context = state.liveSeries;
    const selectedState = String(state.selectedMatchState || '');
    const archiveMode = Boolean(state.seriesArchiveMode);
    const active = ['inProgress', 'postGame'].includes(selectedState) || archiveMode;
    if (!active || !context || String(context.matchId || '') !== String(state.selectedEventId || '')) return null;

    const event = context.event || {};
    const allGames = orderedGames(event);
    const availableGames = allGames.length ? allGames : (context.games || []);
    if (!availableGames.length) return null;

    const format = seriesLength(event, availableGames);
    const activeId = String(state.selectedGameId || '');
    const teams = eventTeams(event);
    const left = teams[0] || {};
    const right = teams[1] || {};
    const leftScore = finiteScore(left);
    const rightScore = finiteScore(right);
    const scoreCount = [leftScore, rightScore].every(score => score !== null) ? leftScore + rightScore : 0;
    const evidenceCount = (context.games || []).filter(hasCompletionEvidence).length;
    const playedCount = Math.min(format, Math.max(scoreCount, evidenceCount));
    const currentNumber = currentSlotNumber(availableGames, context, activeId, format);
    const telemetry = telemetryState(activeId);
    const pending = selectedState === 'postGame';
    const stale = !archiveMode && !pending && telemetry.status === 'telemetry_stale';
    const partial = !archiveMode && !pending && telemetry.status === 'degraded';
    const pregame = !archiveMode && !pending && telemetry.status === 'pregame';
    const tone = archiveMode ? 'archive' : pending || partial || pregame ? 'waiting' : stale ? 'stale' : 'live';
    const mode = archiveMode
      ? 'Series archive'
      : pending
        ? 'Result pending'
        : stale
          ? 'Stale context'
          : partial
            ? 'Partial telemetry'
            : pregame
              ? 'Waiting for gameplay'
              : 'Live series';
    const scoreLabel = archiveMode ? 'Archive' : pending ? 'Pending' : stale ? 'Stale' : partial ? 'Context' : pregame ? 'Waiting' : 'Live';
    const ageText = telemetry.age === null ? '' : `${Math.round(telemetry.age)}s old · `;
    const scoreDetail = pending
      ? `Game ${currentNumber} result pending`
      : stale
        ? `${ageText}Game ${currentNumber}`
        : pregame
          ? `Game ${currentNumber} has not started`
          : `${playedCount} completed · Game ${currentNumber}`;

    const games = Array.from({ length: format }, (_, index) => {
      const number = index + 1;
      const game = gameForSlot(availableGames, number, context, activeId);
      const id = String(game?.id || '');
      const selected = Boolean(id) && id === activeId;
      const currentStale = stale && selected;
      const live = Boolean(id) && id === String(context.liveGameId || '') && !currentStale;
      const complete = Boolean(game) && hasCompletionEvidence(game);
      const waiting = Boolean(id) && !live && !complete && id === String(context.currentGameId || '') && !currentStale;
      const locked = !id || (!complete && !live && !waiting && !currentStale);
      return {
        number,
        id,
        selected,
        disabled: waiting || locked,
        tone: currentStale ? 'stale' : live ? 'live' : waiting ? 'waiting' : complete ? 'complete' : 'locked',
        label: currentStale ? 'Stale' : live ? 'Live' : selected && archiveMode ? 'Selected' : complete ? 'Final' : waiting ? 'Waiting' : 'Locked',
        kind: 'live'
      };
    });

    return {
      variant: archiveMode ? 'archive' : 'live',
      mode,
      format,
      league: event?.league?.name || event?.league?.slug || 'League of Legends',
      context: `Game ${currentNumber}`,
      teams: [left, right],
      score: { label: scoreLabel, left: leftScore ?? '—', right: rightScore ?? '—', detail: scoreDetail, tone },
      status: {
        label: archiveMode
          ? 'Archive view'
          : pending
            ? 'Result pending'
            : stale
              ? 'Stale frame'
              : partial
                ? 'Partial telemetry'
                : pregame
                  ? 'Waiting for stats'
                  : 'Live telemetry',
        tone
      },
      canReturnLive: archiveMode,
      games
    };
  }

  function historyModel() {
    if (state.seriesArchiveMode || String(state.selectedMatchState || '') !== 'completed' || !state.historyMatch) return null;

    const event = state.historyMatch.event || selectedScheduleEvent() || {};
    const teams = eventTeams(event);
    const left = teams[0] || {};
    const right = teams[1] || {};
    const games = Array.isArray(state.historyMatch.games) ? state.historyMatch.games : [];
    const available = games.length > 0;
    const format = seriesLength(event, games);
    const selectedId = String(state.selectedGameId || '');
    const selectedGame = games.find(game => String(game?.id || '') === selectedId) || games[games.length - 1] || null;
    const selectedNumber = selectedGame ? gameNumber(selectedGame, games.indexOf(selectedGame)) : null;
    const leftScore = finiteScore(left);
    const rightScore = finiteScore(right);
    const gameMap = new Map(games.map((game, index) => [gameNumber(game, index), game]));

    return {
      variant: available ? 'history' : 'result-only',
      mode: 'Match history',
      format,
      league: event?.league?.name || event?.league?.slug || 'League of Legends',
      context: selectedNumber ? `Game ${selectedNumber}` : 'Result only',
      teams: [left, right],
      score: {
        label: available ? 'Final' : 'No result',
        left: available ? (leftScore ?? '—') : '—',
        right: available ? (rightScore ?? '—') : '—',
        detail: available ? `${games.length} played game${games.length === 1 ? '' : 's'}` : 'No completed games',
        tone: available ? 'archive' : 'unavailable'
      },
      status: { label: available ? 'Verified archive' : 'Archive unavailable', tone: available ? 'archive' : 'unavailable' },
      canReturnLive: false,
      games: available
        ? Array.from({ length: format }, (_, index) => {
            const number = index + 1;
            const game = gameMap.get(number) || null;
            const id = String(game?.id || '');
            const selected = Boolean(id) && id === selectedId;
            return {
              number,
              id,
              selected,
              disabled: !id,
              tone: selected ? 'selected' : id ? 'complete' : 'locked',
              label: selected ? 'Selected' : id ? 'Final' : 'Not played',
              kind: 'history'
            };
          })
        : [],
      empty: available ? null : {
        title: 'Game archive unavailable',
        detail: 'Riot returned the match result without archived game IDs.'
      }
    };
  }

  function createLogo(team = {}) {
    const box = document.createElement('span');
    box.className = 'series-clean-logo';
    const url = String(team?.image || '').trim();
    if (/^https?:\/\//i.test(url)) {
      const image = document.createElement('img');
      image.src = url.replace(/^http:\/\//i, 'https://');
      image.alt = '';
      image.loading = 'lazy';
      box.append(image);
    } else {
      box.textContent = String(team?.name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase() || '?';
    }
    return box;
  }

  function createTeam(team, side) {
    const card = document.createElement('article');
    card.className = `series-clean-team is-${side}`;
    const copy = document.createElement('span');
    copy.className = 'series-clean-team-copy';
    const name = document.createElement('strong');
    name.textContent = team?.name || (side === 'left' ? 'Team 1' : 'Team 2');
    copy.append(name);
    const logo = createLogo(team);
    if (side === 'left') card.append(logo, copy);
    else card.append(copy, logo);
    return card;
  }

  function createScore(score) {
    const block = document.createElement('div');
    block.className = `series-clean-score is-${score.tone}`;
    const label = document.createElement('span');
    label.className = 'series-clean-score-label';
    label.textContent = score.label;
    const value = document.createElement('strong');
    value.className = 'series-clean-score-value';
    const left = document.createElement('span');
    left.textContent = String(score.left);
    const separator = document.createElement('i');
    separator.textContent = '—';
    separator.setAttribute('aria-hidden', 'true');
    const right = document.createElement('span');
    right.textContent = String(score.right);
    value.append(left, separator, right);
    const detail = document.createElement('small');
    detail.textContent = score.detail;
    block.append(label, value, detail);
    return block;
  }

  function createPanel(model) {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = `series-clean-panel is-${model.variant}`;
    panel.dataset.signature = JSON.stringify(model);
    panel.setAttribute('aria-label', `${model.mode}, best of ${model.format}`);

    const top = document.createElement('div');
    top.className = 'series-clean-top';
    const identity = document.createElement('div');
    identity.className = 'series-clean-identity';
    const mode = document.createElement('strong');
    mode.textContent = model.mode;
    const format = document.createElement('small');
    format.textContent = `Best of ${model.format}`;
    identity.append(mode, format);

    const context = document.createElement('div');
    context.className = 'series-clean-context';
    const league = document.createElement('strong');
    league.textContent = model.league;
    const divider = document.createElement('i');
    divider.textContent = '•';
    const selected = document.createElement('span');
    selected.textContent = model.context;
    context.append(league, divider, selected);

    const controls = document.createElement('div');
    controls.className = 'series-clean-controls';
    const status = document.createElement('span');
    status.className = `series-clean-status is-${model.status.tone}`;
    const dot = document.createElement('i');
    const statusLabel = document.createElement('span');
    statusLabel.textContent = model.status.label;
    status.append(dot, statusLabel);
    controls.append(status);
    if (model.canReturnLive) {
      const button = document.createElement('button');
      button.className = 'series-clean-return';
      button.type = 'button';
      button.dataset.seriesCleanReturnLive = '';
      button.textContent = 'Back to live';
      controls.append(button);
    }
    top.append(identity, context, controls);

    const matchup = document.createElement('div');
    matchup.className = 'series-clean-matchup';
    matchup.append(createTeam(model.teams[0] || {}, 'left'), createScore(model.score), createTeam(model.teams[1] || {}, 'right'));

    const bottom = document.createElement('div');
    bottom.className = 'series-clean-bottom';
    if (model.empty) {
      const empty = document.createElement('div');
      empty.className = 'series-clean-empty';
      const marker = document.createElement('span');
      marker.textContent = '!';
      marker.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = model.empty.title;
      const detail = document.createElement('small');
      detail.textContent = model.empty.detail;
      copy.append(title, detail);
      empty.append(marker, copy);
      bottom.append(empty);
    } else {
      const games = document.createElement('div');
      games.className = 'series-clean-games';
      games.style.setProperty('--series-clean-count', String(Math.max(1, model.games.length)));
      games.setAttribute('role', 'tablist');
      games.setAttribute('aria-label', 'Series game navigation');
      for (const game of model.games) {
        const button = document.createElement('button');
        button.className = `series-clean-game is-${game.tone}${game.selected ? ' is-selected' : ''}`;
        button.type = 'button';
        button.disabled = Boolean(game.disabled);
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(Boolean(game.selected)));
        if (game.disabled) button.setAttribute('aria-disabled', 'true');
        if (game.id) {
          if (game.kind === 'history') button.dataset.seriesCleanHistoryGameId = game.id;
          else button.dataset.seriesCleanLiveGameId = game.id;
        }
        const number = document.createElement('span');
        number.textContent = `Game ${game.number}`;
        const stateLabel = document.createElement('small');
        stateLabel.textContent = game.label;
        button.append(number, stateLabel);
        games.append(button);
      }
      bottom.append(games);
    }

    panel.append(top, matchup, bottom);
    return panel;
  }

  function removeLegacyPanels() {
    root.querySelectorAll(LEGACY_SELECTOR).forEach(element => element.remove());
  }

  function restoreHostShell() {
    const host = root.closest('.game-panel');
    root.classList.remove('is-result-only-history');
    if (!host) return;
    host.classList.add('panel', 'app-panel');
    host.classList.remove('is-result-only-history');
    delete host.dataset.historyShell;
  }

  function insertPanel(panel) {
    const shell = root.querySelector('.analysis-v2-shell, .analysis-shell');
    const header = shell?.querySelector('.analysis-v2-header, .analysis-header');
    if (header) header.insertAdjacentElement('beforebegin', panel);
    else if (shell) shell.prepend(panel);
    else root.prepend(panel);
  }

  function renderNow() {
    if (rendering) return;
    rendering = true;
    try {
      removeLegacyPanels();
      restoreHostShell();
      const model = liveModel() || historyModel();
      const existing = document.getElementById(PANEL_ID);
      if (!model) {
        existing?.remove();
        return;
      }
      const signature = JSON.stringify(model);
      if (existing?.dataset.signature === signature) return;
      existing?.remove();
      insertPanel(createPanel(model));
    } finally {
      rendering = false;
    }
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      renderNow();
    });
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

    if (!force && existing && String(existing.matchId || '') === matchId && now - Number(existing.fetchedAt || 0) < DETAILS_REFRESH_MS) {
      if (selectedId) {
        existing.liveGameId = selectedId;
        existing.currentGameId = selectedId;
      }
      scheduleRender();
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
        scheduleRender();
      } catch (error) {
        console.warn('Series details unavailable:', error);
      } finally {
        detailsPromise = null;
      }
    })();
    return detailsPromise;
  }

  const previousShowWaiting = showWaiting;
  showWaiting = function cleanSeriesShowWaiting(event, resolution = {}) {
    const result = previousShowWaiting(event, resolution);
    syncSeriesFromResolution(event, resolution);
    scheduleRender();
    return result;
  };

  const previousRenderGame = renderGame;
  renderGame = function cleanSeriesRenderGame(...args) {
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
    scheduleRender();
    refreshSeriesDetails().catch(() => {});
    return result;
  };

  const previousLoadGame = loadGame;
  loadGame = async function cleanSeriesLoadGame(...args) {
    if (state.seriesArchiveMode && state.selectedMatchState === 'inProgress' && !state.seriesArchiveLoading) return;
    return previousLoadGame(...args);
  };

  const previousSelectEvent = selectEvent;
  selectEvent = async function cleanSeriesSelectEvent(id) {
    if (String(id) !== String(state.selectedEventId || '')) {
      resetSeries();
      state.historyMatch = null;
      state.historyGameId = null;
    }
    return previousSelectEvent(id);
  };

  loadFinishedMatch = async function cleanSeriesLoadFinishedMatch(id) {
    resetSeries();
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Loading match history</strong><span>Finding completed games and archived final frames…</span></div>';

    const payload = await api(`/api/match-details?matchId=${encodeURIComponent(id)}`);
    const event = payload.data?.event || payload.event || payload.data || payload;
    const games = playedGames(event);
    const finalGame = games[games.length - 1] || null;

    state.historyMatch = { matchId: String(id), event, games, finalGame };
    state.selectedMatchState = 'completed';
    state.seriesArchiveMode = false;

    if (!finalGame?.id) {
      state.selectedGameId = null;
      state.historyGameId = null;
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      jsonPreview.textContent = JSON.stringify({
        status: 'history_without_game_telemetry',
        matchId: String(id),
        event
      }, null, 2);
      gameContent.innerHTML = '';
      scheduleRender();
      setConnection('History · result only · archive unavailable', '');
      return;
    }

    state.selectedGameId = String(finalGame.id);
    state.historyGameId = state.selectedGameId;
    setJsonEndpoint(state.selectedGameId, true);
    await loadGame();
    scheduleRender();
    setConnection(`History · Game ${finalGame.number || games.length} of ${games.length}`, '');
  };

  root.addEventListener('click', async event => {
    const returnButton = event.target.closest('[data-series-clean-return-live]');
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
      scheduleRender();
      return;
    }

    const historyButton = event.target.closest('[data-series-clean-history-game-id]');
    if (historyButton && state.selectedMatchState === 'completed') {
      const gameId = String(historyButton.dataset.seriesCleanHistoryGameId || '');
      if (!gameId || gameId === String(state.selectedGameId || '')) return;
      state.selectedGameId = gameId;
      state.historyGameId = gameId;
      setJsonEndpoint(gameId, true);
      setConnection('Loading archived game…', '');
      await loadGame();
      const game = state.historyMatch?.games?.find(item => String(item?.id || '') === gameId);
      setConnection(`History · Game ${game?.number || '?'} final snapshot`, '');
      scheduleRender();
      return;
    }

    const liveButton = event.target.closest('[data-series-clean-live-game-id]');
    const gameId = String(liveButton?.dataset.seriesCleanLiveGameId || '');
    if (!gameId || !state.liveSeries || liveButton.disabled || gameId === String(state.selectedGameId || '')) return;

    if (gameId === String(state.liveSeries.liveGameId || '')) {
      state.seriesArchiveMode = false;
      state.selectedMatchState = 'inProgress';
      state.selectedGameId = gameId;
      setJsonEndpoint(gameId, false);
      await loadGame();
      startPolling();
      scheduleRender();
      return;
    }

    const allGames = orderedGames(state.liveSeries.event);
    const game = (state.liveSeries.games || []).find(item => String(item?.id || '') === gameId)
      || allGames.find(item => String(item?.id || '') === gameId);
    const number = game ? gameNumber(game, allGames.indexOf(game)) : '?';
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
      scheduleRender();
    }
    setConnection(`Series archive · Game ${number} · active series paused`, '');
  });

  const observer = new MutationObserver(scheduleRender);
  observer.observe(root, { childList: true, subtree: true });
  window.setInterval(() => {
    scheduleRender();
    refreshSeriesDetails().catch(() => {});
  }, 1500);

  queueMicrotask(scheduleRender);
  globalThis.RiftPulseSeriesPanelClean = {
    render: scheduleRender,
    playedGames,
    playedSeriesGames,
    seriesLength,
    syncSeriesFromResolution
  };
})();
