// Frontend for the public LoL Live Analyzer Worker.
const WORKER_BASE = 'https://lol-live-analyzer-api.acchtt.workers.dev';
const GAME_POLL_MS = 15000;
const EVENT_RETRY_MS = 30000;
const SCHEDULE_POLL_MS = 30000;
const START_EARLY_WINDOW_MS = 5 * 60 * 1000;
const OVERDUE_LIVE_WINDOW_MS = 8 * 60 * 60 * 1000;

const state = {
  events: [],
  liveMatchIds: new Set(),
  selectedEventId: null,
  selectedGameId: null,
  selectedMatchState: null,
  pollTimer: null,
  eventRetryTimer: null,
  scheduleTimer: null,
  lastSnapshot: null
};

const scheduleList = document.querySelector('#scheduleList');
const gameContent = document.querySelector('#gameContent');
const connectionDot = document.querySelector('#connectionDot');
const connectionText = document.querySelector('#connectionText');
const jsonUrl = document.querySelector('#jsonUrl');
const jsonPreview = document.querySelector('#jsonPreview');
const copyJsonUrl = document.querySelector('#copyJsonUrl');

function setConnection(label, kind = '') {
  connectionText.textContent = label;
  connectionDot.className = `dot ${kind}`.trim();
}

async function api(path) {
  const separator = path.includes('?') ? '&' : '?';
  const endpoint = `${WORKER_BASE}${path}${separator}_=${Date.now()}`;
  let response;

  try {
    response = await fetch(endpoint, { cache: 'no-store' });
  } catch {
    throw new Error(`Network request blocked at ${path}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}) at ${path}`);
  }
  return data;
}

function formatTime(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function secureUrl(value = '') {
  return value.replace(/^http:\/\//i, 'https://');
}

function teamLogo(team) {
  return team?.image ? `<img src="${secureUrl(team.image)}" alt="">` : '';
}

function eventTeams(event) {
  const teams = event?.match?.teams || [];
  return [teams[0] || {}, teams[1] || {}];
}

function eventId(event) {
  return String(event?.match?.id || event?.id || '');
}

function eventStartMs(event) {
  const parsed = Date.parse(event?.startTime || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldResolveAsLive(event, now = Date.now()) {
  if (event?.state === 'inProgress' || state.liveMatchIds.has(eventId(event))) return true;
  if (event?.state !== 'unstarted') return false;

  const start = eventStartMs(event);
  if (start === null) return false;
  return start <= now + START_EARLY_WINDOW_MS && start >= now - OVERDUE_LIVE_WINDOW_MS;
}

function displayState(event) {
  if (state.liveMatchIds.has(eventId(event))) return 'inProgress';
  if (event?.state === 'unstarted' && shouldResolveAsLive(event)) return 'starting';
  return event?.state || 'unstarted';
}

function selectedScheduleEvent() {
  return state.events.find(event => eventId(event) === state.selectedEventId) || null;
}

function markMatchLive(id) {
  state.liveMatchIds.add(String(id));
  const event = state.events.find(item => eventId(item) === String(id));
  if (event && event.state !== 'completed') event.state = 'inProgress';
  renderSchedule();
}

function statusLabel(status) {
  const labels = {
    inProgress: 'LIVE',
    starting: 'STARTING',
    unstarted: 'UPCOMING',
    completed: 'FINISHED'
  };
  return labels[status] || String(status || 'UPCOMING').toUpperCase();
}

function sortEvents(events) {
  const priority = { inProgress: 0, starting: 1, unstarted: 2, completed: 3 };
  return [...events].sort((a, b) => {
    const aState = displayState(a);
    const bState = displayState(b);
    const stateDifference = (priority[aState] ?? 4) - (priority[bState] ?? 4);
    if (stateDifference !== 0) return stateDifference;

    const aTime = eventStartMs(a) || 0;
    const bTime = eventStartMs(b) || 0;
    return aState === 'completed' ? bTime - aTime : aTime - bTime;
  });
}

function renderSchedule() {
  if (!state.events.length) {
    scheduleList.innerHTML = '<div class="empty">No matches were returned.</div>';
    return;
  }

  state.events = sortEvents(state.events);
  scheduleList.innerHTML = state.events.map(event => {
    const id = eventId(event);
    const [a, b] = eventTeams(event);
    const status = displayState(event);

    return `<button class="match-card ${id === state.selectedEventId ? 'active' : ''}" data-event-id="${id}" type="button">
      <div class="match-meta"><span>${event.league?.name || event.league?.slug || 'LoL Esports'}</span><span class="match-state">${statusLabel(status)}</span></div>
      <div class="teams">
        <div class="team-line"><span class="team-name">${teamLogo(a)}${a.name || 'TBD'}</span><strong>${a.result?.gameWins ?? 0}</strong></div>
        <div class="team-line"><span class="team-name">${teamLogo(b)}${b.name || 'TBD'}</span><strong>${b.result?.gameWins ?? 0}</strong></div>
      </div>
      <div class="match-meta" style="margin-top:12px"><span>${event.match?.strategy?.type || ''} ${event.match?.strategy?.count || ''}</span><span>${formatTime(event.startTime)}</span></div>
    </button>`;
  }).join('');
}

function playerRows(players = []) {
  if (!players.length) return '<div class="empty">Player details unavailable.</div>';
  return players.map(player => `<div class="player-row">
    <strong>${player.name || `Player ${player.participantId || ''}`}</strong>
    <span>${player.kills ?? 0}/${player.deaths ?? 0}/${player.assists ?? 0}</span>
    <span>${player.creepScore ?? 0} CS</span>
  </div>`).join('');
}

function renderGame(snapshot) {
  state.lastSnapshot = snapshot;
  const blue = snapshot.blue || {};
  const red = snapshot.red || {};
  const scheduleEvent = selectedScheduleEvent();
  const league = snapshot.match?.league || scheduleEvent?.league?.name || 'LoL Esports';
  const stateText = state.selectedMatchState === 'completed' ? 'Final snapshot' : 'Live game';
  const frameTime = snapshot.source?.frameTimestamp
    ? `Frame ${new Date(snapshot.source.frameTimestamp).toLocaleTimeString()}`
    : 'Latest frame';

  gameContent.innerHTML = `
    <div class="game-header">
      <div class="game-title"><div><p class="eyebrow">${league} · ${stateText} · Game ${snapshot.match?.gameNumber || '?'}</p><h2>${blue.name || 'Blue'} vs ${red.name || 'Red'}</h2></div><div class="clock">${snapshot.clock || frameTime}</div></div>
    </div>
    <div class="score-grid">
      <div class="team-summary">${blue.image ? `<img src="${secureUrl(blue.image)}" alt="">` : ''}<h3>${blue.name || 'Blue side'}</h3><div class="big-score">${blue.kills ?? 0}</div><span>${(blue.gold ?? 0).toLocaleString()} gold</span></div>
      <div class="vs">KILLS</div>
      <div class="team-summary red">${red.image ? `<img src="${secureUrl(red.image)}" alt="">` : ''}<h3>${red.name || 'Red side'}</h3><div class="big-score">${red.kills ?? 0}</div><span>${(red.gold ?? 0).toLocaleString()} gold</span></div>
    </div>
    <div class="metrics">
      <div class="metric"><span>Gold diff</span><strong>${snapshot.differences?.gold > 0 ? '+' : ''}${(snapshot.differences?.gold ?? 0).toLocaleString()}</strong></div>
      <div class="metric"><span>Towers</span><strong>${blue.towers ?? 0} – ${red.towers ?? 0}</strong></div>
      <div class="metric"><span>Dragons</span><strong>${blue.dragons?.length ?? 0} – ${red.dragons?.length ?? 0}</strong></div>
      <div class="metric"><span>Barons</span><strong>${blue.barons ?? 0} – ${red.barons ?? 0}</strong></div>
      <div class="metric"><span>Inhibitors</span><strong>${blue.inhibitors ?? 0} – ${red.inhibitors ?? 0}</strong></div>
    </div>
    <div class="players"><div class="player-column">${playerRows(blue.players)}</div><div class="player-column">${playerRows(red.players)}</div></div>`;

  jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
}

function setJsonEndpoint(gameId, historical = false) {
  jsonUrl.value = `${WORKER_BASE}/api/chatgpt?gameId=${encodeURIComponent(gameId)}${historical ? '&historical=1' : ''}`;
  copyJsonUrl.disabled = false;
}

function clearMatchTimers() {
  clearInterval(state.pollTimer);
  clearTimeout(state.eventRetryTimer);
  state.pollTimer = null;
  state.eventRetryTimer = null;
}

function showUpcoming(event) {
  const [a, b] = eventTeams(event);
  gameContent.innerHTML = `<div class="empty hero-empty"><strong>Upcoming match</strong><span>${a.name || 'TBD'} vs ${b.name || 'TBD'} is scheduled for ${formatTime(event.startTime)}.</span></div>`;
  jsonUrl.value = '';
  copyJsonUrl.disabled = true;
  jsonPreview.textContent = JSON.stringify({
    status: 'upcoming',
    matchId: state.selectedEventId,
    scheduledStart: event.startTime || null
  }, null, 2);
  setConnection('Upcoming match', '');
}

function showTelemetryUnavailable(event, extra = {}) {
  const [a, b] = eventTeams(event || selectedScheduleEvent());
  const title = `${a.name || 'Team 1'} vs ${b.name || 'Team 2'}`;
  markMatchLive(state.selectedEventId);
  gameContent.innerHTML = `<div class="empty hero-empty"><strong>Live broadcast · stats unavailable</strong><span>${title} is live, but Riot is not publishing the live-stat telemetry feed for this game or league. The broadcast status will continue updating.</span></div>`;
  jsonUrl.value = '';
  copyJsonUrl.disabled = true;
  jsonPreview.textContent = JSON.stringify({
    status: 'live_without_telemetry',
    matchId: state.selectedEventId,
    checkedAt: extra.checkedAt || new Date().toISOString(),
    message: 'Riot is not publishing live-stat telemetry for this game or league.'
  }, null, 2);
  setConnection('LIVE · telemetry unavailable', 'live');
}

function showWaiting(event, resolution = {}) {
  if (resolution.broadcastLive && !resolution.selectedGame) {
    showTelemetryUnavailable(event, resolution);
    return;
  }

  const teams = event?.match?.teams || eventTeams(selectedScheduleEvent());
  const title = teams.length >= 2 ? `${teams[0].name} vs ${teams[1].name}` : 'Selected match';
  const completedGames = (resolution.games || []).filter(game => game.state === 'completed').length;
  const message = completedGames > 0
    ? `${title} is between games. Waiting for Riot to activate the next live telemetry feed…`
    : `${title} has reached its scheduled start, but no fresh telemetry frame is available yet. Checking again automatically…`;

  gameContent.innerHTML = `<div class="empty hero-empty"><strong>Waiting for live game data</strong><span>${message}</span></div>`;
  jsonUrl.value = '';
  copyJsonUrl.disabled = true;
  jsonPreview.textContent = JSON.stringify({
    status: 'waiting_for_live_feed',
    matchId: state.selectedEventId,
    checkedAt: resolution.checkedAt || new Date().toISOString(),
    broadcastLive: Boolean(resolution.broadcastLive),
    gameStates: (resolution.games || []).map(game => ({ id: game.id, number: game.number, state: game.state }))
  }, null, 2);
  setConnection('Waiting for live telemetry', '');
}

function scheduleResolverRetry(id) {
  clearTimeout(state.eventRetryTimer);
  state.eventRetryTimer = setTimeout(() => {
    if (state.selectedEventId === String(id) && !document.hidden) {
      resolveLiveEvent(id, true).catch(error => setConnection(error.message, 'error'));
    }
  }, EVENT_RETRY_MS);
}

async function resolveLiveEvent(id, isRetry = false) {
  state.selectedMatchState = 'inProgress';

  if (!isRetry) {
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Resolving game</strong><span>Checking Riot broadcast status and live telemetry…</span></div>';
  }

  const resolution = await api(`/api/resolve-game?matchId=${encodeURIComponent(id)}`);
  const event = resolution.event || selectedScheduleEvent() || {};
  const selected = resolution.selectedGame;

  if (resolution.broadcastLive || selected?.id) markMatchLive(id);

  if (!selected?.id) {
    showWaiting(event, resolution);
    scheduleResolverRetry(id);
    return;
  }

  state.selectedGameId = String(selected.id);
  setJsonEndpoint(state.selectedGameId);
  await loadGame();
  startPolling();
}

async function loadFinishedMatch(id) {
  gameContent.innerHTML = '<div class="empty hero-empty"><strong>Loading finished match</strong><span>Finding the most recent played game and its final telemetry frame…</span></div>';
  const payload = await api(`/api/match-details?matchId=${encodeURIComponent(id)}`);
  const event = payload.data?.event || payload.event || payload.data || payload;
  const games = Array.isArray(event?.match?.games) ? event.match.games : [];
  const playedGame = [...games].reverse().find(game => game.state === 'completed')
    || [...games].reverse().find(game => Array.isArray(game.vods) && game.vods.length > 0);

  if (!playedGame?.id) throw new Error('No completed game telemetry is available for this match.');

  state.selectedGameId = String(playedGame.id);
  state.selectedMatchState = 'completed';
  setJsonEndpoint(state.selectedGameId, true);
  await loadGame();
}

async function selectEvent(id) {
  state.selectedEventId = String(id);
  state.selectedGameId = null;
  state.selectedMatchState = null;
  clearMatchTimers();
  renderSchedule();

  const selectedEvent = selectedScheduleEvent();
  try {
    if (selectedEvent?.state === 'completed') {
      await loadFinishedMatch(id);
      return;
    }

    if (selectedEvent?.state === 'unstarted' && !shouldResolveAsLive(selectedEvent)) {
      state.selectedMatchState = 'unstarted';
      showUpcoming(selectedEvent);
      return;
    }

    await resolveLiveEvent(id);
  } catch (error) {
    setConnection(error.message, 'error');
    gameContent.innerHTML = `<div class="empty hero-empty"><strong>Game unavailable</strong><span>${error.message}</span></div>`;
  }
}

async function loadGame() {
  if (!state.selectedGameId || document.hidden) return;

  try {
    const historical = state.selectedMatchState === 'completed';
    const snapshot = await api(`/api/chatgpt?gameId=${encodeURIComponent(state.selectedGameId)}${historical ? '&historical=1' : ''}`);

    if (snapshot.status === 'telemetry_unavailable') {
      showTelemetryUnavailable(selectedScheduleEvent(), snapshot);
      return;
    }

    if (historical) snapshot.match = { ...(snapshot.match || {}), state: 'finished' };
    else markMatchLive(state.selectedEventId);

    renderGame(snapshot);
    if (historical) {
      setConnection('Finished · historical snapshot', '');
    } else {
      const frameTime = snapshot.source?.frameTimestamp
        ? new Date(snapshot.source.frameTimestamp).toLocaleTimeString()
        : new Date(snapshot.updatedAt).toLocaleTimeString();
      setConnection(`LIVE · frame ${frameTime}`, 'live');
    }
  } catch (error) {
    setConnection(error.message, 'error');
    gameContent.innerHTML = `<div class="empty hero-empty"><strong>Feed unavailable</strong><span>${error.message}</span></div>`;
  }
}

function startPolling() {
  if (state.selectedMatchState !== 'inProgress') return;
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadGame, GAME_POLL_MS);
}

async function loadSchedule(silent = false) {
  if (!silent) setConnection('Loading schedule…');

  try {
    const payload = await api('/api/schedule');
    const events = payload.data?.schedule?.events || payload.schedule?.events || payload.events || [];
    const supported = events.filter(event => ['inProgress', 'unstarted', 'completed'].includes(event.state));

    for (const event of supported) {
      const id = eventId(event);
      if (event.state === 'inProgress') state.liveMatchIds.add(id);
      if (event.state === 'completed') state.liveMatchIds.delete(id);
    }

    state.events = sortEvents(supported).slice(0, 80);
    renderSchedule();

    const selectedEvent = selectedScheduleEvent();
    if (
      selectedEvent?.state === 'unstarted' &&
      state.selectedMatchState === 'unstarted' &&
      shouldResolveAsLive(selectedEvent)
    ) {
      await resolveLiveEvent(state.selectedEventId);
      return;
    }

    if (!silent || !state.selectedEventId) {
      const liveCount = state.events.filter(event => displayState(event) === 'inProgress').length;
      const startingCount = state.events.filter(event => displayState(event) === 'starting').length;
      const finishedCount = state.events.filter(event => event.state === 'completed').length;
      setConnection(`Schedule connected · ${liveCount} live · ${startingCount} starting · ${finishedCount} finished`, 'live');
    }
  } catch (error) {
    if (!silent) {
      setConnection(error.message, 'error');
      scheduleList.innerHTML = `<div class="empty">${error.message}</div>`;
    }
  }
}

function startSchedulePolling() {
  clearInterval(state.scheduleTimer);
  state.scheduleTimer = setInterval(() => {
    if (!document.hidden) loadSchedule(true);
  }, SCHEDULE_POLL_MS);
}

scheduleList.addEventListener('click', event => {
  const card = event.target.closest('[data-event-id]');
  if (card?.dataset.eventId) selectEvent(card.dataset.eventId);
});

document.querySelector('#refreshSchedule').addEventListener('click', () => loadSchedule(false));
copyJsonUrl.addEventListener('click', async () => {
  await navigator.clipboard.writeText(jsonUrl.value);
  copyJsonUrl.textContent = 'Copied';
  setTimeout(() => { copyJsonUrl.textContent = 'Copy URL'; }, 1200);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  loadSchedule(true);

  if (state.selectedMatchState === 'inProgress' && state.selectedGameId) {
    loadGame();
  } else if (state.selectedMatchState === 'inProgress' && state.selectedEventId) {
    resolveLiveEvent(state.selectedEventId, true).catch(error => setConnection(error.message, 'error'));
  }
});

loadSchedule(false);
startSchedulePolling();