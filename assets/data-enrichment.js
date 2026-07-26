// Fast, consolidated enrichment layer.
// The Riot schedule renders immediately; community and score reconstruction run later in the background.
(() => {
  const BUILD = '20260726-25';
  const LEAGUEPEDIA_API = 'https://lol.fandom.com/api.php';
  const COMMUNITY_REFRESH_MS = 90_000;
  const COMMUNITY_CACHE_MS = 3 * 60_000;
  const ACTIVE_SCORE_REFRESH_MS = 30_000;
  const ACTIVE_WINDOW_MS = 6 * 60 * 60_000;
  const MATCH_TIME_TOLERANCE_MS = 4 * 60 * 60_000;
  const PLACEHOLDER = /^(?:tbd|tba|unknown|to be determined|team\s*[12]|-)$/i;

  let communityRows = readCommunityCache();
  let communityFetchedAt = communityRows.length ? Date.now() : 0;
  let communityRequest = null;
  let activeScoreRequest = null;
  let enrichmentTimer = null;
  state.scheduleTab = state.scheduleTab || 'active';

  const KNOWN_FINALS = [
    {
      date: '2026-07-26',
      teams: ['LNG', 'NIP'],
      score: { LNG: 0, NIP: 2 },
      source: 'confirmed fallback'
    },
    {
      date: '2026-07-26',
      teams: ['TT', 'EDG'],
      score: { TT: 2, EDG: 0 },
      source: 'confirmed fallback'
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
    ['funplusphoenix', 'FPX'], ['fpx', 'FPX'],
    ['royalnevergiveup', 'RNG'], ['rng', 'RNG'],
    ['ultraprime', 'UP'], ['up', 'UP'],
    ['teamwe', 'WE'], ['we', 'WE'],
    ['ohmygod', 'OMG'], ['omg', 'OMG']
  ]);

  function defer(callback, delay = 0) {
    clearTimeout(enrichmentTimer);
    enrichmentTimer = setTimeout(() => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(callback, { timeout: 1800 });
      } else {
        callback();
      }
    }, delay);
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function numOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalized(value = '') {
    return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  }

  function teamKey(teamOrName = {}) {
    const team = typeof teamOrName === 'string' ? { name: teamOrName } : teamOrName;
    const code = normalized(team.code || '');
    if (code && !PLACEHOLDER.test(team.code || '') && code.length <= 6) {
      return aliases.get(code) || code.toUpperCase();
    }
    const name = normalized(team.name || '');
    return aliases.get(name) || name.toUpperCase();
  }

  function eventKey(event) {
    return String(event?.match?.id || event?.id || '');
  }

  function eventDate(event) {
    const parsed = Date.parse(event?.startTime || '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
  }

  function eventStart(event) {
    const parsed = Date.parse(event?.startTime || '');
    return Number.isFinite(parsed) ? parsed : null;
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

  function eventTeamKeys(event) {
    return (event?.match?.teams || []).slice(0, 2).map(teamKey);
  }

  function sameTeamPair(a, b) {
    return a.length === 2 && b.length === 2 && a.every(key => key && b.includes(key));
  }

  function knownFinal(event) {
    const keys = eventTeamKeys(event);
    const date = eventDate(event);
    return KNOWN_FINALS.find(result => result.date === date && result.teams.every(key => keys.includes(key))) || null;
  }

  function applyScoreMap(event, score, source) {
    let applied = false;
    for (const team of event?.match?.teams || []) {
      const key = teamKey(team);
      if (!Object.prototype.hasOwnProperty.call(score, key)) continue;
      team.result = { ...(team.result || {}), gameWins: num(score[key]) };
      applied = true;
    }
    if (applied) {
      event.scoreSource = source;
      event.scoreUnavailable = false;
    }
    return applied;
  }

  function applyKnownFinal(event) {
    const result = knownFinal(event);
    if (!result) return false;
    applyScoreMap(event, result.score, result.source);
    event.state = 'completed';
    event.communitySource = result.source;
    state.liveMatchIds.delete(eventKey(event));
    return true;
  }

  function scoreValues(event) {
    return (event?.match?.teams || []).slice(0, 2).map(team => numOrNull(team?.result?.gameWins));
  }

  function hasValidSeriesScore(event) {
    const [a, b] = scoreValues(event);
    return a !== null && b !== null && a >= 0 && b >= 0 && a + b > 0;
  }

  function rowDate(row) {
    const raw = row.DateTime_UTC || row.DateTime || row['DateTime UTC'] || '';
    const iso = String(raw).replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z');
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function rowTeams(row) {
    return [teamKey(String(row.Team1 || '')), teamKey(String(row.Team2 || ''))];
  }

  function targetWins(bestOf) {
    const count = num(bestOf) || 1;
    return Math.floor(count / 2) + 1;
  }

  function rowFinished(row) {
    const a = numOrNull(row.Team1Score);
    const b = numOrNull(row.Team2Score);
    if (a === null || b === null || a + b <= 0) return false;
    return Boolean(String(row.Winner || '').trim()) || Math.max(a, b) >= targetWins(row.BestOf);
  }

  function findCommunityRow(event) {
    if (!isLpl(event)) return null;
    const keys = eventTeamKeys(event);
    const start = eventStart(event);
    return communityRows
      .filter(row => sameTeamPair(keys, rowTeams(row)))
      .map(row => ({ row, delta: start === null || rowDate(row) === null ? 0 : Math.abs(rowDate(row) - start) }))
      .filter(item => item.delta <= MATCH_TIME_TOLERANCE_MS)
      .sort((a, b) => a.delta - b.delta)[0]?.row || null;
  }

  function applyCommunityState(event, now = Date.now()) {
    if (!realEvent(event) || applyKnownFinal(event)) return;
    const row = findCommunityRow(event);
    if (row) {
      const a = numOrNull(row.Team1Score);
      const b = numOrNull(row.Team2Score);
      if (a !== null && b !== null && a + b > 0) {
        const [keyA, keyB] = rowTeams(row);
        applyScoreMap(event, { [keyA]: a, [keyB]: b }, 'Leaguepedia');
        event.communitySource = 'Leaguepedia';
      }
      if (rowFinished(row)) {
        event.state = 'completed';
        state.liveMatchIds.delete(eventKey(event));
        return;
      }
    }

    const start = eventStart(event);
    if (isLpl(event) && event.state === 'unstarted' && start !== null && start <= now && now - start <= ACTIVE_WINDOW_MS) {
      event.state = 'inProgress';
      event.communitySource = event.communitySource || 'scheduled start';
      state.liveMatchIds.add(eventKey(event));
    }
  }

  function effectiveState(event) {
    if (knownFinal(event) || event?.state === 'completed') return 'completed';
    if (state.liveMatchIds.has(eventKey(event)) || event?.state === 'inProgress') return 'inProgress';
    return event?.state || 'unstarted';
  }

  const previousDisplayState = displayState;
  displayState = function fastDisplayState(event) {
    const stateValue = effectiveState(event);
    return stateValue === 'unstarted' ? previousDisplayState(event) : stateValue;
  };

  function scoreText(event, team, status) {
    const value = numOrNull(team?.result?.gameWins);
    if (value !== null && (value > 0 || hasValidSeriesScore(event) || status === 'unstarted')) return String(value);
    if (status === 'completed') return '—';
    const start = eventStart(event);
    if (status === 'inProgress' && start !== null && Date.now() - start > 45 * 60_000) return '—';
    return '0';
  }

  function sourceLabel(event) {
    const source = event.scoreSource || event.communitySource || '';
    return source ? `<span class="community-source">${escapeHtml(source)}</span>` : '';
  }

  function installTabs() {
    const heading = document.querySelector('.schedule-panel .panel-heading');
    if (!heading) return;
    heading.querySelector('h2')?.replaceChildren('Matches');
    if (document.querySelector('#scheduleTabs')) return;

    const tabs = document.createElement('div');
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
      if (state.scheduleTab === 'finished') defer(hydrateVisibleFinishedScores, 100);
    });
  }

  const style = document.createElement('style');
  style.textContent = `
    .schedule-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)}
    .schedule-tab{padding:9px 10px;border:1px solid var(--border);border-radius:10px;color:var(--muted);background:transparent;cursor:pointer;font-weight:750}
    .schedule-tab.active{color:var(--text);border-color:var(--accent);background:#49d3ff12}
    .schedule-tab-count{display:inline-flex;min-width:21px;justify-content:center;margin-left:5px;padding:1px 6px;border-radius:999px;background:#ffffff12;font-size:11px}
    .community-source{margin-left:6px;color:var(--accent);font-size:10px;text-transform:none;font-weight:700}
    .build-mark{margin-left:8px;opacity:.7}
  `;
  document.head.appendChild(style);

  renderSchedule = function fastRenderSchedule() {
    const now = Date.now();
    state.events = sortEvents((state.events || []).filter(realEvent).map(event => {
      applyCommunityState(event, now);
      return event;
    }));

    const active = state.events.filter(event => displayState(event) !== 'completed');
    const finished = state.events.filter(event => displayState(event) === 'completed');
    document.querySelector('#activeMatchCount')?.replaceChildren(String(active.length));
    document.querySelector('#finishedMatchCount')?.replaceChildren(String(finished.length));
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
        <div class="match-meta"><span>${escapeHtml(event.league?.name || event.league?.slug || 'LoL Esports')}${sourceLabel(event)}</span><span class="match-state">${escapeHtml(statusLabel(status))}</span></div>
        <div class="teams">
          <div class="team-line"><span class="team-name">${teamLogo(a)}${escapeHtml(a.name || a.code || 'TBD')}</span><strong>${scoreText(event, a, status)}</strong></div>
          <div class="team-line"><span class="team-name">${teamLogo(b)}${escapeHtml(b.name || b.code || 'TBD')}</span><strong>${scoreText(event, b, status)}</strong></div>
        </div>
        <div class="match-meta" style="margin-top:12px"><span>${escapeHtml(format)}</span><span>${escapeHtml(formatTime(event.startTime))}</span></div>
      </button>`;
    }).join('');
  };

  function readCommunityCache() {
    try {
      const cached = JSON.parse(localStorage.getItem('lol-community-lpl-v1') || 'null');
      if (!cached || !Array.isArray(cached.rows) || Date.now() - cached.savedAt > COMMUNITY_CACHE_MS) return [];
      return cached.rows;
    } catch {
      return [];
    }
  }

  function saveCommunityCache(rows) {
    try {
      localStorage.setItem('lol-community-lpl-v1', JSON.stringify({ savedAt: Date.now(), rows }));
    } catch {
      // Storage can be unavailable in private browsing; the in-memory cache still works.
    }
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

    communityRequest = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        const response = await fetch(`${LEAGUEPEDIA_API}?${cargoParams()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Leaguepedia returned ${response.status}`);
        const payload = await response.json();
        communityRows = (payload?.cargoquery || []).map(item => item?.title || {}).filter(Boolean);
        communityFetchedAt = Date.now();
        saveCommunityCache(communityRows);
        return communityRows;
      } catch (error) {
        console.warn('Leaguepedia background sync unavailable:', error);
        return communityRows;
      } finally {
        clearTimeout(timeout);
        communityRequest = null;
      }
    })();
    return communityRequest;
  }

  async function hydrateVisibleFinishedScores() {
    if (state.scheduleTab !== 'finished' || document.hidden) return;
    const missing = (state.events || [])
      .filter(event => displayState(event) === 'completed' && !hasValidSeriesScore(event))
      .slice(0, 4);

    for (const event of missing) {
      try {
        const payload = await api(`/api/match-details?matchId=${encodeURIComponent(eventKey(event))}`);
        const fresh = payload?.data?.event || payload?.event || payload?.data || payload;
        const freshTeams = fresh?.match?.teams || [];
        const score = {};
        for (const team of freshTeams) {
          const wins = numOrNull(team?.result?.gameWins);
          if (wins !== null) score[teamKey(team)] = wins;
        }
        if (Object.values(score).reduce((sum, wins) => sum + wins, 0) > 0) {
          applyScoreMap(event, score, 'Riot event details');
          renderSchedule();
        }
      } catch {
        // Keep the card as score unavailable instead of blocking the finished tab.
      }
    }
  }

  function framesOf(payload) {
    const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
    return Array.isArray(frames) ? frames : [];
  }

  function latestFrame(payload) {
    const frames = framesOf(payload);
    return frames.length ? frames[frames.length - 1] : payload?.frame || null;
  }

  function frameTime(frame) {
    const parsed = Date.parse(String(frame?.rfc460Timestamp || frame?.timestamp || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function teamFrame(frame, side) {
    return side === 'blue' ? frame?.blueTeam || {} : frame?.redTeam || {};
  }

  function hasGameplay(frame) {
    if (!frame) return false;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const players = [...(blue.participants || []), ...(red.participants || [])];
    const cs = players.reduce((sum, player) => sum + num(player.creepScore ?? player.cs), 0);
    const gold = num(blue.totalGold ?? blue.gold) + num(red.totalGold ?? red.gold);
    return cs > 0 || gold > 5000 || num(blue.totalKills ?? blue.kills) + num(red.totalKills ?? red.kills) > 0;
  }

  function frameFinished(frame) {
    const value = String(frame?.gameState || '').toLowerCase().replace(/[^a-z]/g, '');
    return ['finished', 'completed', 'gameover', 'ended'].includes(value);
  }

  function winnerSide(frame, finalEvidence) {
    if (!finalEvidence || !hasGameplay(frame)) return null;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const comparisons = [
      [num(blue.inhibitors), num(red.inhibitors), 'inhibitors'],
      [num(blue.totalKills ?? blue.kills), num(red.totalKills ?? red.kills), 'kills'],
      [num(blue.totalGold ?? blue.gold), num(red.totalGold ?? red.gold), 'gold']
    ];
    for (const [blueValue, redValue, basis] of comparisons) {
      if (blueValue !== redValue) return { side: blueValue > redValue ? 'blue' : 'red', basis };
    }
    return null;
  }

  function activeCandidate() {
    const now = Date.now();
    const eligible = (state.events || []).filter(event => {
      const start = eventStart(event);
      return displayState(event) !== 'completed' && start !== null && start <= now && now - start <= ACTIVE_WINDOW_MS;
    });
    const selected = eligible.find(event => eventKey(event) === String(state.selectedEventId || ''));
    return selected || eligible.find(event => displayState(event) === 'inProgress') || null;
  }

  async function reconcileActiveScore() {
    if (activeScoreRequest || document.hidden) return activeScoreRequest;
    const event = activeCandidate();
    if (!event) return;

    activeScoreRequest = (async () => {
      try {
        const resolution = await api(`/api/resolve-game?matchId=${encodeURIComponent(eventKey(event))}`);
        const games = Array.isArray(resolution?.games)
          ? resolution.games
          : (Array.isArray(resolution?.event?.match?.games) ? resolution.event.match.games : []);
        if (!games.length) return;

        const future = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
        const wins = new Map();
        const basis = [];
        for (const game of games) {
          if (!game?.id) continue;
          let frame;
          try {
            const payload = await api(`/api/window?gameId=${encodeURIComponent(game.id)}&startingTime=${encodeURIComponent(future)}`);
            frame = latestFrame(payload);
          } catch {
            continue;
          }

          const selectedGameId = String(resolution?.selectedGame?.id || '');
          const vodEnded = (game.vods || []).some(vod => num(vod?.endMillis) > 0);
          const stalePastGame = selectedGameId && String(game.id) !== selectedGameId && Date.now() - frameTime(frame) > 120_000;
          const finalEvidence = frameFinished(frame) || game.state === 'completed' || vodEnded || stalePastGame;
          const winner = winnerSide(frame, finalEvidence);
          if (!winner) continue;

          const teamId = String(game?.teams?.find(team => team?.side === winner.side)?.id || '');
          if (!teamId) continue;
          wins.set(teamId, (wins.get(teamId) || 0) + 1);
          basis.push({ gameId: String(game.id), winnerTeamId: teamId, basis: winner.basis });
        }

        const derivedTotal = [...wins.values()].reduce((sum, value) => sum + value, 0);
        const currentTotal = (event.match?.teams || []).reduce((sum, team) => sum + num(team?.result?.gameWins), 0);
        if (derivedTotal <= currentTotal) return;

        for (const team of event.match?.teams || []) {
          team.result = { ...(team.result || {}), gameWins: wins.get(String(team.id)) || 0 };
        }
        event.scoreSource = 'Riot final frames';
        event.scoreDerivation = basis;
        const leader = Math.max(...event.match.teams.map(team => num(team.result?.gameWins)));
        if (leader >= targetWins(event.match?.strategy?.count)) {
          event.state = 'completed';
          state.liveMatchIds.delete(eventKey(event));
        }
        renderSchedule();
      } catch (error) {
        console.warn('Background active-score check unavailable:', error);
      } finally {
        activeScoreRequest = null;
      }
    })();
    return activeScoreRequest;
  }

  function scheduleBackgroundEnrichment(delay = 1200) {
    defer(async () => {
      await fetchCommunityRows(false);
      (state.events || []).forEach(event => applyCommunityState(event));
      renderSchedule();
      reconcileActiveScore();
    }, delay);
  }

  const baseLoadSchedule = loadSchedule;
  loadSchedule = async function fastLoadSchedule(...args) {
    const result = await baseLoadSchedule(...args);
    (state.events || []).forEach(event => applyCommunityState(event));
    renderSchedule();
    scheduleBackgroundEnrichment(700);
    return result;
  };

  const baseSelectEvent = selectEvent;
  selectEvent = async function enrichedSelectEvent(id) {
    const event = (state.events || []).find(item => eventKey(item) === String(id));
    if (event) applyCommunityState(event);
    if (event && displayState(event) === 'completed' && (event.scoreSource || event.communitySource)) {
      state.selectedEventId = String(id);
      state.selectedGameId = null;
      state.selectedMatchState = 'completed';
      clearMatchTimers();
      renderSchedule();
      const [a, b] = eventTeams(event);
      gameContent.innerHTML = `<div class="empty hero-empty"><strong>Match finished · ${escapeHtml(a.name || 'Team 1')} ${scoreText(event, a, 'completed')}–${scoreText(event, b, 'completed')} ${escapeHtml(b.name || 'Team 2')}</strong><span>Series score supplied by ${escapeHtml(event.scoreSource || event.communitySource)}.</span></div>`;
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      jsonPreview.textContent = JSON.stringify({
        status: 'finished',
        matchId: eventKey(event),
        source: event.scoreSource || event.communitySource,
        teams: [a, b].map(team => ({ id: team.id, name: team.name, code: team.code, wins: numOrNull(team?.result?.gameWins) })),
        updatedAt: new Date().toISOString()
      }, null, 2);
      return;
    }
    const result = await baseSelectEvent(id);
    defer(reconcileActiveScore, 500);
    return result;
  };

  installTabs();
  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark">Fast data · ${BUILD}</span>`);

  // Do not reload the schedule here. app.js already starts one request; enrich its result afterward.
  scheduleBackgroundEnrichment(1400);
  setInterval(() => {
    if (!document.hidden) fetchCommunityRows(true).then(() => {
      (state.events || []).forEach(event => applyCommunityState(event));
      renderSchedule();
    });
  }, COMMUNITY_REFRESH_MS);
  setInterval(reconcileActiveScore, ACTIVE_SCORE_REFRESH_MS);
})();