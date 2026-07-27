// Keeps the compact schedule overview and match browser synchronized.
(() => {
  'use strict';

  state.activeLeague = state.activeLeague || 'all';

  const tabs = document.querySelector('#scheduleTabs');
  const secondaryRow = document.querySelector('#matchesSecondaryRow');
  const activeControls = document.querySelector('#activeScheduleControls');
  const leagueFilter = document.querySelector('#activeLeagueFilter');
  const browserSlot = document.querySelector('#browserControlSlot');
  const browserHeading = document.querySelector('#browserHeading');
  const browserCount = document.querySelector('#browserModeCount');

  function leagueName(event = {}) {
    return event?.league?.name || event?.league?.slug || 'LoL Esports';
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function statusOf(event) {
    return displayState(event);
  }

  function activeEvents() {
    return (state.events || []).filter(event => statusOf(event) !== 'completed');
  }

  function finishedEvents() {
    return (state.events || []).filter(event => statusOf(event) === 'completed');
  }

  function updateCounts() {
    const now = Date.now();
    const active = activeEvents();
    const finished = finishedEvents();
    const live = active.filter(event => statusOf(event) === 'inProgress');
    const upcoming = active.filter(event => statusOf(event) !== 'inProgress');
    const next24 = upcoming.filter(event => {
      const start = eventStartMs(event);
      return start !== null && start >= now && start <= now + 24 * 60 * 60 * 1000;
    });

    setText('activeMatchCount', active.length);
    setText('finishedMatchCount', finished.length);
    setText('liveNowCount', live.length);
    setText('upcomingCount', upcoming.length);
    setText('next24Count', next24.length);
    setText('completedCount', finished.length);
  }

  function bindTabs() {
    if (!tabs || tabs.dataset.matchesBound === 'true') return;
    tabs.dataset.matchesBound = 'true';
    tabs.addEventListener('click', event => {
      const button = event.target.closest('[data-schedule-tab]');
      if (!button) return;
      state.scheduleTab = button.dataset.scheduleTab === 'finished' ? 'finished' : 'active';
      renderSchedule();
    });
  }

  function bindLeagueFilter() {
    if (!leagueFilter || leagueFilter.dataset.matchesBound === 'true') return;
    leagueFilter.dataset.matchesBound = 'true';
    leagueFilter.addEventListener('change', () => {
      state.activeLeague = leagueFilter.value || 'all';
      renderSchedule();
    });
  }

  function updateLeagueOptions(events) {
    if (!leagueFilter) return;
    const leagues = [...new Set(events.map(leagueName).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    const signature = leagues.join('|');

    if (leagueFilter.dataset.signature !== signature) {
      leagueFilter.dataset.signature = signature;
      leagueFilter.replaceChildren(new Option('All leagues', 'all'));
      leagues.forEach(league => leagueFilter.add(new Option(league, league)));
    }

    if (state.activeLeague !== 'all' && !leagues.includes(state.activeLeague)) {
      state.activeLeague = 'all';
    }
    leagueFilter.value = state.activeLeague;
  }

  function moveHistoryControls() {
    const controls = document.querySelector('#matchHistoryControls');
    if (!controls || !browserSlot) return controls;
    if (controls.parentElement !== browserSlot) browserSlot.appendChild(controls);
    return controls;
  }

  function updateView() {
    const history = state.scheduleTab === 'finished';
    const controls = moveHistoryControls();
    const active = activeEvents();
    const finished = finishedEvents();

    if (secondaryRow) secondaryRow.classList.toggle('history-view', history);
    if (activeControls) activeControls.hidden = history;
    if (controls) controls.hidden = !history;
    if (browserHeading) browserHeading.textContent = history ? 'Match history' : 'Live & upcoming';

    document.querySelectorAll('[data-schedule-tab]').forEach(button => {
      const selected = button.dataset.scheduleTab === state.scheduleTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });

    return history ? finished : active;
  }

  function applyActiveFilter(events) {
    scheduleList.querySelector('.schedule-filter-empty')?.remove();
    scheduleList.querySelectorAll('[data-event-id]').forEach(card => {
      card.hidden = false;
    });

    if (state.scheduleTab !== 'active' || state.activeLeague === 'all') {
      if (browserCount) browserCount.textContent = String(events.length);
      return;
    }

    const byId = new Map(events.map(event => [String(eventId(event)), event]));
    let visible = 0;
    scheduleList.querySelectorAll('[data-event-id]').forEach(card => {
      const event = byId.get(String(card.dataset.eventId));
      const show = Boolean(event) && leagueName(event) === state.activeLeague;
      card.hidden = !show;
      if (show) visible += 1;
    });

    if (browserCount) browserCount.textContent = String(visible);
    if (!visible) {
      const message = document.createElement('div');
      message.className = 'schedule-filter-empty';
      message.innerHTML = `<strong>No ${state.activeLeague} matches</strong><span>Select another league to continue.</span>`;
      scheduleList.appendChild(message);
    }
  }

  function syncScheduleShell() {
    bindTabs();
    bindLeagueFilter();
    updateCounts();

    const active = activeEvents();
    updateLeagueOptions(active);
    const visibleSet = updateView();
    applyActiveFilter(visibleSet);
  }

  const baseRenderSchedule = renderSchedule;
  renderSchedule = function focusedScheduleRender(...args) {
    const result = baseRenderSchedule(...args);
    syncScheduleShell();
    return result;
  };

  syncScheduleShell();
})();