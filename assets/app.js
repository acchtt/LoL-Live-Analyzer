// Public Cloudflare Worker for Riot LoL Esports data.
const WORKER_BASE = 'https://lol-live-analyzer-api.acchtt.workers.dev';
const GAME_POLL_MS = 15000;
const EVENT_RETRY_MS = 15000;

const state = {
  events: [],
  selectedEventId: null,
  selectedGameId: null,
  pollTimer: null,
  eventRetryTimer: null,
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
  const endpoint = `${WORKER_BASE}${path}`;
  let response;
  try {
    response = await fetch(endpoint);
  } catch {
    throw new Error(`Network request blocked at ${path}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}) at ${path}`);
  return data;
}

function formatTime(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

function secureUrl(value = '') {
  return value.replace(/^http:\/\//i, 'https://');
}

function teamLogo(team) {
  return team?.image ? `<img src="${secureUrl(team.image)}" alt="">` : '';
}

function eventTeams(event) {
  const teams = event.match?.teams || [];
  return [teams[0] || {}, teams[1] || {}];
}

function eventId(event) {
  return String(event?.match?.id || event?.id || '');
}

function renderSchedule() {
  if (!state.events.length) {
    scheduleList.innerHTML = '<div class="empty">No live or upcoming events were returned.</div>';
    return;
  }

  scheduleList.innerHTML = state.events.map(event => {
    const id = eventId(event);
    const [a, b] = eventTeams(event);
    const status = event.state || 'unstarted';
    return `<button class="match-card ${id === state.selectedEventId ? 'active' : ''}" data-event-id="${id}" type="button">
      <div class="match-meta"><span>${event.league?.name || event.league?.slug || 'LoL Esports'}</span><span class="match-state">${status}</span></div>
      <div class="teams">
        <div class="team-line"><span class="team-name">${teamLogo(a)}${a.name || 'TBD'}</span><strong>${a.result?.gameWins ?? 0}</strong></div>
        <div class="team-line"><span class="team-name">${teamLogo(b)}${b.name || 'TBD'}</span><strong>${b.result?.gameWins ?? 0}</strong></div>
      </div>
      <div class="match-meta" style="margin-top:12px"><span>${event.match?.strategy?.type || ''} ${event.match?.strategy?.count || ''}</span><span>${formatTime(event.startTime)}</span></div>
    </button>`;
  }).join('');
}

function playerRows(players = []) {
  return players.map(player => `<div class="player-row">
    <strong>${player.name || player.summonerName || `Player ${player.participantId || ''}`}</strong>
    <span>${player.kills ?? 0}/${player.deaths ?? 0}/${player.assists ?? 0}</span>
    <span>${player.creepScore ?? player.cs ?? 0} CS</span>
  </div>`).join('');
}

function renderGame(snapshot) {
  state.lastSnapshot = snapshot;
  const blue = snapshot.blue || {};
  const red = snapshot.red || {};
  gameContent.innerHTML = `
    <div class="game-header">
      <div class="game-title"><div><p class="eyebrow">${snapshot.match?.league || 'Live game'} · Game ${snapshot.match?.gameNumber || '?'}</p><h2>${blue.name || 'Blue'} vs ${red.name || 'Red'}</h2></div><div class="clock">${snapshot.clock || '--:--'}</div></div>
    </div>
    <div class="score-grid">
      <div class="team-summary">${blue.image ? `<img src="${secureUrl(blue.image)}" alt="">` : ''}<h3>${blue.name || 'Blue side'}</h3><div class="big-score">${blue.kills ?? 0}</div><span>${(blue.gold ?? 0).toLocaleString()} gold</span></div>
      <div class="vs">KILLS</div>
      <div class="team-summary red">${red.image ? `<img src="${secureUrl(red.image)}" alt="">` : ''}<h3>${red.name || 'Red side'}</h3><div class="big-score">${red.kills ?? 0}</div><span>${(red.gold ?? 0).toLocaleString()} gold</span></div>
    </div>
    <div class="metrics">
      <div class="metric"><span>Gold diff</span><strong>${snapshot.differences?.gold > 0 ? '+' : ''}${(snapshot.differences?.gold ?? 0).toLocaleString()}</strong></div>
      <div class="metric"><span>Towers</span><strong>${blue.towers ?? 0} – ${red.towers ?? 0}</strong></div>
      <div class="metric"><span>Dragons</span><strong>${blue.dragons?.length ?? blue.dragons ?? 0} – ${red.dragons?.length ?? red.dragons ?? 0}</strong></div>
      <div class="metric"><span>Barons</span><strong>${blue.barons ?? 0} – ${red.barons ?? 0}</strong></div>
      <div class="metric"><span>Inhibitors</span><strong>${blue.inhibitors ?? 0} – ${red.inhibitors ?? 0}</strong></div>
    </div>
    <div class="players"><div class="player-column">${playerRows(blue.players)}</div><div class="player-column">${playerRows(red.players)}</div></div>`;
  jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
}

function setJsonEndpoint(gameId) {
  const url = `${WORKER_BASE}/api/chatgpt?gameId=${encodeURIComponent(gameId)}`;
  jsonUrl.value = url;
  copyJsonUrl.disabled = false;
}

function clearTimers() {
  clearInterval(state.pollTimer);
  clearTimeout(state.eventRetryTimer);
  state.pollTimer = null;
  state.eventRetryTimer = null;
}

function showWaiting(event) {
  const teams = event?.match?.teams || [];
  const title = teams.length >= 2 ? `${teams[0].name} vs ${teams[1].name}` : 'Selected match';
  gameContent.innerHTML = `<div class="empty hero-empty"><strong>Waiting for game to start</strong><span>${title} is listed as in progress, but Riot still marks every game as unstarted. Checking again automatically…</span></div>`;
  jsonUrl.value = '';
  copyJsonUrl.disabled = true;
  jsonPreview.textContent = JSON.stringify({
    status: 'waiting_for_game',
    eventId: state.selectedEventId,
    reason: 'Riot event details report all games as unstarted'
  }, null, 2);
  setConnection('Waiting for live game data', '');
}

async function resolveEvent(id, isRetry = false) {
  if (!isRetry) {
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Resolving game</strong><span>Loading match details…</span></div>';
  }

  const payload = await api(`/api/match-details?matchId=${encodeURIComponent(id)}`);
  const event = payload.data?.event || payload.event || payload.data || payload;
  const games = event?.match?.games || event?.games || [];
  const active = games.find(game => game.state === 'inProgress');
  const completed = [...games].reverse().find(game => game.state === 'completed');
  const selected = active || completed;

  if (!selected?.id) {
    showWaiting(event);
    state.eventRetryTimer = setTimeout(() => {
      if (state.selectedEventId === String(id) && !document.hidden) {
        resolveEvent(id, true).catch(error => setConnection(error.message, 'error'));
      }
    }, EVENT_RETRY_MS);
    return;
  }

  state.selectedGameId = String(selected.id);
  setJsonEndpoint(state.selectedGameId);
  await loadGame();
  startPolling();
}

async function selectEvent(id) {
  state.selectedEventId = String(id);
  state.selectedGameId = null;
  clearTimers();
  renderSchedule();
  try {
    await resolveEvent(id);
  } catch (error) {
    setConnection(error.message, 'error');
    gameContent.innerHTML = `<div class="empty hero-empty"><strong>Game unavailable</strong><span>${error.message}</span></div>`;
  }
}

async function loadGame() {
  if (!state.selectedGameId || document.hidden) return;
  try {
    const snapshot = await api(`/api/chatgpt?gameId=${encodeURIComponent(state.selectedGameId)}`);
    renderGame(snapshot);
    setConnection(`Live · updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}`, 'live');
  } catch (error) {
    setConnection(error.message, 'error');
    gameContent.innerHTML = `<div class="empty hero-empty"><strong>Live feed unavailable</strong><span>${error.message}</span></div>`;
  }
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadGame, GAME_POLL_MS);
}

async function loadSchedule() {
  setConnection('Loading schedule…');
  try {
    const payload = await api('/api/schedule');
    const events = payload.data?.schedule?.events || payload.schedule?.events || payload.events || [];
    state.events = events.filter(event => ['inProgress', 'unstarted'].includes(event.state)).slice(0, 40);
    renderSchedule();
    setConnection('Schedule connected', 'live');
  } catch (error) {
    setConnection(error.message, 'error');
    scheduleList.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

scheduleList.addEventListener('click', event => {
  const card = event.target.closest('[data-event-id]');
  if (card?.dataset.eventId) selectEvent(card.dataset.eventId);
});

document.querySelector('#refreshSchedule').addEventListener('click', loadSchedule);
copyJsonUrl.addEventListener('click', async () => {
  await navigator.clipboard.writeText(jsonUrl.value);
  copyJsonUrl.textContent = 'Copied';
  setTimeout(() => { copyJsonUrl.textContent = 'Copy URL'; }, 1200);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (state.selectedGameId) loadGame();
  else if (state.selectedEventId) resolveEvent(state.selectedEventId, true).catch(error => setConnection(error.message, 'error'));
});

loadSchedule();