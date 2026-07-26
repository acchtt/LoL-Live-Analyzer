// Schedule tabs and placeholder-event filtering.
(() => {
  const PLACEHOLDER_TEAM = /^(?:tbd|tba|unknown|to be determined|team\s*[12]|-)$/i;

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

  function placeholderTeam(team = {}) {
    const name = String(team.name || '').trim();
    const code = String(team.code || '').trim();
    const nameMissing = !name || PLACEHOLDER_TEAM.test(name);
    const codeMissing = !code || PLACEHOLDER_TEAM.test(code);
    return nameMissing && codeMissing;
  }

  function placeholderEvent(event) {
    const teams = event?.match?.teams || [];
    return !eventId(event) || teams.length < 2 || teams.every(placeholderTeam);
  }

  function cleanEvents() {
    const before = state.events.length;
    state.events = state.events.filter(event => !placeholderEvent(event));

    if (
      before !== state.events.length &&
      state.selectedEventId &&
      !state.events.some(event => eventId(event) === String(state.selectedEventId))
    ) {
      clearMatchTimers();
      state.selectedEventId = null;
      state.selectedGameId = null;
      state.selectedMatchState = null;
      state.lastSnapshot = null;
      gameContent.innerHTML = '<div class="empty hero-empty"><strong>Select a match</strong><span>The unresolved placeholder event was removed from the schedule.</span></div>';
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      jsonPreview.textContent = JSON.stringify({ status: 'waiting_for_game' }, null, 2);
    }
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
    document.querySelector('#activeMatchCount')?.replaceChildren(String(activeCount));
    document.querySelector('#finishedMatchCount')?.replaceChildren(String(finishedCount));

    document.querySelectorAll('[data-schedule-tab]').forEach(button => {
      const selected = button.dataset.scheduleTab === state.scheduleTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  renderSchedule = function tabbedRenderSchedule() {
    cleanEvents();
    state.events = sortEvents(state.events);

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
          <div class="team-line"><span class="team-name">${teamLogo(a)}${escapeHtml(a.name || a.code || 'TBD')}</span><strong>${Number(a.result?.gameWins ?? 0)}</strong></div>
          <div class="team-line"><span class="team-name">${teamLogo(b)}${escapeHtml(b.name || b.code || 'TBD')}</span><strong>${Number(b.result?.gameWins ?? 0)}</strong></div>
        </div>
        <div class="match-meta" style="margin-top:12px"><span>${escapeHtml(format)}</span><span>${escapeHtml(formatTime(event.startTime))}</span></div>
      </button>`;
    }).join('');
  };

  const previousLoadSchedule = loadSchedule;
  loadSchedule = async function tabAwareLoadSchedule(...args) {
    const result = await previousLoadSchedule(...args);
    cleanEvents();
    renderSchedule();
    return result;
  };

  installTabs();
  setTimeout(() => {
    cleanEvents();
    renderSchedule();
    loadSchedule(true);
  }, 0);
})();