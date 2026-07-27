// Restores every played game's archived snapshot in completed-series history.
(() => {
  'use strict';

  const style = document.createElement('style');
  style.dataset.riftpulseSeriesHistory = 'all-games';
  style.textContent = `
    .history-game-nav { display: flex !important; }
    .history-summary-meta::after { content: none !important; display: none !important; }
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

  function finiteScore(team = {}) {
    const value = team?.result?.gameWins;
    const parsed = Number(value);
    return value === undefined || value === null || !Number.isFinite(parsed) || parsed < 0
      ? null
      : parsed;
  }

  function gameNumber(game, index) {
    const parsed = Number(game?.number);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 1;
  }

  function hasCompletionEvidence(game) {
    return game?.state === 'completed' || (Array.isArray(game?.vods) && game.vods.length > 0);
  }

  function playedGames(event = {}) {
    const rawGames = (Array.isArray(event?.match?.games) ? event.match.games : [])
      .filter(game => game?.id)
      .sort((left, right) => Number(left?.number || 0) - Number(right?.number || 0));
    if (!rawGames.length) return [];

    const scores = (event?.match?.teams || []).map(finiteScore);
    const scoreCount = scores.length >= 2 && scores.every(score => score !== null)
      ? scores.reduce((sum, score) => sum + score, 0)
      : 0;

    const evidenceCount = rawGames.reduce((highest, game, index) => (
      hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index)) : highest
    ), 0);

    // Riot occasionally marks only the last game completed. A final Game 3 plus a
    // 2-1 series score still means Games 1-3 were played, even if Games 1-2 have
    // stale state flags. Never use the best-of length because sweeps leave games unplayed.
    const playedCount = Math.min(rawGames.length, Math.max(scoreCount, evidenceCount));
    if (playedCount > 0) return rawGames.slice(0, playedCount);
    return rawGames.filter(hasCompletionEvidence);
  }

  function renderSeriesNavigation() {
    if (state.selectedMatchState !== 'completed' || !state.historyMatch) return;
    if (typeof document?.querySelector !== 'function' || typeof document?.createElement !== 'function'
        || typeof gameContent?.insertBefore !== 'function') return;
    document.querySelector('#historySeriesSummary')?.remove();

    const event = state.historyMatch.event || selectedScheduleEvent() || {};
    const teams = eventTeams(event);
    const a = teams[0] || {};
    const b = teams[1] || {};
    const games = state.historyMatch.games || [];
    const aScore = finiteScore(a);
    const bScore = finiteScore(b);
    const summary = document.createElement('section');
    summary.id = 'historySeriesSummary';
    summary.className = 'history-series-summary';
    summary.innerHTML = `
      <div class="history-summary-heading">
        <div><p class="eyebrow">Match history</p><h2>${escapeHtml(a.name || 'Team 1')} vs ${escapeHtml(b.name || 'Team 2')}</h2></div>
        <div class="history-summary-meta"><strong>FINAL ${aScore ?? '—'}–${bScore ?? '—'}</strong><span>${games.length} played game${games.length === 1 ? '' : 's'}</span></div>
      </div>
      <div class="history-game-nav" role="tablist" aria-label="Played games">
        ${games.map((game, index) => {
          const id = String(game.id || '');
          const number = gameNumber(game, index);
          const selected = id === String(state.selectedGameId);
          return `<button class="history-game-button ${selected ? 'active' : ''}" data-history-game-id="${escapeHtml(id)}" type="button" role="tab" aria-selected="${selected}">
            <span>Game ${number}</span><small>${selected ? 'Selected' : 'Open archive'}</small>
          </button>`;
        }).join('')}
      </div>`;
    gameContent.insertBefore(summary, gameContent.firstChild);
  }

  globalThis.renderHistorySeriesSummary = renderSeriesNavigation;

  loadFinishedMatch = async function allGameHistory(id) {
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Loading match history</strong><span>Finding every played game and its archived final frame…</span></div>';

    const payload = await api(`/api/match-details?matchId=${encodeURIComponent(id)}`);
    const event = payload.data?.event || payload.event || payload.data || payload;
    const games = playedGames(event);
    const finalGame = games[games.length - 1] || null;

    state.historyMatch = {
      matchId: String(id),
      event,
      games,
      finalGame
    };
    state.selectedMatchState = 'completed';

    if (!finalGame?.id) {
      state.selectedGameId = null;
      state.historyGameId = null;
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      jsonPreview.textContent = JSON.stringify({
        status: 'history_without_game_telemetry',
        matchId: String(id),
        event
      }, null, 2);
      gameContent.innerHTML = '<div class="empty hero-empty"><strong>Series result available</strong><span>No archived game IDs were returned for this match.</span></div>';
      renderSeriesNavigation();
      setConnection('History · game archive unavailable', '');
      return;
    }

    state.selectedGameId = String(finalGame.id);
    state.historyGameId = state.selectedGameId;
    setJsonEndpoint(state.selectedGameId, true);
    await loadGame();
    renderSeriesNavigation();
    setConnection(`History · Game ${finalGame.number || games.length} of ${games.length}`, '');
  };
})();
