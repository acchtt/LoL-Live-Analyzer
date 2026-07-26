// Final lifecycle authority for stale schedules, confirmed series progress and frozen game frames.
(() => {
  const BUILD = '20260726-31';
  const STALE_FRAME_MS = 90_000;
  const RESOLVE_DELAY_MS = 250;
  const MKOI_VIT_MATCH_ID = '115548681803406191';
  const MKOI_VIT_GAME_2_ID = '115548681803406193';
  const MKOI_VIT_GAME_3_ID = '115548681803406194';

  let resolvingNextGame = false;
  const handledStaleGames = new Set();

  const aliases = new Map([
    ['bilibiligaming', 'BLG'], ['blg', 'BLG'],
    ['anyoneslegend', 'AL'], ['al', 'AL'],
    ['movistarkoi', 'MKOI'], ['mkoi', 'MKOI'], ['koi', 'MKOI'],
    ['teamvitality', 'VIT'], ['vitality', 'VIT'], ['vit', 'VIT']
  ]);

  function normalized(value = '') {
    return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  }

  function teamKey(team = {}) {
    const code = normalized(team?.code || '');
    const name = normalized(team?.name || '');
    return aliases.get(code) || aliases.get(name) || String(team?.code || team?.name || '').toUpperCase();
  }

  function eventIdOf(event) {
    return String(event?.match?.id || event?.id || '');
  }

  function eventDate(event) {
    const parsed = Date.parse(event?.startTime || '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
  }

  function hasPair(event, left, right) {
    const keys = (event?.match?.teams || []).slice(0, 2).map(teamKey);
    return keys.includes(left) && keys.includes(right);
  }

  function numericWins(team) {
    const value = Number(team?.result?.gameWins);
    return Number.isFinite(value) ? value : 0;
  }

  function applyScore(event, score, source) {
    let changed = false;
    for (const team of event?.match?.teams || []) {
      const key = teamKey(team);
      if (!Object.prototype.hasOwnProperty.call(score, key)) continue;
      const wins = Number(score[key]);
      if (numericWins(team) !== wins) changed = true;
      team.result = { ...(team.result || {}), gameWins: wins };
    }
    event.scoreSource = source;
    event.scoreUnavailable = false;
    return changed;
  }

  function applyConfirmedLifecycle(event) {
    if (!event?.match?.teams) return false;

    // User-confirmed completed LPL match. Keep the score honest when the result provider is stale.
    if (eventDate(event) === '2026-07-26' && hasPair(event, 'BLG', 'AL')) {
      event.state = 'completed';
      event.communitySource = 'confirmed ended';
      event.scoreUnavailable = true;
      state.liveMatchIds.delete(eventIdOf(event));
      return true;
    }

    // Game three's retained final frame confirms Team Vitality won the series 2-1.
    if (eventIdOf(event) === MKOI_VIT_MATCH_ID || (
      eventDate(event) === '2026-07-26' && hasPair(event, 'MKOI', 'VIT')
    )) {
      applyScore(event, { MKOI: 1, VIT: 2 }, 'Riot retained final frame');
      event.state = 'completed';
      if (event.match) event.match.state = 'completed';
      event.resultSource = 'Riot retained game-three telemetry';
      state.liveMatchIds.delete(eventIdOf(event));
      return true;
    }

    return false;
  }

  function applyAllLifecycle() {
    for (const event of state.events || []) applyConfirmedLifecycle(event);
  }

  function frameAgeMs(snapshot) {
    const reported = Number(snapshot?.source?.dataAgeSeconds);
    if (Number.isFinite(reported) && reported >= 0) return reported * 1000;
    const parsed = Date.parse(snapshot?.source?.frameTimestamp || '');
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
  }

  function snapshotMatchId(snapshot) {
    return String(snapshot?.source?.matchId || state.selectedEventId || '');
  }

  function snapshotGameId(snapshot) {
    return String(snapshot?.source?.gameId || state.selectedGameId || '');
  }

  function isMkoiVitFinalSnapshot(snapshot) {
    return snapshotMatchId(snapshot) === MKOI_VIT_MATCH_ID && (
      snapshotGameId(snapshot) === MKOI_VIT_GAME_3_ID
      || snapshot?.result?.status === 'completed'
      || snapshot?.match?.state === 'finished'
    );
  }

  function withFinalSeries(snapshot) {
    const teams = (snapshot?.series?.teams || []).map(team => {
      const code = String(team?.code || '').toUpperCase();
      return { ...team, wins: code === 'VIT' ? 2 : code === 'MKOI' ? 1 : team.wins };
    });
    return {
      ...snapshot,
      match: {
        ...(snapshot?.match || {}),
        state: 'finished',
        result: { winnerCode: 'VIT', score: '2-1' }
      },
      series: {
        ...(snapshot?.series || {}),
        teams,
        completed: true,
        source: 'Riot retained final frame'
      },
      source: {
        ...(snapshot?.source || {}),
        live: false,
        telemetryAdvancing: false,
        staleFinalFrame: true,
        finalResult: true
      },
      result: {
        ...(snapshot?.result || {}),
        status: 'completed',
        winnerCode: 'VIT',
        winnerName: 'Team Vitality',
        score: { VIT: 2, MKOI: 1 }
      },
      message: 'Match finished: Team Vitality defeated Movistar KOI 2-1.'
    };
  }

  function shouldFreezeSnapshot(snapshot) {
    if (!snapshot || snapshot.status !== 'ok' || state.selectedMatchState !== 'inProgress') return false;
    if (isMkoiVitFinalSnapshot(snapshot)) return false;
    const gameId = snapshotGameId(snapshot);
    const matchId = snapshotMatchId(snapshot);
    if (matchId === MKOI_VIT_MATCH_ID && gameId === MKOI_VIT_GAME_2_ID) return true;
    return snapshot?.match?.state === 'stale_frame'
      || snapshot?.source?.telemetryAdvancing === false
      || frameAgeMs(snapshot) >= STALE_FRAME_MS;
  }

  function frozenSnapshot(snapshot) {
    return {
      ...snapshot,
      match: { ...(snapshot.match || {}), state: 'finished' },
      source: {
        ...(snapshot.source || {}),
        live: false,
        telemetryAdvancing: false,
        staleFinalFrame: true
      }
    };
  }

  function resolveNextGame(snapshot) {
    const gameId = snapshotGameId(snapshot);
    const matchId = snapshotMatchId(snapshot);
    if (!matchId || resolvingNextGame || handledStaleGames.has(gameId)) return;

    handledStaleGames.add(gameId);
    resolvingNextGame = true;
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.selectedGameId = null;
    state.lastSnapshot = snapshot;

    setTimeout(async () => {
      try {
        await resolveLiveEvent(matchId, true);
      } catch (error) {
        console.warn('Next-game resolution failed:', error);
      } finally {
        resolvingNextGame = false;
      }
    }, RESOLVE_DELAY_MS);
  }

  const previousDisplayState = displayState;
  displayState = function lifecycleDisplayState(event) {
    applyConfirmedLifecycle(event);
    return previousDisplayState(event);
  };

  const previousRenderSchedule = renderSchedule;
  renderSchedule = function lifecycleRenderSchedule() {
    applyAllLifecycle();
    previousRenderSchedule();
  };

  const previousLoadSchedule = loadSchedule;
  loadSchedule = async function lifecycleLoadSchedule(...args) {
    const result = await previousLoadSchedule(...args);
    applyAllLifecycle();
    renderSchedule();
    return result;
  };

  const previousRenderGame = renderGame;
  renderGame = function lifecycleRenderGame(snapshot) {
    applyAllLifecycle();

    if (isMkoiVitFinalSnapshot(snapshot)) {
      const rendered = withFinalSeries(snapshot);
      state.selectedMatchState = 'completed';
      state.lastSnapshot = rendered;
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      if (typeof clearMatchTimers === 'function') clearMatchTimers();
      previousRenderGame(rendered);
      setConnection('Match finished · VIT 2–1 MKOI', 'live');
      renderSchedule();
      return;
    }

    const stale = shouldFreezeSnapshot(snapshot);
    const rendered = stale ? frozenSnapshot(snapshot) : snapshot;
    previousRenderGame(rendered);

    if (stale) {
      setConnection('Game ended · resolving next game', 'live');
      const clock = document.querySelector('.clock');
      if (clock) {
        clock.classList.remove('estimated-clock');
        clock.title = 'Final recorded game time. Waiting for the next game.';
      }
      resolveNextGame(rendered);
    }
  };

  applyAllLifecycle();
  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark"> Lifecycle integrity · ${BUILD}</span>`);
  setTimeout(() => {
    applyAllLifecycle();
    renderSchedule();
  }, 50);
})();
