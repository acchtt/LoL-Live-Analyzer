// Organizes the full-width Matches module into the reference hierarchy.
(() => {
  'use strict';

  state.activeLeague = state.activeLeague || 'all';

  const tabs = document.querySelector('#scheduleTabs');
  const primaryRow = document.querySelector('.matches-primary-row');
  const secondaryRow = document.querySelector('#matchesSecondaryRow');
  const callout = document.querySelector('#matchesCallout');
  const activeControls = document.querySelector('#activeScheduleControls');
  const leagueFilter = document.querySelector('#activeLeagueFilter');

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

  function updateCounts() {
    const now = Date.now();
    const events = state.events || [];
    const live = events.filter(event => statusOf(event) === 'inProgress').length;
    const upcomingEvents = events.filter(event => ['starting', 'unstarted'].includes(statusOf(event)));
    const completed = events.filter(event => statusOf(event) === 'completed').length;
    const next24 = upcomingEvents.filter(event => {
      const start = eventStartMs(event);
      return start !== null && start >= now && start <= now + (24 * 60 * 60 * 1000);
    }).length;

    setText('activeMatchCount', live + upcomingEvents.length);
    setText('finishedMatchCount', completed);
    setText('liveNowCount', live);
    setText('upcomingCount', upcomingEvents.length);
    setText('next24Count', next24);
    setText('completedCount', completed);
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
      leagueFilter.replaceChildren(new Option('Filter · All leagues', 'all'));
      leagues.forEach(league => leagueFilter.add(new Option(league, league)));
    }

    if (state.activeLeague !== 'all' && !leagues.includes(state.activeLeague)) {
      state.activeLeague = 'all';
    }
    leagueFilter.value = state.activeLeague;
  }

  function moveHistoryControls() {
    const historyControls = document.querySelector('#matchHistoryControls');
    if (!historyControls || !primaryRow) return historyControls;
    if (historyControls.previousElementSibling !== primaryRow) {
      primaryRow.insertAdjacentElement('afterend', historyControls);
    }
    return historyControls;
  }

  function updateViewVisibility() {
    const history = state.scheduleTab === 'finished';
    const historyControls = moveHistoryControls();

    if (secondaryRow) secondaryRow.hidden = history;
    if (callout) callout.hidden = history;
    if (activeControls) activeControls.hidden = history;
    if (historyControls) historyControls.hidden = !history;

    document.querySelectorAll('[data-schedule-tab]').forEach(button => {
      const selected = button.dataset.scheduleTab === state.scheduleTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function applyActiveFilter(events) {
    scheduleList.querySelector('.schedule-filter-empty')?.remove();
    scheduleList.querySelectorAll('[data-event-id]').forEach(card => {
      card.hidden = false;
    });

    if (state.scheduleTab !== 'active' || state.activeLeague === 'all') return;

    const byId = new Map(events.map(event => [eventId(event), event]));
    let visible = 0;
    scheduleList.querySelectorAll('[data-event-id]').forEach(card => {
      const event = byId.get(String(card.dataset.eventId));
      const show = Boolean(event) && leagueName(event) === state.activeLeague;
      card.hidden = !show;
      if (show) visible += 1;
    });

    if (!visible) {
      const message = document.createElement('div');
      message.className = 'schedule-filter-empty';
      message.innerHTML = `<strong>No active ${state.activeLeague} matches</strong><span>Choose another league or return to Filter · All leagues.</span>`;
      scheduleList.appendChild(message);
    }
  }

  function syncMatchesShell() {
    bindTabs();
    bindLeagueFilter();
    const events = activeEvents();
    updateCounts();
    updateLeagueOptions(events);
    updateViewVisibility();
    applyActiveFilter(events);
  }

  const baseRenderSchedule = renderSchedule;
  renderSchedule = function organizedMatchesRender(...args) {
    const result = baseRenderSchedule(...args);
    syncMatchesShell();
    return result;
  };

  syncMatchesShell();
})();
