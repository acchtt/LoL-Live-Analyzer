// Reconstructs in-progress series scores from Riot's retained final game frames.
(() => {
  const BUILD = '20260726-23';
  const REFRESH_MS = 30_000;
  const ACTIVE_LOOKBACK_MS = 8 * 60 * 60 * 1000;
  const MAX_MATCHES = 4;
  let inFlight = false;

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function eventIdOf(event) {
    return String(event?.match?.id || event?.id || '');
  }

  function framesOf(payload) {
    const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
    return Array.isArray(frames) ? frames : [];
  }

  function latestFrame(payload) {
    const frames = framesOf(payload);
    return frames.length ? frames[frames.length - 1] : payload?.frame || null;
  }

  function frameTime(frame) {
    const parsed = Date.parse(String(frame?.rfc460Timestamp || frame?.timestamp || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function teamFrame(frame, side) {
    if (side === 'blue') return frame?.blueTeam || {};
    return frame?.redTeam || {};
  }

  function normalizedState(value) {
    return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function frameFinished(frame) {
    return ['finished', 'completed', 'gameover', 'ended'].includes(normalizedState(frame?.gameState));
  }

  function hasGameplay(frame) {
    if (!frame) return false;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const players = [...(blue.participants || []), ...(red.participants || [])];
    const cs = players.reduce((sum, player) => sum + num(player.creepScore ?? player.cs), 0);
    const gold = num(blue.totalGold ?? blue.gold) + num(red.totalGold ?? red.gold);
    const maxLevel = players.reduce((max, player) => Math.max(max, num(player.level)), 0);
    return cs > 0 || gold > 5000 || maxLevel > 1 ||
      num(blue.totalKills ?? blue.kills) + num(red.totalKills ?? red.kills) > 0 ||
      num(blue.towers) + num(red.towers) > 0;
  }

  function winnerSide(frame) {
    if (!frameFinished(frame) || !hasGameplay(frame)) return null;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const comparisons = [
      [num(blue.inhibitors), num(red.inhibitors), 'inhibitors'],
      [num(blue.totalKills ?? blue.kills), num(red.totalKills ?? red.kills), 'kills'],
      [num(blue.totalGold ?? blue.gold), num(red.totalGold ?? red.gold), 'gold']
    ];
    for (const [blueValue, redValue, basis] of comparisons) {
      if (blueValue === redValue) continue;
      return { side: blueValue > redValue ? 'blue' : 'red', basis };
    }
    return null;
  }

  async function retainedFinalFrame(gameId) {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const requests = [
      api(`/api/window?gameId=${encodeURIComponent(gameId)}`),
      api(`/api/window?gameId=${encodeURIComponent(gameId)}&startingTime=${encodeURIComponent(future)}`)
    ];
    const settled = await Promise.allSettled(requests);
    return settled
      .filter(result => result.status === 'fulfilled')
      .map(result => latestFrame(result.value))
      .filter(Boolean)
      .sort((a, b) => frameTime(b) - frameTime(a))[0] || null;
  }

  function teamIdForSide(game, side) {
    return String(game?.teams?.find(team => team?.side === side)?.id || '');
  }

  function targetWins(event) {
    const bestOf = num(event?.match?.strategy?.count) || 1;
    return Math.floor(bestOf / 2) + 1;
  }

  function currentScoreTotal(event) {
    return (event?.match?.teams || []).reduce((sum, team) => sum + num(team?.result?.gameWins), 0);
  }

  function applyDerivedScore(event, winsByTeamId, basisByGame) {
    if (!event?.match?.teams?.length || !winsByTeamId.size) return false;
    const derivedTotal = [...winsByTeamId.values()].reduce((sum, wins) => sum + wins, 0);
    if (derivedTotal <= currentScoreTotal(event)) return false;

    for (const team of event.match.teams) {
      const derived = winsByTeamId.get(String(team.id)) || 0;
      team.result = { ...(team.result || {}), gameWins: derived };
    }
    event.scoreSource = 'Riot retained final game frames';
    event.scoreDerivation = basisByGame;
    event.scoreUnavailable = false;

    const leaderWins = Math.max(...event.match.teams.map(team => num(team.result?.gameWins)));
    if (leaderWins >= targetWins(event)) {
      event.state = 'completed';
      state.liveMatchIds.delete(eventIdOf(event));
    }
    return true;
  }

  async function reconcileEvent(event) {
    const matchId = eventIdOf(event);
    if (!matchId) return false;
    const resolution = await api(`/api/resolve-game?matchId=${encodeURIComponent(matchId)}`);
    const games = Array.isArray(resolution?.games)
      ? resolution.games
      : (Array.isArray(resolution?.event?.match?.games) ? resolution.event.match.games : []);
    if (!games.length) return false;

    const settled = await Promise.allSettled(games.map(game => retainedFinalFrame(game.id)));
    const winsByTeamId = new Map();
    const basisByGame = [];

    games.forEach((game, index) => {
      const frame = settled[index].status === 'fulfilled' ? settled[index].value : null;
      const winner = winnerSide(frame);
      if (!winner) return;
      const teamId = teamIdForSide(game, winner.side);
      if (!teamId) return;
      winsByTeamId.set(teamId, (winsByTeamId.get(teamId) || 0) + 1);
      basisByGame.push({ gameId: String(game.id), gameNumber: num(game.number), winnerTeamId: teamId, basis: winner.basis });
    });

    return applyDerivedScore(event, winsByTeamId, basisByGame);
  }

  function candidates() {
    const now = Date.now();
    return (state.events || [])
      .filter(event => displayState(event) !== 'completed')
      .filter(event => {
        const start = Date.parse(event?.startTime || '');
        return Number.isFinite(start) && start <= now && now - start <= ACTIVE_LOOKBACK_MS;
      })
      .sort((a, b) => Math.abs(Date.parse(a.startTime) - now) - Math.abs(Date.parse(b.startTime) - now))
      .slice(0, MAX_MATCHES);
  }

  async function reconcileActiveSeries() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try {
      const events = candidates();
      const results = await Promise.allSettled(events.map(reconcileEvent));
      if (results.some(result => result.status === 'fulfilled' && result.value)) renderSchedule();
    } catch (error) {
      console.warn('Active series score reconstruction failed:', error);
    } finally {
      inFlight = false;
    }
  }

  const previousLoadSchedule = loadSchedule;
  loadSchedule = async function activeScoreLoadSchedule(...args) {
    const result = await previousLoadSchedule(...args);
    await reconcileActiveSeries();
    return result;
  };

  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark active-score-build"> Active score · ${BUILD}</span>`);

  setInterval(reconcileActiveSeries, REFRESH_MS);
  setTimeout(reconcileActiveSeries, 0);
})();
