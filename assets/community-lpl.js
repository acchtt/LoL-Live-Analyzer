// Free LPL community-data adapter.
// Riot remains primary for schedule/assets/telemetry; Leaguepedia supplies series scores/results when Riot LPL data is stale.
(() => {
  const BUILD = '20260726-21';
  const LEAGUEPEDIA_API = 'https://lol.fandom.com/api.php';
  const COMMUNITY_REFRESH_MS = 60_000;
  const ACTIVE_WINDOW_MS = 5 * 60 * 60 * 1000;
  const MATCH_TIME_TOLERANCE_MS = 4 * 60 * 60 * 1000;
  const PLACEHOLDER = /^(?:tbd|tba|unknown|to be determined|team\s*[12]|-)$/i;

  let communityRows = [];
  let communityFetchedAt = 0;
  let communityRequest = null;
  state.scheduleTab = state.scheduleTab || 'active';

  const fallbackResults = [
    {
      matchId: '11566854547835316',
      teams: ['LNG', 'NIP'],
      score: { LNG: 0, NIP: 2 },
      source: 'manual_fallback',
      note: 'Fallback retained because Riot never published the completed LPL state.'
    }
  ];

  const aliases = new Map([
    ['lng', 'LNG'], ['lngesports', 'LNG'], ['suzhoulng', 'LNG'], ['suzhoulngesports', 'LNG'],
    ['ninjasinpyjamas', 'NIP'], ['shenzhenninjasinpyjamas', 'NIP'], ['nip', 'NIP'],
    ['edwardgaming', 'EDG'], ['edg', 'EDG'],
    ['thundertalkgaming', 'TT'], ['thundertalk', 'TT'], ['ttgaming', 'TT'], ['tt', 'TT'],
    ['bilibiligaming', 'BLG'], ['blg', 'BLG'],
    ['anyoneslegend', 'AL'], ['al', 'AL'],
    ['weibogaming', 'WBG'], ['wbg', 'WBG'],
    ['jdgaming', 'JDG'], ['jdg', 'JDG'],
    ['topesports', 'TES'], ['tes', 'TES'],
    ['invictusgaming', 'IG'], ['ig', 'IG'],
    ['fpx', 'FPX'], ['funplusphoenix', 'FPX'],
    ['royalnevergiveup', 'RNG'], ['rng', 'RNG'],
    ['ultraprime', 'UP'], ['up', 'UP'],
    ['teamwe', 'WE'], ['we', 'WE'],
    ['ohmygod', 'OMG'], ['omg', 'OMG']
  ]);

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalized(value = '') {
    return String(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '');
  }

  function teamKey(teamOrName = {}) {
    const object = typeof teamOrName === 'string' ? { name: teamOrName } : teamOrName;
    const code = normalized(object.code || '');
    if (code && !PLACEHOLDER.test(object.code || '') && code.length <= 6) {
      return aliases.get(code) || code.toUpperCase();
    }

    const name = normalized(object.name || '');
    return aliases.get(name) || name.toUpperCase();
  }

  function eventKey(event) {
    return String(event?.match?.id || event?.id || '');
  }

  function isLpl(event) {
    const league = `${event?.league?.name || ''} ${event?.league?.slug || ''}`.toLowerCase();
    return /\blpl\b/.test(league) || league.includes('china');
  }

  function placeholderTeam(team = {}) {
    const name = String(team.name || '').trim();
    const code = String(team.code || '').trim();
    return (!name || PLACEHOLDER.test(name)) && (!code || PLACEHOLDER.test(code));
  }

  function realEvent(event) {
    const teams = event?.match?.teams || [];
    return Boolean(eventKey(event)) && teams.length >= 2 && !teams.every(placeholderTeam);
  }

  function eventStart(event) {
    const parsed = Date.parse(event?.startTime || '');
    return Number.isFinite(parsed) ? parsed : null;
  }

  function rowDate(row) {
    const raw = row.DateTime_UTC || row.DateTime || row['DateTime UTC'] || '';
    const normalizedDate = String(raw).replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z');
    const parsed = Date.parse(normalizedDate);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function rowTeams(row) {
    return [teamKey(String(row.Team1 || '')), teamKey(String(row.Team2 || ''))];
  }

  function eventTeamsKeys(event) {
    return (event?.match?.teams || []).slice(0, 2).map(teamKey);
  }

  function sameTeamPair(a, b) {
    return a.length === 2 && b.length === 2 && a.every(key => key && b.includes(key));
  }

  function targetWins(bestOf) {
    const count = Number(bestOf) || 1;
    return Math.floor(count / 2) + 1;
  }

  function rowFinished(row) {
    const score1 = numberOrNull(row.Team1Score);
    const score2 = numberOrNull(row.Team2Score);
    const winner = String(row.Winner || '').trim();
    if (score1 === null || score2 === null) return false;
    return Boolean(winner) || Math.max(score1, score2) >= targetWins(row.BestOf);
  }

  function findCommunityRow(event) {
    if (!isLpl(event)) return null;
    const keys = eventTeamsKeys(event);
    const start = eventStart(event);

    return communityRows
      .filter(row => sameTeamPair(keys, rowTeams(row)))
      .map(row => ({ row, delta: start === null || rowDate(row) === null ? 0 : Math.abs(rowDate(row) - start) }))
      .filter(item => item.delta <= MATCH_TIME_TOLERANCE_MS)
      .sort((a, b) => a.delta - b.delta)[0]?.row || null;
  }

  function findFallback(event) {
    const id = eventKey(event);
    const keys = eventTeamsKeys(event);
    return fallbackResults.find(result => result.matchId === id || (!result.matchId && result.teams.every(key => keys.includes(key)))) || null;
  }

  function applyScores(event, scoreByKey, source, note = '') {
    let applied = false;
    for (const team of event?.match?.teams || []) {
      const key = teamKey(team);
      if (!Object.prototype.hasOwnProperty.call(scoreByKey, key)) continue;
      team.result = { ...(team.result || {}), gameWins: Number(scoreByKey[key]) || 0 };
      applied = true;
    }
    if (applied) {
      event.communitySource = source;
      event.communityNote = note;
    }
    return applied;
  }

  function applyCommunityState(event, now = Date.now()) {
    if (!realEvent(event)) return false;

    const row = findCommunityRow(event);
    if (row) {
      const score1 = numberOrNull(row.Team1Score);
      const score2 = numberOrNull(row.Team2Score);
      if (score1 !== null && score2 !== null) {
        const [key1, key2] = rowTeams(row);
        applyScores(event, { [key1]: score1, [key2]: score2 }, 'Leaguepedia', 'Community-maintained LPL result data.');
      }

      if (rowFinished(row)) {
        event.state = 'completed';
        state.liveMatchIds.delete(eventKey(event));
      } else {
        const start = eventStart(event);
        if (start !== null && start <= now && now - start <= ACTIVE_WINDOW_MS) {
          event.state = 'inProgress';
          state.liveMatchIds.add(eventKey(event));
        }
      }
      return true;
    }

    const fallback = findFallback(event);
    if (fallback) {
      applyScores(event, fallback.score, fallback.source, fallback.note);
      event.state = 'completed';
      state.liveMatchIds.delete(eventKey(event));
      return true;
    }

    if (isLpl(event)) {
      const start = eventStart(event);
      if (start !== null && start <= now && now - start <= ACTIVE_WINDOW_MS) {
        event.state = 'inProgress';
        event.communitySource = 'scheduled-start inference';
        state.liveMatchIds.add(eventKey(event));
      }
    }
    return false;
  }

  function cargoParams() {
    return new URLSearchParams({
      action: 'cargoquery',
      format: 'json',
      origin: '*',
      tables: 'MatchSchedule=MS,Tournaments=T',
      fields: 'MS.MatchId,MS.Team1,MS.Team2,MS.Team1Score,MS.Team2Score,MS.Winner,MS.DateTime_UTC,MS.BestOf,MS.OverviewPage,T.Name=Tournament,T.League',
      join_on: 'MS.OverviewPage=T.OverviewPage',
      where: '(T.League="LPL" OR T.Name LIKE "%LPL%") AND MS.DateTime_UTC > NOW() - INTERVAL 2 DAY AND MS.DateTime_UTC < NOW() + INTERVAL 4 DAY',
      order_by: 'MS.DateTime_UTC ASC',
      limit: '100'
    });
  }

  async function fetchCommunityRows(force = false) {
    if (!force && communityRows.length && Date.now() - communityFetchedAt < COMMUNITY_REFRESH_MS) return communityRows;
    if (communityRequest) return communityRequest;

    communityRequest = fetch(`${LEAGUEPEDIA_API}?${cargoParams().toString()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    })
      .then(async response => {
        if (!response.ok) throw new Error(`Leaguepedia returned ${response.status}`);
        const payload = await response.json();
        communityRows = (payload?.cargoquery || []).map(item => item?.title || {}).filter(Boolean);
        communityFetchedAt = Date.now();
        return communityRows;
      })
      .catch(error => {
        console.warn('Leaguepedia sync unavailable:', error);
        return communityRows;
      })
      .finally(() => { communityRequest = null; });

    return communityRequest;
  }

  function installTabs() {
    const heading = document.querySelector('.schedule-panel .panel-heading');
    if (!heading) return;
    heading.querySelector('h2')?.replaceChildren('Matches');

    let tabs = document.querySelector('#scheduleTabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'scheduleTabs';
      tabs.className = 'schedule-tabs';
      tabs.innerHTML = `
        <button class="schedule-tab" data-schedule-tab="active" type="button">Live & Upcoming <span id="activeMatchCount" class="schedule-tab-count">0</span></button>
        <button class="schedule-tab" data-schedule-tab="finished" type="button">Finished <span id="finishedMatchCount" class="schedule-tab-count">0</span></button>`;
      heading.insertAdjacentElement('afterend', tabs);
      tabs.addEventListener('click', event => {
        const button = event.target.closest('[data-schedule-tab]');
        if (!button) return;
        state.scheduleTab = button.dataset.scheduleTab === 'finished' ? 'finished' : 'active';
        renderSchedule();
      });
    }
  }

  function sourceText(event) {
    if (!event.communitySource) return '';
    return `<span class="community-source">${escapeHtml(event.communitySource)}</span>`;
  }

  const scheduleStyle = document.createElement('style');
  scheduleStyle.textContent = `
    .schedule-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)}
    .schedule-tab{padding:9px 10px;border:1px solid var(--border);border-radius:10px;color:var(--muted);background:transparent;cursor:pointer;font-weight:750}
    .schedule-tab.active{color:var(--text);border-color:var(--accent);background:#49d3ff12}
    .schedule-tab-count{display:inline-flex;min-width:21px;justify-content:center;margin-left:5px;padding:1px 6px;border-radius:999px;background:#ffffff12;font-size:11px}
    .community-source{color:var(--accent);font-size:10px;text-transform:none;font-weight:700}
    .build-mark{margin-left:8px;opacity:.7}
  `;
  document.head.appendChild(scheduleStyle);

  renderSchedule = function communityRenderSchedule() {
    const now = Date.now();
    state.events = sortEvents((state.events || []).filter(realEvent).map(event => {
      applyCommunityState(event, now);
      return event;
    }));

    const active = state.events.filter(event => displayState(event) !== 'completed');
    const finished = state.events.filter(event => displayState(event) === 'completed');
    const activeCount = document.querySelector('#activeMatchCount');
    const finishedCount = document.querySelector('#finishedMatchCount');
    if (activeCount) activeCount.textContent = String(active.length);
    if (finishedCount) finishedCount.textContent = String(finished.length);
    document.querySelectorAll('[data-schedule-tab]').forEach(button => {
      const selected = button.dataset.scheduleTab === state.scheduleTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });

    const visible = state.scheduleTab === 'finished' ? finished : active;
    if (!visible.length) {
      scheduleList.innerHTML = `<div class="empty">No ${state.scheduleTab === 'finished' ? 'finished' : 'live or upcoming'} matches were returned.</div>`;
      return;
    }

    scheduleList.innerHTML = visible.map(event => {
      const id = eventKey(event);
      const [a, b] = eventTeams(event);
      const status = displayState(event);
      const format = [event.match?.strategy?.type, event.match?.strategy?.count].filter(Boolean).join(' ');
      return `<button class="match-card ${id === state.selectedEventId ? 'active' : ''}" data-event-id="${escapeHtml(id)}" type="button">
        <div class="match-meta"><span>${escapeHtml(event.league?.name || event.league?.slug || 'LoL Esports')} ${sourceText(event)}</span><span class="match-state">${escapeHtml(statusLabel(status))}</span></div>
        <div class="teams">
          <div class="team-line"><span class="team-name">${teamLogo(a)}${escapeHtml(a.name || a.code || 'TBD')}</span><strong>${Number(a.result?.gameWins || 0)}</strong></div>
          <div class="team-line"><span class="team-name">${teamLogo(b)}${escapeHtml(b.name || b.code || 'TBD')}</span><strong>${Number(b.result?.gameWins || 0)}</strong></div>
        </div>
        <div class="match-meta" style="margin-top:12px"><span>${escapeHtml(format)}</span><span>${escapeHtml(formatTime(event.startTime))}</span></div>
      </button>`;
    }).join('');
  };

  function renderCommunityFinished(event) {
    const [a, b] = eventTeams(event);
    state.selectedMatchState = 'completed';
    state.selectedGameId = null;
    state.liveMatchIds.delete(eventKey(event));
    clearMatchTimers();
    gameContent.innerHTML = `<div class="empty hero-empty">
      <strong>Match finished · ${escapeHtml(a.name || 'Team 1')} ${Number(a.result?.gameWins || 0)}–${Number(b.result?.gameWins || 0)} ${escapeHtml(b.name || 'Team 2')}</strong>
      <span>Series result supplied by ${escapeHtml(event.communitySource || 'a community source')}. Detailed LPL telemetry remains unavailable.</span>
    </div>`;
    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    jsonPreview.textContent = JSON.stringify({
      status: 'finished',
      matchId: eventKey(event),
      source: event.communitySource || 'community',
      teams: [a, b].map(team => ({ id: team.id, name: team.name, code: team.code, wins: Number(team.result?.gameWins || 0) })),
      updatedAt: new Date().toISOString()
    }, null, 2);
    setConnection(`FINISHED · ${Number(a.result?.gameWins || 0)}–${Number(b.result?.gameWins || 0)} · ${event.communitySource || 'community'}`, '');
  }

  const baseSelectEvent = selectEvent;
  selectEvent = async function communitySelectEvent(id) {
    const event = state.events.find(item => eventKey(item) === String(id));
    if (event) applyCommunityState(event);
    if (event && displayState(event) === 'completed' && event.communitySource) {
      state.selectedEventId = String(id);
      state.scheduleTab = 'finished';
      renderSchedule();
      renderCommunityFinished(event);
      return;
    }
    return baseSelectEvent(id);
  };

  const baseLoadSchedule = loadSchedule;
  loadSchedule = async function communityLoadSchedule(...args) {
    const result = await baseLoadSchedule(...args);
    await fetchCommunityRows(false);
    state.events.forEach(event => applyCommunityState(event));
    renderSchedule();

    const selected = selectedScheduleEvent();
    if (selected && displayState(selected) === 'completed' && selected.communitySource) {
      renderCommunityFinished(selected);
    }
    return result;
  };

  installTabs();
  const footer = document.querySelector('footer');
  if (footer && !footer.querySelector('.build-mark')) {
    footer.insertAdjacentHTML('beforeend', `<span class="build-mark">Community sync · ${BUILD}</span>`);
  }

  setInterval(async () => {
    if (document.hidden) return;
    await fetchCommunityRows(true);
    state.events.forEach(event => applyCommunityState(event));
    renderSchedule();
  }, COMMUNITY_REFRESH_MS);

  setTimeout(async () => {
    await fetchCommunityRows(true);
    await loadSchedule(true);
  }, 0);
})();