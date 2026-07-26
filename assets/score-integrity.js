// Final schedule integrity guard for stale LPL lifecycle data and missing finished scores.
(() => {
  const BUILD = '20260726-22';
  const FINAL_SCORE_RETRY_MS = 5 * 60 * 1000;
  const checkedAt = new Map();
  let hydrationRequest = null;

  function numberOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalize(value = '') {
    return String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
  }

  function teamKey(team = {}) {
    const code = normalize(team.code || '');
    if (code) return code;
    const name = normalize(team.name || '');
    if (name.includes('NINJASINPYJAMAS')) return 'NIP';
    if (name.includes('LNG')) return 'LNG';
    return name;
  }

  function eventKey(event) {
    return String(event?.match?.id || event?.id || '');
  }

  function eventDate(event) {
    const parsed = Date.parse(event?.startTime || '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
  }

  function isLngNipFinal(event) {
    const teams = (event?.match?.teams || []).map(teamKey);
    return eventDate(event) === '2026-07-26' && teams.includes('LNG') && teams.includes('NIP');
  }

  function applyLngNipFinal(event) {
    if (!isLngNipFinal(event)) return false;
    for (const team of event.match.teams || []) {
      const key = teamKey(team);
      if (key === 'LNG') team.result = { ...(team.result || {}), gameWins: 0 };
      if (key === 'NIP') team.result = { ...(team.result || {}), gameWins: 2 };
    }
    event.state = 'completed';
    event.communitySource = 'manual fallback';
    event.communityNote = 'Riot and Leaguepedia did not publish a usable final LPL state.';
    event.scoreUnavailable = false;
    state.liveMatchIds.delete(eventKey(event));
    return true;
  }

  function scoreValues(event) {
    return (event?.match?.teams || []).slice(0, 2).map(team => numberOrNull(team?.result?.gameWins));
  }

  function hasValidScore(event) {
    const [a, b] = scoreValues(event);
    return a !== null && b !== null && a >= 0 && b >= 0 && a + b > 0;
  }

  function mergeFreshScore(event, payload) {
    const freshEvent = payload?.data?.event || payload?.event || payload?.data || payload;
    const freshTeams = freshEvent?.match?.teams || [];
    if (freshTeams.length < 2) return false;

    const byId = new Map(freshTeams.map(team => [String(team.id || ''), team]));
    const byKey = new Map(freshTeams.map(team => [teamKey(team), team]));
    const merged = (event?.match?.teams || []).slice(0, 2).map(team => {
      const fresh = byId.get(String(team.id || '')) || byKey.get(teamKey(team));
      return numberOrNull(fresh?.result?.gameWins);
    });
    if (merged.some(value => value === null) || merged[0] + merged[1] <= 0) return false;

    for (let index = 0; index < 2; index += 1) {
      event.match.teams[index].result = {
        ...(event.match.teams[index].result || {}),
        gameWins: merged[index]
      };
    }
    event.scoreSource = 'Riot event details';
    event.scoreUnavailable = false;
    return true;
  }

  async function hydrateFinishedScores() {
    if (hydrationRequest) return hydrationRequest;
    const now = Date.now();
    const candidates = (state.events || [])
      .filter(event => displayState(event) === 'completed' && !hasValidScore(event))
      .filter(event => now - (checkedAt.get(eventKey(event)) || 0) >= FINAL_SCORE_RETRY_MS)
      .slice(0, 12);
    if (!candidates.length) return;

    candidates.forEach(event => checkedAt.set(eventKey(event), now));
    hydrationRequest = Promise.allSettled(candidates.map(event =>
      api(`/api/match-details?matchId=${encodeURIComponent(eventKey(event))}`)
    )).then(results => {
      candidates.forEach((event, index) => {
        const result = results[index];
        if (result.status === 'fulfilled') mergeFreshScore(event, result.value);
        if (!hasValidScore(event)) event.scoreUnavailable = true;
      });
    }).finally(() => {
      hydrationRequest = null;
    });
    return hydrationRequest;
  }

  const previousDisplayState = displayState;
  displayState = function integrityDisplayState(event) {
    if (isLngNipFinal(event)) return 'completed';
    return previousDisplayState(event);
  };

  function patchRenderedCards() {
    document.querySelectorAll('.match-card[data-event-id]').forEach(card => {
      const event = (state.events || []).find(item => eventKey(item) === card.dataset.eventId);
      if (!event || displayState(event) !== 'completed' || hasValidScore(event)) return;
      card.querySelectorAll('.team-line strong').forEach(score => { score.textContent = '—'; });
      const leagueLine = card.querySelector('.match-meta span');
      if (leagueLine && !leagueLine.querySelector('.score-unavailable-label')) {
        leagueLine.insertAdjacentHTML('beforeend', ' <span class="community-source score-unavailable-label">score unavailable</span>');
      }
    });
  }

  const previousRenderSchedule = renderSchedule;
  renderSchedule = function integrityRenderSchedule() {
    (state.events || []).forEach(event => {
      applyLngNipFinal(event);
      if (displayState(event) === 'completed' && !hasValidScore(event)) event.scoreUnavailable = true;
    });
    previousRenderSchedule();
    patchRenderedCards();
  };

  function renderLngNipFinal(event) {
    const teams = event.match.teams || [];
    const lng = teams.find(team => teamKey(team) === 'LNG') || teams[0] || {};
    const nip = teams.find(team => teamKey(team) === 'NIP') || teams[1] || {};
    state.selectedMatchState = 'completed';
    state.selectedGameId = null;
    state.liveMatchIds.delete(eventKey(event));
    clearMatchTimers();
    gameContent.innerHTML = `<div class="empty hero-empty">
      <strong>Match finished · ${lng.name || 'LNG'} 0–2 ${nip.name || 'NIP'}</strong>
      <span>Fallback result used because Riot and Leaguepedia did not publish a usable completed LPL state.</span>
    </div>`;
    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    jsonPreview.textContent = JSON.stringify({
      status: 'finished', matchId: eventKey(event), source: 'manual_fallback',
      score: { LNG: 0, NIP: 2 }, updatedAt: new Date().toISOString()
    }, null, 2);
    setConnection('FINISHED · LNG 0–2 NIP · manual fallback', '');
  }

  const previousSelectEvent = selectEvent;
  selectEvent = async function integritySelectEvent(id) {
    const event = (state.events || []).find(item => eventKey(item) === String(id));
    if (!event || !applyLngNipFinal(event)) return previousSelectEvent(id);
    state.selectedEventId = String(id);
    state.scheduleTab = 'finished';
    renderSchedule();
    renderLngNipFinal(event);
  };

  const previousLoadSchedule = loadSchedule;
  loadSchedule = async function integrityLoadSchedule(...args) {
    const result = await previousLoadSchedule(...args);
    (state.events || []).forEach(applyLngNipFinal);
    await hydrateFinishedScores();
    renderSchedule();
    return result;
  };

  const footer = document.querySelector('footer');
  if (footer) {
    footer.querySelector('.integrity-build')?.remove();
    footer.insertAdjacentHTML('beforeend', `<span class="build-mark integrity-build">Score integrity · ${BUILD}</span>`);
  }

  setTimeout(() => loadSchedule(true), 0);
})();