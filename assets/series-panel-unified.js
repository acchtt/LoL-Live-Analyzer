// Unified visual renderer for live series, active-series archives, and match history.
(() => {
  'use strict';

  const root = document.getElementById('gameContent');
  if (!root) return;

  const PANEL_ID = 'unifiedSeriesPanel';
  const LEGACY_SELECTOR = '#liveSeriesGameNav, #historySeriesSummary, .series-hero';
  let scheduled = false;
  let rendering = false;

  function finiteScore(team = {}) {
    const value = team?.result?.gameWins;
    const parsed = Number(value);
    return value === undefined || value === null || !Number.isFinite(parsed) || parsed < 0
      ? null
      : parsed;
  }

  function gameNumber(game = {}, index = 0) {
    const parsed = Number(game?.number);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 1;
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

  function teamsFor(event = {}) {
    if (typeof globalThis.eventTeams === 'function') {
      const resolved = globalThis.eventTeams(event);
      if (Array.isArray(resolved) && resolved.length) return resolved;
    }
    return event?.match?.teams || event?.teams || [];
  }

  function currentSlotNumber(games, context, activeId, format) {
    const priorityIds = [activeId, context?.currentGameId, context?.liveGameId]
      .map(String)
      .filter(Boolean);
    for (const id of priorityIds) {
      const index = games.findIndex(game => String(game?.id || '') === id);
      if (index >= 0) return Math.min(format, gameNumber(games[index], index));
    }
    const played = (context?.games || []).filter(hasCompletionEvidence).length;
    return Math.max(1, Math.min(format, played + 1));
  }

  function gameForSlot(games, number, context, activeId) {
    const matches = games.filter((game, index) => gameNumber(game, index) === number);
    if (!matches.length) return null;
    const priorityIds = [activeId, context?.liveGameId, context?.currentGameId]
      .map(String)
      .filter(Boolean);
    for (const id of priorityIds) {
      const match = matches.find(game => String(game?.id || '') === id);
      if (match) return match;
    }
    return matches.find(hasCompletionEvidence) || matches[0];
  }

  function telemetryState(activeId) {
    const snapshot = globalThis.state?.lastSnapshot || {};
    const sameGame = Boolean(activeId) && String(snapshot?.source?.gameId || '') === String(activeId);
    if (!sameGame) return { status: '', age: null };
    const age = Number(snapshot?.quality?.frameAgeSeconds ?? snapshot?.source?.dataAgeSeconds);
    return {
      status: String(snapshot?.status || ''),
      age: Number.isFinite(age) ? age : null
    };
  }

  function liveModel() {
    const context = globalThis.state?.liveSeries;
    const selectedState = String(globalThis.state?.selectedMatchState || '');
    const archiveMode = Boolean(globalThis.state?.seriesArchiveMode);
    const active = ['inProgress', 'postGame'].includes(selectedState) || archiveMode;
    if (!active || !context || String(context.matchId || '') !== String(globalThis.state?.selectedEventId || '')) {
      return null;
    }

    const event = context.event || {};
    const allGames = orderedGames(event);
    const availableGames = allGames.length ? allGames : (context.games || []);
    if (!availableGames.length) return null;

    const format = seriesLength(event, availableGames);
    const activeId = String(globalThis.state?.selectedGameId || '');
    const teams = teamsFor(event);
    const left = teams[0] || {};
    const right = teams[1] || {};
    const leftScore = finiteScore(left);
    const rightScore = finiteScore(right);
    const scoreCount = [leftScore, rightScore].every(value => value !== null)
      ? leftScore + rightScore
      : 0;
    const evidenceCount = (context.games || []).filter(hasCompletionEvidence).length;
    const playedCount = Math.min(format, Math.max(scoreCount, evidenceCount));
    const currentNumber = currentSlotNumber(availableGames, context, activeId, format);
    const league = event?.league?.name || event?.league?.slug || 'League of Legends';
    const telemetry = telemetryState(activeId);
    const pending = selectedState === 'postGame';
    const stale = !archiveMode && !pending && telemetry.status === 'telemetry_stale';
    const partial = !archiveMode && !pending && telemetry.status === 'degraded';
    const pregame = !archiveMode && !pending && telemetry.status === 'pregame';

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

    const scoreLabel = archiveMode
      ? 'Archive'
      : pending
        ? 'Pending'
        : stale
          ? 'Stale'
          : partial
            ? 'Context'
            : pregame
              ? 'Waiting'
              : 'Live';

    const ageText = telemetry.age === null ? '' : `${Math.round(telemetry.age)}s old · `;
    const scoreDetail = pending
      ? `Game ${currentNumber} result pending`
      : stale
        ? `${ageText}Game ${currentNumber}`
        : pregame
          ? `Game ${currentNumber} has not started`
          : `${playedCount} completed · Game ${currentNumber}`;

    const tone = archiveMode
      ? 'archive'
      : pending || partial || pregame
        ? 'waiting'
        : stale
          ? 'stale'
          : 'live';

    const games = Array.from({ length: format }, (_, index) => {
      const number = index + 1;
      const game = gameForSlot(availableGames, number, context, activeId);
      const id = String(game?.id || '');
      const selected = Boolean(id) && id === activeId;
      const currentStale = stale && selected;
      const isLive = Boolean(id) && id === String(context.liveGameId || '') && !currentStale;
      const completed = Boolean(game) && hasCompletionEvidence(game);
      const waiting = Boolean(id) && !isLive && !completed && id === String(context.currentGameId || '') && !currentStale;
      const locked = !id || (!completed && !isLive && !waiting && !currentStale);
      const label = currentStale
        ? 'Stale'
        : isLive
          ? 'Live'
          : selected && archiveMode
            ? 'Selected'
            : completed
              ? 'Final'
              : waiting
                ? 'Waiting'
                : 'Locked';
      return {
        number,
        label,
        selected,
        disabled: waiting || locked,
        tone: currentStale ? 'stale' : isLive ? 'live' : waiting ? 'waiting' : completed ? 'complete' : 'locked',
        attribute: id ? ['data-live-series-game-id', id] : null
      };
    });

    return {
      variant: archiveMode ? 'archive' : 'live',
      mode,
      format,
      league,
      context: `Game ${currentNumber}`,
      teams: [left, right],
      score: {
        label: scoreLabel,
        left: leftScore ?? '—',
        right: rightScore ?? '—',
        detail: scoreDetail,
        tone
      },
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
      actions: archiveMode
        ? [{ label: 'Back to live', attribute: ['data-return-live-game', ''] }]
        : [],
      games
    };
  }

  function historyModel() {
    const history = globalThis.state?.historyMatch;
    if (globalThis.state?.seriesArchiveMode || String(globalThis.state?.selectedMatchState || '') !== 'completed' || !history) {
      return null;
    }

    const event = history.event || {};
    const teams = teamsFor(event);
    const left = teams[0] || {};
    const right = teams[1] || {};
    const games = Array.isArray(history.games) ? history.games : [];
    const available = games.length > 0;
    const format = seriesLength(event, games);
    const selectedId = String(globalThis.state?.selectedGameId || '');
    const selectedGame = games.find(game => String(game?.id || '') === selectedId) || games[games.length - 1] || null;
    const selectedNumber = selectedGame ? gameNumber(selectedGame, games.indexOf(selectedGame)) : null;
    const league = event?.league?.name || event?.league?.slug || 'League of Legends';
    const leftScore = finiteScore(left);
    const rightScore = finiteScore(right);
    const gameMap = new Map(games.map((game, index) => [gameNumber(game, index), game]));

    return {
      variant: available ? 'history' : 'result-only',
      mode: 'Match history',
      format,
      league,
      context: selectedNumber ? `Game ${selectedNumber}` : 'Result only',
      teams: [left, right],
      score: {
        label: available ? 'Final' : 'No result',
        left: leftScore ?? '—',
        right: rightScore ?? '—',
        detail: available
          ? `${games.length} played game${games.length === 1 ? '' : 's'}`
          : 'No completed games',
        tone: available ? 'archive' : 'unavailable'
      },
      status: {
        label: available ? 'Verified archive' : 'Archive unavailable',
        tone: available ? 'archive' : 'unavailable'
      },
      actions: [],
      games: available
        ? Array.from({ length: format }, (_, index) => {
            const number = index + 1;
            const game = gameMap.get(number) || null;
            const id = String(game?.id || '');
            const selected = Boolean(id) && id === selectedId;
            return {
              number,
              label: selected ? 'Selected' : id ? 'Final' : 'Not played',
              selected,
              disabled: !id,
              tone: selected ? 'selected' : id ? 'complete' : 'locked',
              attribute: id ? ['data-history-game-id', id] : null
            };
          })
        : [],
      empty: available
        ? null
        : {
            title: 'Game archive unavailable',
            detail: 'Riot returned the match result without archived game IDs.'
          }
    };
  }

  function createLogo(team = {}) {
    const logo = document.createElement('span');
    logo.className = 'rp-series-logo';
    const image = String(team?.image || '').trim();
    if (/^https?:\/\//i.test(image)) {
      const img = document.createElement('img');
      img.src = image.replace(/^http:\/\//i, 'https://');
      img.alt = '';
      img.loading = 'lazy';
      logo.append(img);
    } else {
      const initials = String(team?.name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase() || '?';
      logo.textContent = initials;
    }
    return logo;
  }

  function createTeam(team, side) {
    const card = document.createElement('article');
    card.className = `rp-series-team is-${side}`;

    const copy = document.createElement('span');
    copy.className = 'rp-series-team-copy';
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
    block.className = `rp-series-score is-${score.tone || 'neutral'}`;

    const label = document.createElement('span');
    label.className = 'rp-series-score-label';
    label.textContent = score.label;

    const value = document.createElement('strong');
    value.className = 'rp-series-score-value';
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

  function createStatus(status) {
    const chip = document.createElement('span');
    chip.className = `rp-series-status is-${status.tone || 'neutral'}`;
    const dot = document.createElement('i');
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = status.label;
    chip.append(dot, label);
    return chip;
  }

  function createPanel(model) {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = `rp-series-panel is-${model.variant}`;
    panel.dataset.signature = JSON.stringify(model);
    panel.setAttribute('aria-label', `${model.mode}, best of ${model.format}`);

    const toolbar = document.createElement('div');
    toolbar.className = 'rp-series-toolbar';

    const identity = document.createElement('div');
    identity.className = 'rp-series-identity';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = model.mode;
    const format = document.createElement('small');
    format.textContent = `Best of ${model.format}`;
    identity.append(eyebrow, format);

    const context = document.createElement('div');
    context.className = 'rp-series-context';
    const league = document.createElement('strong');
    league.textContent = model.league;
    const divider = document.createElement('i');
    divider.textContent = '•';
    const selected = document.createElement('span');
    selected.textContent = model.context;
    context.append(league, divider, selected);

    const controls = document.createElement('div');
    controls.className = 'rp-series-controls';
    controls.append(createStatus(model.status));
    for (const action of model.actions || []) {
      const button = document.createElement('button');
      button.className = 'rp-series-action';
      button.type = 'button';
      button.textContent = action.label;
      if (action.attribute) button.setAttribute(action.attribute[0], action.attribute[1]);
      controls.append(button);
    }
    toolbar.append(identity, context, controls);

    const matchup = document.createElement('div');
    matchup.className = 'rp-series-matchup';
    matchup.append(createTeam(model.teams[0] || {}, 'left'), createScore(model.score), createTeam(model.teams[1] || {}, 'right'));

    const navigation = document.createElement('div');
    navigation.className = 'rp-series-navigation';
    if (model.empty) {
      const empty = document.createElement('div');
      empty.className = 'rp-series-empty';
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
      navigation.append(empty);
    } else {
      const games = document.createElement('div');
      games.className = 'rp-series-games';
      games.style.setProperty('--rp-series-game-count', String(Math.max(1, model.games.length)));
      games.setAttribute('role', 'tablist');
      games.setAttribute('aria-label', 'Series game navigation');
      for (const game of model.games) {
        const button = document.createElement('button');
        button.className = `rp-series-game is-${game.tone || 'neutral'}${game.selected ? ' is-selected' : ''}`;
        button.type = 'button';
        button.disabled = Boolean(game.disabled);
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(Boolean(game.selected)));
        if (game.disabled) button.setAttribute('aria-disabled', 'true');
        if (game.attribute) button.setAttribute(game.attribute[0], game.attribute[1]);
        const number = document.createElement('span');
        number.textContent = `Game ${game.number}`;
        const label = document.createElement('small');
        label.textContent = game.label;
        button.append(number, label);
        games.append(button);
      }
      navigation.append(games);
    }

    panel.append(toolbar, matchup, navigation);
    return panel;
  }

  function restoreHostShell() {
    const host = root.closest('.game-panel') || root.parentElement;
    root.classList.remove('is-result-only-history');
    if (!host) return;
    host.classList.add('panel', 'app-panel');
    host.classList.remove('is-result-only-history');
    delete host.dataset.historyShell;
  }

  function removeLegacySeriesPanels() {
    root.querySelectorAll(LEGACY_SELECTOR).forEach(element => {
      if (element.id !== PANEL_ID) element.remove();
    });
  }

  function insertPanel(panel) {
    const shell = root.querySelector('.analysis-v2-shell, .analysis-shell');
    const header = shell?.querySelector('.analysis-v2-header, .analysis-header');
    if (header) header.insertAdjacentElement('beforebegin', panel);
    else if (shell) shell.prepend(panel);
    else {
      panel.classList.add('is-standalone');
      root.prepend(panel);
    }
  }

  function render() {
    if (rendering) return;
    rendering = true;
    try {
      removeLegacySeriesPanels();
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
      render();
    });
  }

  const observer = new MutationObserver(scheduleRender);
  observer.observe(root, { childList: true, subtree: true });
  window.setInterval(scheduleRender, 1500);
  queueMicrotask(render);

  globalThis.RiftPulseUnifiedSeriesPanel = { render: scheduleRender };
})();