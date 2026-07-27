// RiftPulse history mode: show only the final completed game's stats.
(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    .history-game-nav { display: none !important; }
    .history-summary-meta::after {
      content: "Final game stats";
      display: block;
      margin-top: 4px;
      color: var(--accent);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
  `;
  document.head.appendChild(style);

  loadFinishedMatch = async function finalGameOnlyHistory(id) {
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Loading final game stats</strong><span>Finding the last completed game and its final telemetry frame…</span></div>';

    const payload = await api(`/api/match-details?matchId=${encodeURIComponent(id)}`);
    const event = payload.data?.event || payload.event || payload.data || payload;
    const rawGames = Array.isArray(event?.match?.games) ? event.match.games : [];
    const completedGames = rawGames
      .filter(game => game?.id && (game.state === 'completed' || (Array.isArray(game.vods) && game.vods.length > 0)))
      .sort((left, right) => Number(left.number || 0) - Number(right.number || 0));
    const finalGame = completedGames[completedGames.length - 1] || null;

    state.historyMatch = {
      matchId: String(id),
      event,
      games: finalGame ? [finalGame] : [],
      finalGame
    };
    state.selectedMatchState = 'completed';

    if (!finalGame?.id) {
      state.selectedGameId = null;
      state.historyGameId = null;
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      jsonPreview.textContent = JSON.stringify({
        status: 'history_without_final_game_telemetry',
        matchId: String(id),
        event
      }, null, 2);
      gameContent.innerHTML = '<div class="empty hero-empty"><strong>Series result available</strong><span>No final-game telemetry frame was returned for this match.</span></div>';
      setConnection('History · final game unavailable', '');
      return;
    }

    state.selectedGameId = String(finalGame.id);
    state.historyGameId = state.selectedGameId;
    setJsonEndpoint(state.selectedGameId, true);
    await loadGame();
    setConnection(`History · final Game ${finalGame.number || completedGames.length} stats`, '');
  };
})();
