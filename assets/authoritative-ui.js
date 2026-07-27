// Final authority layer: render only normalized Worker snapshots and keep series scores fresh.
(() => {
  const style = document.createElement('style');
  style.textContent = `
    .authority-message { padding: 28px; }
    .authority-message p { margin: 10px 0 0; color: var(--muted); line-height: 1.5; }
    .authority-lineups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 22px; }
    .authority-lineup { background: rgba(255,255,255,.025); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
    .authority-lineup h3 { margin: 0 0 10px; }
    .authority-lineup .player-kda, .authority-lineup .player-cs { display: none; }
    .authority-badge { display: inline-flex; margin-top: 12px; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--accent); font-size: 12px; font-weight: 700; }
    @media (max-width: 760px) { .authority-lineups { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(style);

  function applySeries(series) {
    const teams = Array.isArray(series?.teams) ? series.teams : [];
    const event = selectedScheduleEvent();
    if (!event?.match?.teams || !teams.length) return;

    let changed = false;
    for (const eventTeam of event.match.teams) {
      const fresh = teams.find(team => String(team.id) === String(eventTeam.id));
      if (!fresh) continue;
      const wins = Number(fresh.wins || 0);
      eventTeam.result = { ...(eventTeam.result || {}), gameWins: wins };
      if (fresh.name) eventTeam.name = fresh.name;
      if (fresh.code) eventTeam.code = fresh.code;
      if (fresh.image) eventTeam.image = fresh.image;
      changed = true;
    }
    if (changed) renderSchedule();
  }

  function statusJson(snapshot) {
    jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
    if (state.selectedGameId) setJsonEndpoint(state.selectedGameId, state.selectedMatchState === 'completed');
  }

  function restoreHistoryNavigation() {
    if (typeof window.renderHistorySeriesSummary === 'function') {
      window.renderHistorySeriesSummary();
    }
  }

  function showPregame(snapshot, historical = false) {
    state.lastSnapshot = snapshot;
    const blue = snapshot.blue || {};
    const red = snapshot.red || {};
    const league = snapshot.match?.league || selectedScheduleEvent()?.league?.name || 'LoL Esports';
    const gameNumber = snapshot.match?.gameNumber || '?';

    if (historical) {
      gameContent.innerHTML = `
        <div class="authority-message">
          <p class="eyebrow">${league} · MATCH HISTORY · GAME ${gameNumber}</p>
          <h2>Archived game statistics unavailable</h2>
          <span class="authority-badge">PREGAME FRAME REJECTED</span>
          <p>Riot returned champion-select data but no progressing gameplay frame. RiftPulse will not display this as final game statistics.</p>
        </div>`;
      statusJson(snapshot);
      restoreHistoryNavigation();
      setConnection(`History · Game ${gameNumber} stats unavailable`, '');
      return;
    }

    markMatchLive(state.selectedEventId);
    gameContent.innerHTML = `
      <div class="authority-message">
        <p class="eyebrow">${league} · LIVE SERIES · GAME ${gameNumber}</p>
        <h2>${blue.name || 'Blue side'} vs ${red.name || 'Red side'}</h2>
        <span class="authority-badge">PREGAME / WAITING FOR VERIFIED STATS</span>
        <p>Riot has published the champion selections, but not a progressing gameplay frame. No kills, gold, CS, objective totals, or game clock are shown until the feed passes validation.</p>
        <div class="authority-lineups">
          <section class="authority-lineup"><h3>${blue.name || 'Blue side'}</h3>${playerRows(blue.players || [])}</section>
          <section class="authority-lineup"><h3>${red.name || 'Red side'}</h3>${playerRows(red.players || [])}</section>
        </div>
      </div>`;
    statusJson(snapshot);
    setConnection('LIVE · waiting for verified gameplay stats', 'live');
  }

  function showUnavailable(snapshot, historical = false) {
    state.lastSnapshot = snapshot;
    const event = selectedScheduleEvent();
    const [a, b] = eventTeams(event);
    const gameNumber = snapshot?.match?.gameNumber || state.historyMatch?.games?.find(game => String(game.id) === String(state.selectedGameId))?.number || '?';

    if (historical) {
      gameContent.innerHTML = `
        <div class="empty hero-empty">
          <strong>Archived Game ${gameNumber} stats unavailable</strong>
          <span>Riot did not retain a progressing gameplay frame for this game. No pregame or incomplete frame is being shown as the final result.</span>
        </div>`;
      statusJson(snapshot);
      restoreHistoryNavigation();
      setConnection(`History · Game ${gameNumber} archive unavailable`, '');
      return;
    }

    gameContent.innerHTML = `
      <div class="empty hero-empty">
        <strong>Live stats unavailable</strong>
        <span>${a.name || 'Team 1'} vs ${b.name || 'Team 2'} is active, but Riot has not returned a fresh verified telemetry frame. The dashboard will keep checking.</span>
      </div>`;
    statusJson(snapshot);
    setConnection('LIVE · stats unavailable', 'live');
  }

  function renderVerified(snapshot, historical) {
    state.lastSnapshot = snapshot;
    if (historical) snapshot.match = { ...(snapshot.match || {}), state: 'finished' };
    else markMatchLive(state.selectedEventId);
    renderGame(snapshot);
    const frameTime = snapshot.source?.frameTimestamp
      ? new Date(snapshot.source.frameTimestamp).toLocaleTimeString()
      : new Date(snapshot.updatedAt).toLocaleTimeString();
    setConnection(historical ? 'Finished · verified historical snapshot' : `LIVE · verified frame ${frameTime}`, historical ? '' : 'live');
  }

  loadGame = async function authoritativeLoadGame() {
    if (!state.selectedGameId || document.hidden) return;

    try {
      const historical = state.selectedMatchState === 'completed';
      const sameGame = String(state.lastSnapshot?.source?.gameId || '') === String(state.selectedGameId);
      const after = !historical && sameGame ? state.lastSnapshot?.source?.frameTimestamp : null;
      const query = new URLSearchParams({ gameId: state.selectedGameId });
      if (historical) query.set('historical', '1');
      if (after) query.set('after', after);

      const snapshot = await api(`/api/chatgpt?${query.toString()}`);
      applySeries(snapshot.series);

      if (snapshot.status === 'pregame') {
        showPregame(snapshot, historical);
        return;
      }
      if (snapshot.status !== 'ok') {
        showUnavailable(snapshot, historical);
        return;
      }
      renderVerified(snapshot, historical);
    } catch (error) {
      setConnection(error.message, 'error');
      gameContent.innerHTML = `<div class="empty hero-empty"><strong>Feed unavailable</strong><span>${error.message}</span></div>`;
      if (state.selectedMatchState === 'completed') restoreHistoryNavigation();
    }
  };
})();
