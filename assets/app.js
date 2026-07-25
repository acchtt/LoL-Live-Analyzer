// Replace this after deploying worker.js.
const WORKER_BASE = 'https://YOUR-WORKER.workers.dev';
const GAME_POLL_MS = 15000;

const state = {
  events: [],
  selectedEventId: null,
  selectedGameId: null,
  pollTimer: null,
  lastSnapshot: null
};

const scheduleList = document.querySelector('#scheduleList');
const gameContent = document.querySelector('#gameContent');
const connectionDot = document.querySelector('#connectionDot');
const connectionText = document.querySelector('#connectionText');
const jsonUrl = document.querySelector('#jsonUrl');
const jsonPreview = document.querySelector('#jsonPreview');
const copyJsonUrl = document.querySelector('#copyJsonUrl');

function configured() {
  return !WORKER_BASE.includes('YOUR-WORKER');
}

function setConnection(label, kind = '') {
  connectionText.textContent = label;
  connectionDot.className = `dot ${kind}`.trim();
}

async function api(path) {
  const response = await fetch(`${WORKER_BASE}${path}`, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatTime(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function teamLogo(team) {
  return team?.image ? `<img src="${team.image}" alt="">` : '';
}

function eventTeams(event) {
  const teams = event.match?.teams || [];
  return [teams[0] || {}, teams[1] || {}];
}

function renderSchedule() {
  if (!state.events.length) {
    scheduleList.innerHTML = '<div class="empty">No live or upcoming events were returned.</div>';
    return;
  }
  scheduleList.innerHTML = state.events.map(event => {
    const [a, b] = eventTeams(event);
    const status = event.state || 'unstarted';
    return `<button class="match-card ${event.id === state.selectedEventId ? 'active' : ''}" data-event-id="${event.id}" type="button">
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
      <div class="team-summary">${blue.image ? `<img src="${blue.image}" alt="">` : ''}<h3>${blue.name || 'Blue side'}</h3><div class="big-score">${blue.kills ?? 0}</div><span>${(blue.gold ?? 0).toLocaleString()} gold</span></div>
      <div class="vs">KILLS</div>
      <div class="team-summary red">${red.image ? `<img src="${red.image}" alt="">` : ''}<h3>${red.name || 'Red side'}</h3><div class="big-score">${red.kills ?? 0}</div><span>${(red.gold ?? 0).toLocaleString()} gold</span></div>
    </div>
    <div class="metrics">
      <div class="metric"><span>Gold diff</span><strong>${snapshot.differences?.gold > 0 ? '+' : ''}${(snapshot.differences?.gold ?? 0).toLocaleString()}</strong></div>
      <div class="metric"><span>Towers</span><strong>${blue.towers ?? 0} – ${red.towers ?? 0}</strong></div>
      <div class="metric"><span>Dragons</span><strong>${blue.dragons?.length ?? blue.dragons ?? 0} – ${red.dragons?.length ?? red.dragons ?? 0}</strong></div>
      <div class="metric"><span>Barons</span><strong>${blue.barons ?? 0} – ${red.barons ?? 0}</strong></div>
      <div class="metric"><span>Inhibitors</span><strong>${blue.inhibitors ?? 0} – ${red.inhibitors ?? 0}</strong></div>
    </div>
    <div class="players">
      <div class="player-column">${playerRows(blue.players)}</div>
      <div class="player-column">${playerRows(red.players)}</div>
    </div>`;
  jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
}

function setJsonEndpoint(gameId) {
  const url = `${WORKER_BASE}/api/chatgpt?gameId=${encodeURIComponent(gameId)}`;
  jsonUrl.value = url;
  copyJsonUrl.disabled = false;
}

async function selectEvent(eventId) {
  state.selectedEventId = eventId;
  state.selectedGameId = null;
  clearInterval(state.pollTimer);
  renderSchedule();
  gameContent.innerHTML = '<div class="empty hero-empty"><strong>Resolving game</strong><span>Loading event details…</span></div>';
  try {
    const event = await api(`/api/event?id=${encodeURIComponent(eventId)}`);
    const games = event.event?.match?.games || event.match?.games || [];
    const active = games.find(game => game.state === 'inProgress') || [...games].reverse().find(game => game.state !== 'unstarted');
    if (!active?.id) throw new Error('No active game is available for this match yet.');
    state.selectedGameId = String(active.id);
    setJsonEndpoint(state.selectedGameId);
    await loadGame();
    startPolling();
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
  }
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadGame, GAME_POLL_MS);
}

async function loadSchedule() {
  if (!configured()) {
    setConnection('Worker URL required', 'error');
    return;
  }
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
  if (card) selectEvent(card.dataset.eventId);
});

document.querySelector('#refreshSchedule').addEventListener('click', loadSchedule);
copyJsonUrl.addEventListener('click', async () => {
  await navigator.clipboard.writeText(jsonUrl.value);
  copyJsonUrl.textContent = 'Copied';
  setTimeout(() => { copyJsonUrl.textContent = 'Copy URL'; }, 1200);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.selectedGameId) loadGame();
});

loadSchedule();
