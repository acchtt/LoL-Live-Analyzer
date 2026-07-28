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

  function staleGameplayEvidence(resolution = {}, progress = {}) {
    const expected = Number(progress.nextGameNumber || 0);
    const entries = Object.entries(resolution.diagnostics || {})
      .filter(([, detail]) => detail && typeof detail === 'object')
      .filter(([, detail]) => detail.phase === 'gameplay' && detail.freshness === 'stale')
      .filter(([, detail]) => !expected || Number(detail.gameNumber || 0) === expected)
      .map(([gameId, detail]) => ({ gameId, ...detail }))
      .sort((left, right) => Date.parse(right.timestamp || '') - Date.parse(left.timestamp || ''));
    return entries[0] || null;
  }

  function displayableSnapshotFor(evidence = {}) {
    const snapshot = state.lastSnapshot;
    if (!snapshot || ['pregame', 'telemetry_unavailable'].includes(snapshot.status)) return null;
    if (evidence.gameId && String(snapshot?.source?.gameId || '') !== String(evidence.gameId)) return null;
    const values = [
      snapshot?.blue?.gold, snapshot?.red?.gold,
      snapshot?.blue?.kills, snapshot?.red?.kills,
      snapshot?.blue?.towers, snapshot?.red?.towers,
      snapshot?.clockSeconds
    ];
    return values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))).length >= 4
      ? snapshot
      : null;
  }

  function addPostGameBanner(gameNumber, evidence = {}) {
    const banner = document.createElement('section');
    banner.className = 'authority-context-banner is-stale';
    banner.setAttribute('role', 'status');
    const age = Number(evidence.frameAgeSeconds);
    const ageText = Number.isFinite(age) ? ` Last frame: ${Math.round(age)}s ago.` : '';
    banner.innerHTML = `<strong>Game ${gameNumber} feed stopped</strong><span>The gameplay frame is no longer advancing.${ageText} Awaiting Riot’s official result or next-game confirmation; the last map state is context only.</span>`;

    const shell = gameContent.querySelector('.analysis-v2-shell, .analysis-shell');
    const header = shell?.querySelector('.analysis-v2-header, .analysis-header');
    const seriesNav = shell?.querySelector('.live-series-nav');
    if (seriesNav) seriesNav.insertAdjacentElement('afterend', banner);
    else if (header) header.insertAdjacentElement('afterend', banner);
    else if (shell) shell.prepend(banner);
    else gameContent.prepend(banner);
  }

  function showPostGamePending(event, resolution, progress, evidence) {
    const [a, b] = eventTeams(event || selectedScheduleEvent());
    const title = `${a.name || 'Team 1'} vs ${b.name || 'Team 2'}`;
    const gameNumber = Number(evidence?.gameNumber || progress.nextGameNumber || 0) || '?';
    const snapshot = displayableSnapshotFor(evidence);

    state.selectedMatchState = 'postGame';
    clearInterval(state.pollTimer);
    state.pollTimer = null;

    if (evidence?.gameId) {
      state.selectedGameId = String(evidence.gameId);
      setJsonEndpoint(state.selectedGameId, false);
    }

    if (snapshot) {
      renderGame(snapshot);
      addPostGameBanner(gameNumber, evidence);
    } else {
      gameContent.innerHTML = `
        <div class="empty hero-empty">
          <strong>Game ${gameNumber} feed stopped</strong>
          <span>${title} has no advancing gameplay frame. RiftPulse is waiting for Riot to publish the official result or confirm the next game instead of mislabeling this as champion select.</span>
        </div>`;
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
    }

    jsonPreview.textContent = JSON.stringify({
      status: 'post_game_result_pending',
      matchId: state.selectedEventId,
      gameId: evidence?.gameId || null,
      gameNumber: gameNumber === '?' ? null : gameNumber,
      completedGames: progress.playedCount,
      broadcastReportedLive: Boolean(resolution.broadcastReportedLive),
      checkedAt: resolution.checkedAt || new Date().toISOString(),
      lastGameplayFrame: evidence?.timestamp || null,
      frameAgeSeconds: evidence?.frameAgeSeconds ?? null,
      message: 'The latest gameplay frame stopped advancing. Awaiting Riot result or next-game confirmation.'
    }, null, 2);

    setConnection(`Game ${gameNumber} feed stopped · result pending`, '');
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
    const stoppedGameplay = staleGameplayEvidence(resolution, progress);
    if (!resolution.selectedGame && !resolution.pregameGame && stoppedGameplay) {
      showPostGamePending(event, resolution, progress, stoppedGameplay);
      return;
    }

    if (!resolution.selectedGame && progress.hasNextGame) {
      showDraftOrBreak(event, resolution, progress);
      return;
    }

    baseShowWaiting(event, resolution);
  };

  globalThis.RiftPulseSeriesPhase = {
    inferSeriesProgress,
    staleGameplayEvidence
  };
})();
