// Adds distinct active-series phases and moves completed live series into the
// final historical game instead of leaving the dashboard between games.
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

  function finalPlayedGame(event = {}, resolution = {}) {
    const games = (Array.isArray(resolution.games) ? resolution.games : event?.match?.games || [])
      .filter(game => game?.id)
      .sort((left, right) => Number(left?.number || 0) - Number(right?.number || 0));
    if (!games.length) return null;

    const wins = (event?.match?.teams || []).map(team => Number(team?.result?.gameWins));
    const playedCount = wins.length >= 2 && wins.every(Number.isFinite)
      ? wins.reduce((sum, value) => sum + value, 0)
      : 0;
    const scoreTarget = playedCount > 0
      ? games.find(game => Number(game?.number || 0) === playedCount)
      : null;

    return scoreTarget
      || [...games].reverse().find(game => game?.state === 'completed')
      || [...games].reverse().find(game => Array.isArray(game?.vods) && game.vods.length > 0)
      || games[games.length - 1];
  }

  function applyCompletedEvent(event, matchId) {
    const selected = selectedScheduleEvent();
    if (!selected) return;
    selected.state = 'completed';
    selected.match = {
      ...(selected.match || {}),
      ...(event?.match || {}),
      id: String(event?.match?.id || matchId)
    };
    if (event?.league) selected.league = { ...(selected.league || {}), ...event.league };
  }

  function showSeriesComplete(event, resolution = {}) {
    const matchId = String(state.selectedEventId || event?.match?.id || event?.id || '');
    const game = finalPlayedGame(event, resolution);

    state.liveMatchIds.delete(matchId);
    state.selectedMatchState = 'completed';
    applyCompletedEvent(event, matchId);
    clearTimeout(state.eventRetryTimer);
    state.eventRetryTimer = null;
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    renderSchedule();

    if (!game?.id) {
      gameContent.innerHTML = '<div class="empty hero-empty"><strong>Series complete</strong><span>The final score is confirmed, but Riot has not exposed a final game ID for the archive yet.</span></div>';
      jsonPreview.textContent = JSON.stringify(resolution, null, 2);
      setConnection('Finished · final game archive pending', '');
      return;
    }

    state.selectedGameId = String(game.id);
    setJsonEndpoint(state.selectedGameId, true);
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Series complete</strong><span>Loading the deciding game’s final telemetry frame…</span></div>';
    setConnection('Finished · loading final game', '');

    // resolveLiveEvent schedules its normal retry immediately after showWaiting
    // returns. Cancel that retry on the next microtask now that the match is final.
    queueMicrotask(() => {
      clearTimeout(state.eventRetryTimer);
      state.eventRetryTimer = null;
    });

    Promise.resolve()
      .then(() => loadGame())
      .catch(error => {
        setConnection(error instanceof Error ? error.message : 'Final game archive unavailable', 'error');
        gameContent.innerHTML = `<div class="empty hero-empty"><strong>Series complete</strong><span>${error instanceof Error ? error.message : 'The final game archive is not available yet.'}</span></div>`;
      });
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
      pregameGame: resolution.pregameGame || null,
      diagnostics: resolution.diagnostics || null,
      message: 'The series is active, but the next game has not started publishing in-game telemetry.'
    }, null, 2);

    setConnection(`LIVE · ${gameLabel} draft / break`, 'live');
  }

  showWaiting = function patchedShowWaiting(event, resolution = {}) {
    if (resolution.seriesComplete || resolution.selectedPhase === 'series_complete') {
      showSeriesComplete(event, resolution);
      return;
    }

    const progress = inferSeriesProgress(event, resolution);
    if (!resolution.selectedGame && progress.hasNextGame) {
      showDraftOrBreak(event, resolution, progress);
      return;
    }

    baseShowWaiting(event, resolution);
  };
})();
