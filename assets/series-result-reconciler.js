// Reconciles stale match lifecycle and series scores from retained final game frames.
(() => {
  const END_GRACE_MS = 2 * 60 * 1000;
  const RECHECK_MS = 30000;
  let inFlight = false;

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function framesOf(payload) {
    const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
    return Array.isArray(frames) ? frames : [];
  }

  function latestFrame(payload) {
    const frames = framesOf(payload);
    return frames.length ? frames[frames.length - 1] : payload?.frame || null;
  }

  function timestampMs(frame) {
    const parsed = Date.parse(String(frame?.rfc460Timestamp || frame?.timestamp || ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function teamFrame(frame, side) {
    return side === 'blue' ? (frame?.blueTeam || {}) : (frame?.redTeam || {});
  }

  function hasGameplay(frame) {
    if (!frame) return false;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const players = [...(blue.participants || []), ...(red.participants || [])];
    const totalCs = players.reduce((sum, player) => sum + num(player.creepScore ?? player.cs), 0);
    const combinedGold = num(blue.totalGold ?? blue.gold) + num(red.totalGold ?? red.gold);
    const levels = players.reduce((max, player) => Math.max(max, num(player.level)), 0);
    return totalCs > 0 || combinedGold > 5000 || levels > 1 ||
      num(blue.totalKills ?? blue.kills) + num(red.totalKills ?? red.kills) > 0 ||
      num(blue.towers) + num(red.towers) > 0;
  }

  function frameFinished(frame) {
    const stateValue = String(frame?.gameState || '').toLowerCase().replace(/[^a-z]/g, '');
    return ['finished', 'completed', 'gameover', 'ended'].includes(stateValue);
  }

  function winnerFromFrame(frame) {
    if (!hasGameplay(frame)) return null;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const comparisons = [
      ['inhibitors', num(blue.inhibitors), num(red.inhibitors), 'high'],
      ['kills', num(blue.totalKills ?? blue.kills), num(red.totalKills ?? red.kills), 'medium'],
      ['gold', num(blue.totalGold ?? blue.gold), num(red.totalGold ?? red.gold), 'low']
    ];
    for (const [basis, blueValue, redValue, confidence] of comparisons) {
      if (blueValue === redValue) continue;
      return { side: blueValue > redValue ? 'blue' : 'red', basis, confidence };
    }
    return null;
  }

  function teamIdForSide(game, side) {
    return String(game?.teams?.find(team => team.side === side)?.id || '');
  }

  function vodFinished(game) {
    return (game?.vods || []).some(vod => vod?.endMillis !== null && vod?.endMillis !== undefined);
  }

  async function finalFrame(gameId) {
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const results = await Promise.allSettled([
      api(`/api/window?gameId=${encodeURIComponent(gameId)}`),
      api(`/api/window?gameId=${encodeURIComponent(gameId)}&startingTime=${encodeURIComponent(future)}`)
    ]);
    return results
      .filter(result => result.status === 'fulfilled')
      .map(result => latestFrame(result.value))
      .filter(Boolean)
      .sort((a, b) => (timestampMs(b) || 0) - (timestampMs(a) || 0))[0] || null;
  }

  async function liveMatchIds() {
    try {
      const payload = await api('/api/live');
      return new Set((payload?.data?.schedule?.events || []).map(eventId).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  function applyScore(event, scoreTeams) {
    for (const team of event?.match?.teams || []) {
      const score = scoreTeams.find(item => String(item.id) === String(team.id));
      if (!score) continue;
      team.result = { ...(team.result || {}), gameWins: score.wins };
    }
  }

  function finalResultView(event, scoreTeams, confidence) {
    const [a, b] = eventTeams(event);
    const aScore = scoreTeams.find(team => String(team.id) === String(a.id))?.wins || 0;
    const bScore = scoreTeams.find(team => String(team.id) === String(b.id))?.wins || 0;
    const confidenceText = confidence === 'low'
      ? 'Provisional result reconstructed from final gold totals.'
      : 'Result reconstructed from Riot’s retained completed-game frames.';

    gameContent.innerHTML = `
      <div class="empty hero-empty">
        <strong>Match finished · ${a.name || 'Team 1'} ${aScore}–${bScore} ${b.name || 'Team 2'}</strong>
        <span>${confidenceText}</span>
      </div>`;
    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    jsonPreview.textContent = JSON.stringify({
      status: 'finished',
      matchId: state.selectedEventId,
      series: { teams: scoreTeams, confidence },
      updatedAt: new Date().toISOString()
    }, null, 2);
    setConnection(`FINISHED · ${aScore}–${bScore}`, '');
  }

  async function reconcileSelectedMatch() {
    if (inFlight || !state.selectedEventId || document.hidden) return;
    inFlight = true;
    try {
      const resolution = await api(`/api/resolve-game?matchId=${encodeURIComponent(state.selectedEventId)}`);
      const event = resolution?.event || selectedScheduleEvent();
      const games = Array.isArray(resolution?.games)
        ? resolution.games
        : (Array.isArray(event?.match?.games) ? event.match.games : []);
      if (!event?.match?.teams?.length || !games.length) return;

      const liveIds = await liveMatchIds();
      const isLive = liveIds.has(String(state.selectedEventId));
      const frameResults = await Promise.allSettled(games.map(game => finalFrame(game.id)));
      const derivedWins = new Map();
      let weakestConfidence = 'high';

      games.forEach((game, index) => {
        const frame = frameResults[index].status === 'fulfilled' ? frameResults[index].value : null;
        const frameTime = timestampMs(frame);
        const staleAfterBroadcast = !isLive && hasGameplay(frame) && frameTime !== null &&
          Date.now() - frameTime >= END_GRACE_MS && ((game.vods || []).length > 0);
        const finished = game.state === 'completed' || frameFinished(frame) || vodFinished(game) || staleAfterBroadcast;
        if (!finished) return;

        const winner = winnerFromFrame(frame);
        if (!winner) return;
        const teamId = teamIdForSide(game, winner.side);
        if (!teamId) return;
        derivedWins.set(teamId, (derivedWins.get(teamId) || 0) + 1);
        if (winner.confidence === 'low') weakestConfidence = 'low';
        else if (winner.confidence === 'medium' && weakestConfidence === 'high') weakestConfidence = 'medium';
      });

      const scoreTeams = event.match.teams.map(team => ({
        id: String(team.id),
        name: team.name,
        code: team.code,
        image: team.image,
        wins: Math.max(num(team.result?.gameWins), derivedWins.get(String(team.id)) || 0)
      }));
      applyScore(event, scoreTeams);

      const bestOf = num(event.match.strategy?.count) || games.length || 1;
      const targetWins = Math.floor(bestOf / 2) + 1;
      const leader = [...scoreTeams].sort((a, b) => b.wins - a.wins)[0];
      const seriesFinished = Boolean(leader && leader.wins >= targetWins);

      if (seriesFinished) {
        event.state = 'completed';
        state.liveMatchIds.delete(String(state.selectedEventId));
        state.selectedMatchState = 'completed';
        clearMatchTimers();
        renderSchedule();
        finalResultView(event, scoreTeams, weakestConfidence);
        return;
      }

      if (!isLive) state.liveMatchIds.delete(String(state.selectedEventId));
      renderSchedule();
    } catch (error) {
      console.warn('Series result reconciliation failed:', error);
    } finally {
      inFlight = false;
    }
  }

  const baseLoadSchedule = loadSchedule;
  loadSchedule = async function reconciledLoadSchedule(...args) {
    state.liveMatchIds.clear();
    const result = await baseLoadSchedule(...args);
    await reconcileSelectedMatch();
    return result;
  };

  setInterval(reconcileSelectedMatch, RECHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reconcileSelectedMatch();
  });
  setTimeout(() => loadSchedule(true), 0);
})();
