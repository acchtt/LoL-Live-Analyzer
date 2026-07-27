// RiftPulse match history: searchable finished-series archive and per-game replay navigation.
(() => {
  'use strict';

  state.scheduleTab = state.scheduleTab || 'active';
  state.historyQuery = state.historyQuery || '';
  state.historyLeague = state.historyLeague || 'all';
  state.historyMatch = null;
  state.historyGameId = null;

  const HISTORY_CONTROLS_ID = 'matchHistoryControls';

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalize(value = '') {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function scoreValue(team = {}) {
    const value = team?.result?.gameWins;
    const parsed = Number(value);
    return value === undefined || value === null || !Number.isFinite(parsed) ? null : parsed;
  }

  function leagueName(event = {}) {
    return event?.league?.name || event?.league?.slug || 'LoL Esports';
  }

  function seriesFormat(event = {}) {
    const type = event?.match?.strategy?.type || '';
    const count = event?.match?.strategy?.count || '';
    return [type, count].filter(Boolean).join(' ') || 'Series';
  }

  function dateParts(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) {
      return { key: 'unknown', label: 'Date unavailable', time: 'TBD' };
    }
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date),
      time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
    };
  }

  function ensureTabs() {
    let tabs = document.querySelector('#scheduleTabs');
    if (tabs) return tabs;

    const heading = document.querySelector('.schedule-panel .panel-heading');
    if (!heading) return null;

    tabs = document.createElement('div');
    tabs.id = 'scheduleTabs';
    tabs.className = 'schedule-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Match status');
    tabs.innerHTML = `
      <button class="schedule-tab" data-schedule-tab="active" role="tab" type="button">
        Live & Upcoming <span id="activeMatchCount" class="schedule-tab-count">0</span>
      </button>
      <button class="schedule-tab" data-schedule-tab="finished" role="tab" type="button">
        Match History <span id="finishedMatchCount" class="schedule-tab-count">0</span>
      </button>`;
    heading.insertAdjacentElement('afterend', tabs);
    tabs.addEventListener('click', event => {
      const button = event.target.closest('[data-schedule-tab]');
      if (!button) return;
      state.scheduleTab = button.dataset.scheduleTab === 'finished' ? 'finished' : 'active';
      renderSchedule();
    });
    return tabs;
  }

  function ensureHistoryControls() {
    const tabs = ensureTabs();
    if (!tabs) return null;

    const historyButton = tabs.querySelector('[data-schedule-tab="finished"]');
    if (historyButton && !historyButton.dataset.historyLabelApplied) {
      historyButton.innerHTML = 'Match History <span id="finishedMatchCount" class="schedule-tab-count">0</span>';
      historyButton.dataset.historyLabelApplied = 'true';
    }

    let controls = document.getElementById(HISTORY_CONTROLS_ID);
    if (controls) return controls;

    controls = document.createElement('div');
    controls.id = HISTORY_CONTROLS_ID;
    controls.className = 'match-history-controls';
    controls.innerHTML = `
      <label class="history-search-wrap">
        <span class="sr-only">Search match history</span>
        <input id="matchHistorySearch" type="search" autocomplete="off" placeholder="Search team or league">
      </label>
      <label class="history-league-wrap">
        <span class="sr-only">Filter match history by league</span>
        <select id="matchHistoryLeague"><option value="all">All leagues</option></select>
      </label>
      <button id="clearMatchHistoryFilters" class="history-clear" type="button" title="Clear history filters">Clear</button>`;
    tabs.insertAdjacentElement('afterend', controls);

    const search = controls.querySelector('#matchHistorySearch');
    const league = controls.querySelector('#matchHistoryLeague');
    search.value = state.historyQuery;
    league.value = state.historyLeague;

    search.addEventListener('input', () => {
      state.historyQuery = search.value;
      renderSchedule();
    });
    league.addEventListener('change', () => {
      state.historyLeague = league.value;
      renderSchedule();
    });
    controls.querySelector('#clearMatchHistoryFilters').addEventListener('click', () => {
      state.historyQuery = '';
      state.historyLeague = 'all';
      search.value = '';
      league.value = 'all';
      renderSchedule();
    });
    return controls;
  }

  function updateLeagueOptions(finishedEvents) {
    const select = document.querySelector('#matchHistoryLeague');
    if (!select) return;
    const leagues = [...new Set(finishedEvents.map(leagueName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const signature = leagues.join('|');
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    select.innerHTML = '<option value="all">All leagues</option>' + leagues.map(name =>
      `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join('');
    if (leagues.includes(state.historyLeague)) select.value = state.historyLeague;
    else {
      state.historyLeague = 'all';
      select.value = 'all';
    }
  }

  function updateTabState(activeCount, finishedCount) {
    const active = document.querySelector('#activeMatchCount');
    const finished = document.querySelector('#finishedMatchCount');
    if (active) active.textContent = String(activeCount);
    if (finished) finished.textContent = String(finishedCount);

    document.querySelectorAll('[data-schedule-tab]').forEach(button => {
      const selected = button.dataset.scheduleTab === state.scheduleTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });

    const controls = ensureHistoryControls();
    if (controls) controls.hidden = state.scheduleTab !== 'finished';
  }

  function activeCard(event) {
    const id = eventId(event);
    const [a, b] = eventTeams(event);
    const status = displayState(event);
    return `<button class="match-card ${id === state.selectedEventId ? 'active' : ''}" data-event-id="${escapeHtml(id)}" type="button">
      <div class="match-meta"><span>${escapeHtml(leagueName(event))}</span><span class="match-state">${escapeHtml(statusLabel(status))}</span></div>
      <div class="teams">
        <div class="team-line"><span class="team-name">${teamLogo(a)}${escapeHtml(a.name || a.code || 'TBD')}</span><strong>${scoreValue(a) ?? '—'}</strong></div>
        <div class="team-line"><span class="team-name">${teamLogo(b)}${escapeHtml(b.name || b.code || 'TBD')}</span><strong>${scoreValue(b) ?? '—'}</strong></div>
      </div>
      <div class="match-meta match-card-footer"><span>${escapeHtml(seriesFormat(event))}</span><span>${escapeHtml(formatTime(event.startTime))}</span></div>
    </button>`;
  }

  function historyCard(event) {
    const id = eventId(event);
    const [a, b] = eventTeams(event);
    const aScore = scoreValue(a);
    const bScore = scoreValue(b);
    const aWinner = aScore !== null && bScore !== null && aScore > bScore;
    const bWinner = aScore !== null && bScore !== null && bScore > aScore;
    const score = aScore === null || bScore === null ? 'Final' : `${aScore}–${bScore}`;
    const date = dateParts(event.startTime);
    const resultSource = event.resultSource ? `<span class="history-source">${escapeHtml(String(event.resultSource).replaceAll('_', ' '))}</span>` : '';

    return `<button class="match-card history-match-card ${id === state.selectedEventId ? 'active' : ''}" data-event-id="${escapeHtml(id)}" type="button">
      <div class="history-card-top">
        <span class="history-league">${escapeHtml(leagueName(event))}</span>
        <span class="history-final-badge">FINAL</span>
      </div>
      <div class="history-score-row">
        <div class="history-team ${aWinner ? 'winner' : ''} ${bWinner ? 'loser' : ''}">${teamLogo(a)}<span>${escapeHtml(a.name || a.code || 'TBD')}</span></div>
        <strong class="history-series-score">${escapeHtml(score)}</strong>
        <div class="history-team history-team-right ${bWinner ? 'winner' : ''} ${aWinner ? 'loser' : ''}"><span>${escapeHtml(b.name || b.code || 'TBD')}</span>${teamLogo(b)}</div>
      </div>
      <div class="history-card-bottom"><span>${escapeHtml(seriesFormat(event))}${resultSource}</span><span>${escapeHtml(date.time)}</span></div>
    </button>`;
  }

  function renderHistory(events) {
    updateLeagueOptions(events);
    const query = normalize(state.historyQuery);
    const filtered = events.filter(event => {
      const [a, b] = eventTeams(event);
      const league = leagueName(event);
      const matchesLeague = state.historyLeague === 'all' || league === state.historyLeague;
      const haystack = normalize(`${league} ${a.name || ''} ${a.code || ''} ${b.name || ''} ${b.code || ''}`);
      return matchesLeague && (!query || haystack.includes(query));
    });

    if (!filtered.length) {
      scheduleList.innerHTML = `<div class="empty history-empty"><strong>No history matches found</strong><span>Try another team, league, or clear the filters.</span></div>`;
      return;
    }

    const groups = new Map();
    for (const event of filtered) {
      const date = dateParts(event.startTime);
      if (!groups.has(date.key)) groups.set(date.key, { label: date.label, events: [] });
      groups.get(date.key).events.push(event);
    }

    scheduleList.innerHTML = [...groups.values()].map(group => `
      <section class="history-date-group">
        <div class="history-date-heading"><span>${escapeHtml(group.label)}</span><span>${group.events.length} match${group.events.length === 1 ? '' : 'es'}</span></div>
        ${group.events.map(historyCard).join('')}
      </section>`).join('');
  }

  renderSchedule = function matchHistoryRenderSchedule() {
    ensureTabs();
    ensureHistoryControls();
    state.events = sortEvents(state.events || []);
    const activeEvents = state.events.filter(event => displayState(event) !== 'completed');
    const finishedEvents = state.events.filter(event => displayState(event) === 'completed');
    updateTabState(activeEvents.length, finishedEvents.length);

    if (state.scheduleTab === 'finished') {
      renderHistory(finishedEvents);
      return;
    }

    if (!activeEvents.length) {
      scheduleList.innerHTML = '<div class="empty">No live or upcoming matches were returned.</div>';
      return;
    }
    scheduleList.innerHTML = activeEvents.map(activeCard).join('');
  };

  function historyEvent() {
    return state.historyMatch?.event || selectedScheduleEvent() || {};
  }

  function renderHistorySeriesSummary() {
    if (state.selectedMatchState !== 'completed' || !state.historyMatch) return;
    document.querySelector('#historySeriesSummary')?.remove();

    const event = historyEvent();
    const [a, b] = eventTeams(event);
    const aScore = scoreValue(a);
    const bScore = scoreValue(b);
    const games = state.historyMatch.games || [];
    const date = dateParts(event.startTime);
    const summary = document.createElement('section');
    summary.id = 'historySeriesSummary';
    summary.className = 'history-series-summary';
    summary.innerHTML = `
      <div class="history-summary-heading">
        <div><p class="eyebrow">Match history · ${escapeHtml(leagueName(event))}</p><h2>${escapeHtml(a.name || 'Team 1')} vs ${escapeHtml(b.name || 'Team 2')}</h2></div>
        <div class="history-summary-meta"><strong>FINAL ${aScore ?? '—'}–${bScore ?? '—'}</strong><span>${escapeHtml(date.label)} · ${escapeHtml(seriesFormat(event))}</span></div>
      </div>
      <div class="history-game-nav" role="tablist" aria-label="Completed games">
        ${games.map(game => {
          const gameId = String(game.id || '');
          const gameNumber = Number(game.number || 0) || '?';
          const selected = gameId === String(state.selectedGameId);
          return `<button class="history-game-button ${selected ? 'active' : ''}" data-history-game-id="${escapeHtml(gameId)}" type="button" role="tab" aria-selected="${selected}">
            <span>Game ${gameNumber}</span><small>${game.state === 'completed' ? 'Final' : 'Archive'}</small>
          </button>`;
        }).join('')}
      </div>`;
    gameContent.insertBefore(summary, gameContent.firstChild);
  }

  const baseRenderGame = renderGame;
  renderGame = function historyAwareRenderGame(snapshot) {
    const result = baseRenderGame(snapshot);
    renderHistorySeriesSummary();
    return result;
  };

  loadFinishedMatch = async function historyLoadFinishedMatch(id) {
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Loading match history</strong><span>Preparing the final series score and archived game snapshots…</span></div>';
    const payload = await api(`/api/match-details?matchId=${encodeURIComponent(id)}`);
    const event = payload.data?.event || payload.event || payload.data || payload;
    const rawGames = Array.isArray(event?.match?.games) ? event.match.games : [];
    const games = rawGames
      .filter(game => game?.id && (game.state === 'completed' || (Array.isArray(game.vods) && game.vods.length > 0)))
      .sort((left, right) => Number(left.number || 0) - Number(right.number || 0));

    state.historyMatch = { matchId: String(id), event, games };
    state.selectedMatchState = 'completed';

    if (!games.length) {
      state.selectedGameId = null;
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      jsonPreview.textContent = JSON.stringify({ status: 'history_without_telemetry', matchId: String(id), event }, null, 2);
      gameContent.innerHTML = '<div class="empty hero-empty"><strong>Series result available</strong><span>No archived in-game telemetry frame was returned for this match.</span></div>';
      renderHistorySeriesSummary();
      setConnection('History · result only', '');
      return;
    }

    const selected = games[games.length - 1];
    state.selectedGameId = String(selected.id);
    state.historyGameId = state.selectedGameId;
    setJsonEndpoint(state.selectedGameId, true);
    await loadGame();
    setConnection(`History · Game ${selected.number || games.length} final snapshot`, '');
  };

  gameContent.addEventListener('click', async event => {
    const button = event.target.closest('[data-history-game-id]');
    if (!button?.dataset.historyGameId || state.selectedMatchState !== 'completed') return;
    const gameId = String(button.dataset.historyGameId);
    if (gameId === String(state.selectedGameId)) return;

    state.selectedGameId = gameId;
    state.historyGameId = gameId;
    setJsonEndpoint(gameId, true);
    document.querySelectorAll('[data-history-game-id]').forEach(item => {
      const selected = item.dataset.historyGameId === gameId;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    setConnection('Loading archived game…', '');
    await loadGame();
    const game = state.historyMatch?.games?.find(item => String(item.id) === gameId);
    setConnection(`History · Game ${game?.number || '?'} final snapshot`, '');
  });

  const baseSelectEvent = selectEvent;
  selectEvent = async function historyAwareSelectEvent(id) {
    if (String(id) !== String(state.selectedEventId)) {
      state.historyMatch = null;
      state.historyGameId = null;
    }
    return baseSelectEvent(id);
  };

  ensureTabs();
  ensureHistoryControls();
  renderSchedule();
})();
