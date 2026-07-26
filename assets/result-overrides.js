// Explicit result overrides for matches where Riot never publishes a completed state.
// Keep this small, transparent, and limited to externally confirmed results.
(() => {
  const overrides = {
    '11566854547835316': {
      scoreByCode: { LNG: 0, NIP: 2 },
      winnerCode: 'NIP',
      source: 'external_confirmed',
      note: 'Riot kept every game as unstarted; games 1 and 2 were externally confirmed as NIP wins.'
    }
  };

  function eventKey(event) {
    return String(event?.match?.id || event?.id || '');
  }

  function scoreForTeam(team, override) {
    const code = String(team?.code || '').toUpperCase();
    if (Object.hasOwn(override.scoreByCode, code)) return Number(override.scoreByCode[code]);

    const name = String(team?.name || '').toUpperCase();
    for (const [key, score] of Object.entries(override.scoreByCode)) {
      if (name.includes(key)) return Number(score);
    }
    return null;
  }

  function applyOverride(event, override) {
    if (!event?.match?.teams?.length) return false;

    let applied = false;
    for (const team of event.match.teams) {
      const score = scoreForTeam(team, override);
      if (score === null) continue;
      team.result = { ...(team.result || {}), gameWins: score };
      applied = true;
    }

    if (applied) {
      event.state = 'completed';
      event.resultSource = override.source;
    }
    return applied;
  }

  function selectedOverride() {
    return overrides[String(state.selectedEventId || '')] || null;
  }

  function renderSelectedOverride(event, override) {
    const [a, b] = eventTeams(event);
    const aScore = Number(a?.result?.gameWins || 0);
    const bScore = Number(b?.result?.gameWins || 0);

    state.liveMatchIds.delete(String(state.selectedEventId));
    state.selectedMatchState = 'completed';
    state.selectedGameId = null;
    clearMatchTimers();

    gameContent.innerHTML = `
      <div class="empty hero-empty">
        <strong>Match finished · ${a?.name || 'Team 1'} ${aScore}–${bScore} ${b?.name || 'Team 2'}</strong>
        <span>Riot did not publish a completed LPL result for this event. This score is shown from an externally confirmed result override.</span>
      </div>`;

    jsonUrl.value = '';
    copyJsonUrl.disabled = true;
    jsonPreview.textContent = JSON.stringify({
      status: 'finished',
      matchId: String(state.selectedEventId),
      source: override.source,
      winnerCode: override.winnerCode,
      score: override.scoreByCode,
      note: override.note,
      updatedAt: new Date().toISOString()
    }, null, 2);

    setConnection(`FINISHED · ${aScore}–${bScore} · external confirmation`, '');
  }

  function applyAllOverrides() {
    let changed = false;
    for (const event of state.events || []) {
      const override = overrides[eventKey(event)];
      if (!override) continue;
      changed = applyOverride(event, override) || changed;
      state.liveMatchIds.delete(eventKey(event));
    }

    if (changed) renderSchedule();

    const event = selectedScheduleEvent();
    const override = selectedOverride();
    if (event && override && applyOverride(event, override)) {
      renderSchedule();
      renderSelectedOverride(event, override);
    }
  }

  const baseLoadSchedule = loadSchedule;
  loadSchedule = async function overrideAwareLoadSchedule(...args) {
    const result = await baseLoadSchedule(...args);
    applyAllOverrides();
    return result;
  };

  const baseSelectEvent = selectEvent;
  selectEvent = async function overrideAwareSelectEvent(id) {
    const override = overrides[String(id)];
    if (!override) return baseSelectEvent(id);

    state.selectedEventId = String(id);
    state.selectedGameId = null;
    state.selectedMatchState = 'completed';
    clearMatchTimers();

    const event = selectedScheduleEvent();
    if (event && applyOverride(event, override)) {
      renderSchedule();
      renderSelectedOverride(event, override);
      return;
    }

    await baseSelectEvent(id);
    applyAllOverrides();
  };

  setTimeout(() => {
    applyAllOverrides();
    loadSchedule(true);
  }, 0);
})();