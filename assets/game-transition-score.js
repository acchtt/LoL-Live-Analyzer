// Detects completed games from game transitions and retained Riot frames.
(() => {
  const BUILD = '20260726-26';
  const REFRESH_MS = 10_000;
  const ACTIVE_LOOKBACK_MS = 8 * 60 * 60_000;
  const STALE_FRAME_MS = 4 * 60_000;
  const MAX_MATCHES = 3;
  let inFlight = false;
  let lastRunAt = 0;

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function eventIdOf(event) {
    return String(event?.match?.id || event?.id || '');
  }

  function gameNumber(game) {
    return num(game?.number ?? game?.gameNumber);
  }

  function framesOf(payload) {
    const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
    return Array.isArray(frames) ? frames : [];
  }

  function latestFrame(payload) {
    const frames = framesOf(payload);
    return frames.length ? frames[frames.length - 1] : payload?.frame || null;
  }

  function frameTimestamp(frame) {
    const parsed = Date.parse(String(frame?.rfc460Timestamp || frame?.timestamp || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalized(value = '') {
    return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  }

  function eventTeamByIdentity(event, identity) {
    const normalizedIdentity = normalized(identity);
    if (!normalizedIdentity) return null;
    return (event?.match?.teams || []).find(team => {
      const values = [team.id, team.esportsTeamId, team.code, team.name].map(normalized);
      return values.includes(normalizedIdentity) || values.some(value => value && (
        value.includes(normalizedIdentity) || normalizedIdentity.includes(value)
      ));
    }) || null;
  }

  function sideMetadata(payload, frame, side) {
    const key = side === 'blue' ? 'blueTeamMetadata' : 'redTeamMetadata';
    return payload?.gameMetadata?.[key]
      || payload?.metadata?.[key]
      || frame?.gameMetadata?.[key]
      || frame?.metadata?.[key]
      || {};
  }

  function sideTeamIdentity(event, game, payload, frame, snapshot, side) {
    const gameTeam = (game?.teams || []).find(team => String(team?.side || '').toLowerCase() === side);
    const metadata = sideMetadata(payload, frame, side);
    const snapshotTeam = side === 'blue' ? snapshot?.blue : snapshot?.red;
    const candidates = [
      gameTeam?.id,
      gameTeam?.esportsTeamId,
      gameTeam?.code,
      gameTeam?.name,
      metadata?.esportsTeamId,
      metadata?.teamId,
      metadata?.id,
      metadata?.code,
      metadata?.name,
      snapshotTeam?.id,
      snapshotTeam?.esportsTeamId,
      snapshotTeam?.code,
      snapshotTeam?.name
    ];

    for (const candidate of candidates) {
      const matched = eventTeamByIdentity(event, candidate);
      if (matched) return String(matched.id || candidate);
    }
    return '';
  }

  function teamFrame(frame, side) {
    return side === 'blue' ? frame?.blueTeam || {} : frame?.redTeam || {};
  }

  function hasGameplay(frame) {
    if (!frame) return false;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const players = [...(blue.participants || []), ...(red.participants || [])];
    const cs = players.reduce((sum, player) => sum + num(player.creepScore ?? player.cs), 0);
    const gold = num(blue.totalGold ?? blue.gold) + num(red.totalGold ?? red.gold);
    const kills = num(blue.totalKills ?? blue.kills) + num(red.totalKills ?? red.kills);
    const towers = num(blue.towers) + num(red.towers);
    return cs > 0 || gold > 5000 || kills > 0 || towers > 0;
  }

  function normalizedState(value) {
    return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function explicitFinished(game, payload, frame) {
    const states = [
      game?.state,
      payload?.gameState,
      payload?.gameMetadata?.gameState,
      frame?.gameState,
      frame?.gameMetadata?.gameState
    ].map(normalizedState);
    return states.some(value => ['finished', 'completed', 'gameover', 'ended'].includes(value));
  }

  function explicitWinnerSide(payload, frame, snapshot) {
    const values = [
      payload?.winner,
      payload?.winningTeam,
      payload?.gameMetadata?.winner,
      payload?.gameMetadata?.winningTeam,
      frame?.winner,
      frame?.winningTeam,
      frame?.gameMetadata?.winner,
      frame?.gameMetadata?.winningTeam,
      snapshot?.winner,
      snapshot?.match?.winner
    ];
    for (const value of values) {
      const normalizedValue = normalized(value?.side || value?.code || value?.name || value?.id || value);
      if (normalizedValue === 'blue' || normalizedValue === 'blueteam' || normalizedValue === '100') return 'blue';
      if (normalizedValue === 'red' || normalizedValue === 'redteam' || normalizedValue === '200') return 'red';
    }
    if (payload?.blueTeam?.winner === true || frame?.blueTeam?.winner === true || snapshot?.blue?.winner === true) return 'blue';
    if (payload?.redTeam?.winner === true || frame?.redTeam?.winner === true || snapshot?.red?.winner === true) return 'red';
    return null;
  }

  function winnerSide(payload, frame, snapshot, finalEvidence) {
    if (!finalEvidence || !hasGameplay(frame)) return null;
    const explicit = explicitWinnerSide(payload, frame, snapshot);
    if (explicit) return { side: explicit, basis: 'explicit winner' };

    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const comparisons = [
      [num(blue.inhibitors), num(red.inhibitors), 'inhibitors'],
      [num(blue.totalKills ?? blue.kills), num(red.totalKills ?? red.kills), 'kills'],
      [num(blue.totalGold ?? blue.gold), num(red.totalGold ?? red.gold), 'gold']
    ];
    for (const [blueValue, redValue, basis] of comparisons) {
      if (blueValue !== redValue) return { side: blueValue > redValue ? 'blue' : 'red', basis };
    }
    return null;
  }

  async function retainedGameData(gameId) {
    const future = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const results = await Promise.allSettled([
      api(`/api/window?gameId=${encodeURIComponent(gameId)}&startingTime=${encodeURIComponent(future)}`),
      api(`/api/chatgpt?gameId=${encodeURIComponent(gameId)}&historical=1`)
    ]);
    const payload = results[0].status === 'fulfilled' ? results[0].value : {};
    const snapshot = results[1].status === 'fulfilled' ? results[1].value : {};
    const frame = latestFrame(payload) || ((snapshot?.blue || snapshot?.red) ? {
      blueTeam: snapshot.blue || {},
      redTeam: snapshot.red || {},
      gameState: snapshot?.match?.state,
      timestamp: snapshot?.source?.frameTimestamp || snapshot?.updatedAt
    } : null);
    return { payload, snapshot, frame };
  }

  function activeCandidates() {
    const now = Date.now();
    const eligible = (state.events || [])
      .filter(event => displayState(event) !== 'completed')
      .filter(event => {
        const start = Date.parse(event?.startTime || '');
        return Number.isFinite(start) && start <= now && now - start <= ACTIVE_LOOKBACK_MS;
      });

    const selectedId = String(state.selectedEventId || '');
    return eligible
      .sort((a, b) => {
        const aSelected = eventIdOf(a) === selectedId ? 0 : 1;
        const bSelected = eventIdOf(b) === selectedId ? 0 : 1;
        if (aSelected !== bSelected) return aSelected - bSelected;
        const aLive = displayState(a) === 'inProgress' ? 0 : 1;
        const bLive = displayState(b) === 'inProgress' ? 0 : 1;
        if (aLive !== bLive) return aLive - bLive;
        return Math.abs(Date.parse(a.startTime) - now) - Math.abs(Date.parse(b.startTime) - now);
      })
      .slice(0, MAX_MATCHES);
  }

  function targetWins(event) {
    const bestOf = num(event?.match?.strategy?.count) || 1;
    return Math.floor(bestOf / 2) + 1;
  }

  async function reconcileEvent(event) {
    const matchId = eventIdOf(event);
    if (!matchId) return false;

    const resolution = await api(`/api/resolve-game?matchId=${encodeURIComponent(matchId)}`);
    const games = Array.isArray(resolution?.games)
      ? resolution.games
      : (Array.isArray(resolution?.event?.match?.games) ? resolution.event.match.games : []);
    if (!games.length) return false;

    const selectedId = String(resolution?.selectedGame?.id || '');
    const selectedNumber = num(resolution?.selectedGame?.number ?? resolution?.selectedGame?.gameNumber);
    const ordered = [...games].sort((a, b) => gameNumber(a) - gameNumber(b));
    const wins = new Map();
    const derivation = [];

    for (const game of ordered) {
      if (!game?.id) continue;
      const { payload, snapshot, frame } = await retainedGameData(game.id);
      if (!frame || !hasGameplay(frame)) continue;

      const number = gameNumber(game);
      const transitioned = selectedNumber > 0 && number > 0 && number < selectedNumber;
      const differentSelectedGame = Boolean(selectedId) && String(game.id) !== selectedId && (
        selectedNumber === 0 || number === 0 || number <= selectedNumber
      );
      const vodEnded = (game.vods || []).some(vod => num(vod?.endMillis) > 0);
      const matchStart = Date.parse(event?.startTime || '');
      const matureSeries = Number.isFinite(matchStart) && Date.now() - matchStart >= 15 * 60_000;
      const staleCurrentFrame = String(game.id) === selectedId
        && matureSeries
        && frameTimestamp(frame) > 0
        && Date.now() - frameTimestamp(frame) >= STALE_FRAME_MS;
      const finalEvidence = explicitFinished(game, payload, frame)
        || transitioned
        || differentSelectedGame
        || vodEnded
        || staleCurrentFrame;

      const winner = winnerSide(payload, frame, snapshot, finalEvidence);
      if (!winner) continue;
      const teamId = sideTeamIdentity(event, game, payload, frame, snapshot, winner.side);
      if (!teamId) continue;

      wins.set(teamId, (wins.get(teamId) || 0) + 1);
      derivation.push({
        gameId: String(game.id),
        gameNumber: number,
        winnerTeamId: teamId,
        basis: winner.basis,
        evidence: transitioned ? 'game transition'
          : differentSelectedGame ? 'new selected game'
            : explicitFinished(game, payload, frame) ? 'finished state'
              : vodEnded ? 'vod ended'
                : 'stale final frame'
      });
    }

    const derivedTotal = [...wins.values()].reduce((sum, value) => sum + value, 0);
    const currentTotal = (event.match?.teams || []).reduce((sum, team) => sum + num(team?.result?.gameWins), 0);
    if (derivedTotal <= currentTotal) return false;

    for (const team of event.match?.teams || []) {
      team.result = { ...(team.result || {}), gameWins: wins.get(String(team.id)) || 0 };
    }
    event.scoreSource = derivation.some(item => item.evidence === 'game transition' || item.evidence === 'new selected game')
      ? 'Riot game transition'
      : 'Riot retained final frame';
    event.scoreDerivation = derivation;
    event.scoreUnavailable = false;

    const leader = Math.max(...event.match.teams.map(team => num(team.result?.gameWins)));
    if (leader >= targetWins(event)) {
      event.state = 'completed';
      state.liveMatchIds.delete(matchId);
    }
    return true;
  }

  async function reconcileActiveSeries() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    lastRunAt = Date.now();
    try {
      const candidates = activeCandidates();
      const results = await Promise.allSettled(candidates.map(reconcileEvent));
      if (results.some(result => result.status === 'fulfilled' && result.value)) renderSchedule();
    } catch (error) {
      console.warn('Game-transition score detection failed:', error);
    } finally {
      inFlight = false;
    }
  }

  const previousLoadSchedule = loadSchedule;
  loadSchedule = async function transitionAwareLoadSchedule(...args) {
    const result = await previousLoadSchedule(...args);
    setTimeout(reconcileActiveSeries, 50);
    return result;
  };

  const observer = new MutationObserver(() => {
    if (Date.now() - lastRunAt > 2500) setTimeout(reconcileActiveSeries, 150);
  });
  observer.observe(scheduleList, { childList: true });

  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark"> Transition score · ${BUILD}</span>`);

  setTimeout(reconcileActiveSeries, 800);
  setTimeout(reconcileActiveSeries, 3000);
  setInterval(reconcileActiveSeries, REFRESH_MS);
})();