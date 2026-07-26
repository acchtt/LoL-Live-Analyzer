// Adds a distinct series phase when a previous game has ended but the next
// game's live telemetry has not started yet.
(() => {
  const baseShowWaiting = showWaiting;

  function inferSeriesProgress(event, resolution = {}) {
    const match = event?.match || {};
    const games = Array.isArray(resolution.games)
      ? resolution.games
      : (Array.isArray(match.games) ? match.games : []);

    const completedByState = games.filter(game => game?.state === 'completed').length;
    const completedByVod = games.filter(game => Array.isArray(game?.vods) && game.vods.length > 0).length;
    const completedByScore = (match.teams || []).reduce(
      (sum, team) => sum + Number(team?.result?.gameWins || 0),
      0
    );

    const playedCount = Math.max(completedByState, completedByVod, completedByScore);
    const seriesLength = Number(match?.strategy?.count || games.length || 0);
    const nextGame = games
      .filter(game => Number(game?.number || 0) > playedCount)
      .sort((a, b) => Number(a.number || 0) - Number(b.number || 0))[0];
    const nextGameNumber = Number(nextGame?.number || (playedCount + 1));

    return {
      playedCount,
      seriesLength,
      nextGameNumber,
      hasNextGame: playedCount > 0 && (seriesLength === 0 || nextGameNumber <= seriesLength)
    };
  }

  function showDraftOrBreak(event, resolution, progress) {
    const [a, b] = eventTeams(event || selectedScheduleEvent());
    const title = `${a.name || 'Team 1'} vs ${b.name || 'Team 2'}`;
    const gameLabel = progress.nextGameNumber ? `Game ${progress.nextGameNumber}` : 'Next game';

    markMatchLive(state.selectedEventId);
    gameContent.innerHTML = `
      <div class="empty hero-empty">
        <strong>${gameLabel} draft / between games</strong>
        <span>${title} is still live as a series. ${gameLabel} has not produced an in-game telemetry frame yet, which is normal during champion select and the break before loading into game.</span>
      </div>`;

    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    jsonPreview.textContent = JSON.stringify({
      status: 'draft_or_between_games',
      matchId: state.selectedEventId,
      nextGameNumber: progress.nextGameNumber || null,
      completedGames: progress.playedCount,
      checkedAt: resolution.checkedAt || new Date().toISOString(),
      message: 'The series is active, but the next game has not started publishing in-game telemetry.'
    }, null, 2);

    setConnection(`LIVE · ${gameLabel} draft / break`, 'live');
  }

  showWaiting = function patchedShowWaiting(event, resolution = {}) {
    const progress = inferSeriesProgress(event, resolution);

    if (!resolution.selectedGame && progress.hasNextGame) {
      showDraftOrBreak(event, resolution, progress);
      return;
    }

    baseShowWaiting(event, resolution);
  };
})();
