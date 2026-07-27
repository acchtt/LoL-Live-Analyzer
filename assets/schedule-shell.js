// Option 2 schedule redesign: prominent header, tab toolbar, league filter and update status.
(() => {
  'use strict';

  state.activeLeague = state.activeLeague || 'all';

  const icons = {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    live: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M7.75 7.75a6 6 0 0 0 0 8.5M16.25 7.75a6 6 0 0 1 0 8.5M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.3-5.82L3.5 8.5M3.5 4.5v4h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.3 7.1v5.3l-3.4 1.6v-6.9L4 5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    chevron: '<svg class="filter-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9.5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function leagueName(event = {}) {
    return event?.league?.name || event?.league?.slug || 'LoL Esports';
  }

  function decorateHeading() {
    const heading = document.querySelector('.schedule-panel .panel-heading');
    const refresh = document.querySelector('#refreshSchedule');
    if (!heading || !refresh) return;

    const copy = heading.querySelector(':scope > div');
    if (copy) copy.classList.add('schedule-heading-copy');

    let actions = heading.querySelector('.schedule-heading-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'schedule-heading-actions';
      heading.appendChild(actions);
    }

    let auto = actions.querySelector('.schedule-auto-refresh');
    if (!auto) {
      auto = document.createElement('span');
      auto.className = 'schedule-auto-refresh';
      auto.setAttribute('title', 'The match list refreshes automatically every 30 seconds');
      auto.innerHTML = `${icons.refresh}<span>Auto-refresh On</span><span class="schedule-auto-refresh-dot" aria-hidden="true"></span>`;
      actions.appendChild(auto);
    }

    if (!refresh.classList.contains('schedule-refresh-button')) {
      refresh.classList.add('schedule-refresh-button');
      refresh.innerHTML = `${icons.refresh}<span>Refresh</span>`;
    }
    actions.appendChild(refresh);
  }

  function decorateTabs() {
    const tabs = document.querySelector('#scheduleTabs');
    if (!tabs) return null;

    const active = tabs.querySelector('[data-schedule-tab="active"]');
    const history = tabs.querySelector('[data-schedule-tab="finished"]');

    if (active && !active.dataset.optionTwoDecorated) {
      active.dataset.optionTwoDecorated = 'true';
      active.innerHTML = `<span class="schedule-tab-icon">${icons.live}</span><span class="schedule-tab-label">Live &amp; Upcoming</span><span id="activeMatchCount" class="schedule-tab-count">0</span>`;
    }
    if (history && !history.dataset.optionTwoDecorated) {
      history.dataset.optionTwoDecorated = 'true';
      history.innerHTML = `<span class="schedule-tab-icon">${icons.history}</span><span class="schedule-tab-label">Match History</span><span id="finishedMatchCount" class="schedule-tab-count">0</span>`;
    }
    return tabs;
  }

  function ensureToolbar() {
    const tabs = decorateTabs();
    if (!tabs) return null;

    let toolbar = document.querySelector('#scheduleToolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'scheduleToolbar';
      toolbar.className = 'schedule-toolbar';
      tabs.parentElement.insertBefore(toolbar, tabs);
      toolbar.appendChild(tabs);
    }

    let controls = document.querySelector('#activeScheduleControls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'activeScheduleControls';
      controls.className = 'active-schedule-controls';
      controls.innerHTML = `
        <label class="active-league-filter">
          <span class="sr-only">Filter active matches by league</span>
          ${icons.filter}
          <select id="activeLeagueFilter"><option value="all">All Leagues</option></select>
          ${icons.chevron}
        </label>`;
      toolbar.appendChild(controls);

      controls.querySelector('#activeLeagueFilter').addEventListener('change', event => {
        state.activeLeague = event.target.value || 'all';
        renderSchedule();
      });
    } else if (controls.parentElement !== toolbar) {
      toolbar.appendChild(controls);
    }

    let status = document.querySelector('#scheduleStatusStrip');
    if (!status) {
      status = document.createElement('div');
      status.id = 'scheduleStatusStrip';
      status.className = 'schedule-status-strip';
      status.innerHTML = '<span class="schedule-status-dot" aria-hidden="true"></span><span>Live matches update automatically</span>';
      toolbar.insertAdjacentElement('afterend', status);
    }

    const historyControls = document.querySelector('#matchHistoryControls');
    if (historyControls?.parentElement === toolbar) toolbar.insertAdjacentElement('afterend', historyControls);

    return { toolbar, controls, status };
  }

  function activeEvents() {
    return (state.events || []).filter(event => displayState(event) !== 'completed');
  }

  function updateLeagueOptions(events) {
    const select = document.querySelector('#activeLeagueFilter');
    if (!select) return;

    const leagues = [...new Set(events.map(leagueName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const signature = leagues.join('|');
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.replaceChildren(new Option('All Leagues', 'all'));
      leagues.forEach(league => select.add(new Option(league, league)));
    }

    if (state.activeLeague !== 'all' && !leagues.includes(state.activeLeague)) state.activeLeague = 'all';
    select.value = state.activeLeague;
  }

  function applyActiveFilter(events) {
    scheduleList.querySelector('.schedule-filter-empty')?.remove();
    if (state.scheduleTab !== 'active' || state.activeLeague === 'all') return;

    const byId = new Map(events.map(event => [eventId(event), event]));
    let visible = 0;
    scheduleList.querySelectorAll('[data-event-id]').forEach(card => {
      const event = byId.get(String(card.dataset.eventId));
      const show = event && leagueName(event) === state.activeLeague;
      card.hidden = !show;
      if (show) visible += 1;
    });

    if (!visible) {
      const message = document.createElement('div');
      message.className = 'schedule-filter-empty';
      message.innerHTML = `<strong>No active ${state.activeLeague} matches</strong><span>Choose another league or return to All Leagues.</span>`;
      scheduleList.appendChild(message);
    }
  }

  function syncShell() {
    decorateHeading();
    decorateTabs();
    const shell = ensureToolbar();
    const historyControls = document.querySelector('#matchHistoryControls');
    const active = state.scheduleTab !== 'finished';

    if (shell?.controls) shell.controls.hidden = !active;
    if (shell?.status) shell.status.hidden = !active;
    if (historyControls) historyControls.hidden = active;

    const events = activeEvents();
    updateLeagueOptions(events);
    applyActiveFilter(events);
  }

  const baseRenderSchedule = renderSchedule;
  renderSchedule = function optionTwoScheduleRender(...args) {
    const result = baseRenderSchedule(...args);
    syncShell();
    return result;
  };

  syncShell();
})();