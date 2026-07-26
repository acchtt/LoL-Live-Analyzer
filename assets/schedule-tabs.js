// Authoritative schedule controller: tabs, placeholder filtering, known results and live reconciliation.
(() => {
  const PLACEHOLDER_TEAM = /^(?:tbd|tba|unknown|to be determined|team\s*[12]|-)$/i;
  const LPL_INFERRED_LIVE_MS = 4 * 60 * 60 * 1000;
  const RESOLVE_EARLY_MS = 5 * 60 * 1000;
  const RESOLVE_LATE_MS = 8 * 60 * 60 * 1000;
  const MAX_RESOLVE_MATCHES = 6;
  let statusCheckInFlight = false;

  const KNOWN_RESULTS = [
    {
      matchId: '11566854547835316',
      teamCodes: ['LNG', 'NIP'],
      scoreByCode: { LNG: 0, NIP: 2 },
      winnerCode: 'NIP',
      source: 'external_confirmed',
      note: 'Riot did not publish the completed LPL result for this event.'
    }
  ];

  state.scheduleTab = state.scheduleTab || 'active';

  const style = document.createElement('style');
  style.textContent = `
    .schedule-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(0, 0, 0, .08);
    }
    .schedule-tab {
      min-width: 0;
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 750;
    }
    .schedule-tab:hover { color: var(--text); border-color: var(--accent); }
    .schedule-tab.active {
      color: var(--text);
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
      background: color-mix(in srgb, var(--accent) 11%, transparent);
    }
    .schedule-tab-count {
      display: inline-flex;
      justify-content: center;
      min-width: 21px;
      margin-left: 5px;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, .07);
      font-size: 11px;
    }
  `;
  document.head.appendChild(style);

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function teamCode(team = {}) {
    const code = String(team.code || '').trim().toUpperCase();
    if (code) return code;
    const name = String(team.name || '').trim().toUpperCase();
    if (name.includes('NINJAS IN PYJAMAS')) return 'NIP';
    if (name.includes('LNG')) return 'LNG';
    return name;
  }

  function placeholderTeam(team = {}) {
    const name = String(team.name || '').trim();
    const code = String(team.code || '').trim();
    return (!name || PLACEHOLDER_TEAM.test(name)) && (!code || PLACEHOLDER_TEAM.test(code));
  }

  function placeholderEvent(event) {
    const teams = event?.match?.teams || [];
    return !eventId(event) || teams.length < 2 || teams.every(placeholderTeam);
  }

  function leagueIsLpl(event) {
    const value = `${event?.league?.name || ''} ${event?.league?.slug || ''}`.toLowerCase();
    return /\blpl\b/.test(value) || value.includes('china');
  }

  function knownResult(event) {
    const id = eventId(event);
    const codes = new Set((event?.match?.teams || []).map(teamCode));
    return KNOWN_RESULTS.find(result =>
      result.matchId === id || result.teamCodes.every(code => codes.has(code))
    ) || null;
  }

  function applyKnownResult(event, result = knownResult(event)) {
    if (!event || !result || !event?.match?.teams?.length) return false;

    let applied = false;
    for (const team of event.match.teams) {
      const code = teamCode(team);
      if (!Object.prototype.hasOwnProperty.call(result.scoreByCode, code)) continue;
      team.result = { ...(team.result || {}), gameWins: number(result.scoreByCode[code]) };
      applied = true;
    }

    if (applied) {
      event.state = 'completed';
      event.resultSource = result.source;
      state.liveMatchIds.delete(eventId(event));
    }
    return applied;
  }

  function startWithinLiveWindow(event, now = Date.now()) {
    const start = eventStartMs(event);
    return start !== null && start <= now && now - start <= LPL_INFERRED_LIVE_MS;
  }

  function authoritativeDisplayState(event) {
    if (knownResult(event) || event?.state === 'completed') return 'completed';
    if (state.liveMatchIds.has(eventId(event)) || event?.state === 'inProgress') return 'inProgress';
    if (event?.state === 'unstarted' && leagueIsLpl(event) && startWithinLiveWindow(event)) return 'inProgress';
    if (event?.state === 'unstarted' && shouldResolveAsLive(event)) return 'starting';
    return event?.state || 'unstarted';
  }

  displayState = authoritativeDisplayState;

  function cleanEvents(events) {
    return events
      .filter(event => ['inProgress', 'unstarted', 'completed'].includes(event?.state))
      .filter(event => !placeholderEvent(event))
      .map(event => {
        applyKnownResult(event);
        return event;
      });
  }

  function installTabs() {
    const heading = document.querySelector('.schedule-panel .panel-heading');
    if (!heading || document.querySelector('#scheduleTabs')) return;
    const title = heading.querySelector('h2');
    if (title) title.textContent = 'Matches';

    const tabs = document.createElement('div');
    tabs.id = 'scheduleTabs';
    tabs.className = 'schedule-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Match status');
    tabs.innerHTML = `
      <button class="schedule-tab" data-schedule-tab="active" role="tab" type="button">
        Live & Upcoming <span id="activeMatchCount" class="schedule-tab-count">0</span>
      </button>
      <button class="schedule-tab" data-schedule-tab="finished" role="tab" type="button">
        Finished <span id="finishedMatchCount" class="schedule-tab-count">0</span>
      </button>`;
    heading.insertAdjacentElement('afterend', tabs);

    tabs.addEventListener('click', event => {
      const button = event.target.closest('[data-schedule-tab]');
      if (!button) return;
      state.scheduleTab = button.dataset.scheduleTab === 'finished' ? 'finished' : 'active';
      renderSchedule();
    });
  }

  function updateTabs(activeCount, finishedCount) {
    const active = document.querySelector('#activeMatchCount');
    const finished = document.querySelector('#finishedMatchCount');
    if (active) active.textContent = String(activeCount);
    if (finished) finished.textContent = String(finishedCount);

    document.querySelectorAll('[data-schedule-tab]').forEach(button => {
      const selected = button.dataset.scheduleTab === state.scheduleTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  renderSchedule = function authoritativeRenderSchedule() {
    state.events = sortEvents(cleanEvents(state.events));
    const activeEvents = state.events.filter(event => displayState(event) !== 'completed');
    const finishedEvents = state.events.filter(event => displayState(event) === 'completed');
    updateTabs(activeEvents.length, finishedEvents.length);

    const visibleEvents = state.scheduleTab === 'finished' ? finishedEvents : activeEvents;
    if (!visibleEvents.length) {
      scheduleList.innerHTML = state.scheduleTab === 'finished'
        ? '<div class="empty">No finished matches were returned.</div>'
        : '<div class="empty">No live or upcoming matches were returned.</div>';
      return;
    }

    scheduleList.innerHTML = visibleEvents.map(event => {
      const id = eventId(event);
      const [a, b] = eventTeams(event);
      const status = displayState(event);
      const format = [event.match?.strategy?.type, event.match?.strategy?.count].filter(Boolean).join(' ');
      return `<button class="match-card ${id === state.selectedEventId ? 'active' : ''}" data-event-id="${escapeHtml(id)}" type="button">
        <div class="match-meta"><span>${escapeHtml(event.league?.name || event.league?.slug || 'LoL Esports')}</span><span class="match-state">${escapeHtml(statusLabel(status))}</span></div>
        <div class="teams">
          <div class="team-line"><span class="team-name">${teamLogo(a)}${escapeHtml(a.name || a.code || 'TBD')}</span><strong>${number(a.result?.gameWins)}</strong></div>
          <div class="team-line"><span class="team-name">${teamLogo(b)}${escapeHtml(b.name || b.code || 'TBD')}</span><strong>${number(b.result?.gameWins)}</strong></div>
        </div>
        <div class="match-meta" style="margin-top:12px"><span>${escapeHtml(format)}</span><span>${escapeHtml(formatTime(event.startTime))}</span></div>
      </button>`;
    }).join('');
  };

  function mergeTeamScores(event, teams = []) {
    if (!event?.match?.teams || !Array.isArray(teams)) return;
    for (const eventTeam of event.match.teams) {
      const fresh = teams.find(team => String(team.id) === String(eventTeam.id));
      if (!fresh) continue;
      const wins = fresh.wins ?? fresh.result?.gameWins;
      if (wins !== undefined && wins !== null) {
        eventTeam.result = { ...(eventTeam.result || {}), gameWins: number(wins) };
      }
    }
  }

  function targetWins(event) {
    const bestOf = number(event?.match?.strategy?.count) || 1;
    return Math.floor(bestOf / 2) + 1;
  }

  function scoreCompletesSeries(event) {
    return (event?.match?.teams || []).some(team => number(team.result?.gameWins) >= targetWins(event));
  }

  async function reconcileCandidateStatuses() {
    if (statusCheckInFlight) return;
    statusCheckInFlight = true;

    try {
      const now = Date.now();
      const candidates = state.events
        .filter(event => displayState(event) !== 'completed' && !knownResult(event))
        .filter(event => {
          const start = eventStartMs(event);
          return start !== null && start <= now + RESOLVE_EARLY_MS && start >= now - RESOLVE_LATE_MS;
        })
        .sort((a, b) => Math.abs((eventStartMs(a) || now) - now) - Math.abs((eventStartMs(b) || now) - now))
        .slice(0, MAX_RESOLVE_MATCHES);

      const results = await Promise.allSettled(candidates.map(event =>
        api(`/api/resolve-game?matchId=${encodeURIComponent(eventId(event))}`)
      ));

      candidates.forEach((event, index) => {
        const result = results[index];
        if (result.status !== 'fulfilled') return;
        const resolution = result.value || {};
        const freshEvent = resolution.event;
        if (freshEvent?.match?.teams) mergeTeamScores(event, freshEvent.match.teams);
        if (resolution.series?.teams) mergeTeamScores(event, resolution.series.teams);

        if (freshEvent?.state === 'completed' || scoreCompletesSeries(event)) {
          event.state = 'completed';
          state.liveMatchIds.delete(eventId(event));
          return;
        }

        if (resolution.broadcastLive || resolution.selectedGame?.id) {
          event.state = 'inProgress';
          event.statusSource = resolution.selectedGame?.id ? 'riot_telemetry' : 'riot_getLive';
          state.liveMatchIds.add(eventId(event));
          return;
        }

        if (leagueIsLpl(event) && startWithinLiveWindow(event, now)) {
          event.state = 'inProgress';
          event.statusSource = 'scheduled_start_inferred';
          state.liveMatchIds.add(eventId(event));
        }
      });

      state.events.forEach(event => applyKnownResult(event));
      renderSchedule();
    } finally {
      statusCheckInFlight = false;
    }
  }

  function renderKnownFinished(event, result) {
    const [a, b] = eventTeams(event);
    const aScore = number(a.result?.gameWins);
    const bScore = number(b.result?.gameWins);
    state.selectedMatchState = 'completed';
    state.selectedGameId = null;
    state.liveMatchIds.delete(eventId(event));
    clearMatchTimers();

    gameContent.innerHTML = `<div class="empty hero-empty">
      <strong>Match finished · ${escapeHtml(a.name || 'Team 1')} ${aScore}–${bScore} ${escapeHtml(b.name || 'Team 2')}</strong>
      <span>${escapeHtml(result.note)} The score is marked as externally confirmed.</span>
    </div>`;
    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    jsonPreview.textContent = JSON.stringify({
      status: 'finished',
      matchId: eventId(event),
      source: result.source,
      winnerCode: result.winnerCode,
      score: result.scoreByCode,
      updatedAt: new Date().toISOString()
    }, null, 2);
    setConnection(`FINISHED · ${aScore}–${bScore}`, '');
  }

  const previousSelectEvent = selectEvent;
  selectEvent = async function authoritativeSelectEvent(id) {
    const event = state.events.find(item => eventId(item) === String(id));
    const result = knownResult(event);
    if (!event || !result) return previousSelectEvent(id);

    state.selectedEventId = String(id);
    applyKnownResult(event, result);
    state.scheduleTab = 'finished';
    renderSchedule();
    renderKnownFinished(event, result);
  };

  loadSchedule = async function authoritativeLoadSchedule(silent = false) {
    if (!silent) setConnection('Loading schedule…');
    try {
      const payload = await api('/api/schedule');
      const events = payload.data?.schedule?.events || payload.schedule?.events || payload.events || [];
      state.liveMatchIds.clear();
      state.events = sortEvents(cleanEvents(events)).slice(0, 100);

      for (const event of state.events) {
        if (event.state === 'inProgress') state.liveMatchIds.add(eventId(event));
        if (leagueIsLpl(event) && startWithinLiveWindow(event) && displayState(event) !== 'completed') {
          event.state = 'inProgress';
          event.statusSource = 'scheduled_start_inferred';
          state.liveMatchIds.add(eventId(event));
        }
        applyKnownResult(event);
      }

      renderSchedule();
      await reconcileCandidateStatuses();

      const selected = selectedScheduleEvent();
      const result = knownResult(selected);
      if (selected && result) {
        applyKnownResult(selected, result);
        renderKnownFinished(selected, result);
      } else if (
        selected &&
        displayState(selected) === 'inProgress' &&
        state.selectedMatchState !== 'inProgress'
      ) {
        resolveLiveEvent(state.selectedEventId, true).catch(error => setConnection(error.message, 'error'));
      }

      if (!silent || !state.selectedEventId) {
        const liveCount = state.events.filter(event => displayState(event) === 'inProgress').length;
        const startingCount = state.events.filter(event => displayState(event) === 'starting').length;
        const finishedCount = state.events.filter(event => displayState(event) === 'completed').length;
        setConnection(`Schedule connected · ${liveCount} live · ${startingCount} starting · ${finishedCount} finished`, 'live');
      }
    } catch (error) {
      if (!silent) {
        setConnection(error.message, 'error');
        scheduleList.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }
  };

  installTabs();
  setTimeout(() => loadSchedule(true), 0);
})();