// Rejects loading-frame zeros and probes explicit Riot telemetry windows for real gameplay.
(() => {
  const STARTING_GOLD_TOTAL = 5000;
  const PROBE_OFFSETS_SECONDS = [20, 30, 45, 60, 90, 120, 300, 600, 900];
  let probeInFlight = false;

  const style = document.createElement('style');
  style.textContent = `
    .pregame-shell { width: 100%; }
    .pregame-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--border);
    }
    .pregame-badge {
      flex: 0 0 auto;
      padding: 8px 12px;
      border: 1px solid var(--accent);
      border-radius: 999px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .08em;
    }
    .pregame-message {
      padding: 24px 20px 12px;
      color: var(--muted);
      text-align: center;
    }
    .pregame-lineups {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
      padding: 12px 20px 24px;
    }
    .pregame-team h3 { margin: 0 0 12px; }
    .pregame-team .player-kda,
    .pregame-team .player-cs { display: none; }
    .pregame-team .enhanced-player-row { grid-template-columns: minmax(0, 1fr); }
    @media (max-width: 760px) {
      .pregame-banner { align-items: flex-start; flex-direction: column; }
      .pregame-lineups { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);

  function asNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function framesOf(payload) {
    const frames = payload?.frames || payload?.window?.frames || payload?.data?.frames || [];
    return Array.isArray(frames) ? frames : [];
  }

  function latestFrame(payload) {
    const frames = framesOf(payload);
    return frames.length ? frames[frames.length - 1] : null;
  }

  function teamFrame(frame, side) {
    return side === 'blue' ? (frame?.blueTeam || {}) : (frame?.redTeam || {});
  }

  function gameplayProgress(frame) {
    if (!frame) return false;
    const blue = teamFrame(frame, 'blue');
    const red = teamFrame(frame, 'red');
    const players = [...(blue.participants || []), ...(red.participants || [])];
    const totalCs = players.reduce((sum, player) => sum + asNumber(player.creepScore ?? player.cs), 0);
    const combinedGold = asNumber(blue.totalGold ?? blue.gold) + asNumber(red.totalGold ?? red.gold);
    const highestLevel = players.reduce((highest, player) => Math.max(highest, asNumber(player.level)), 0);
    const kills = asNumber(blue.totalKills ?? blue.kills) + asNumber(red.totalKills ?? red.kills);
    const towers = asNumber(blue.towers) + asNumber(red.towers);
    const dragons = (Array.isArray(blue.dragons) ? blue.dragons.length : asNumber(blue.dragons)) +
      (Array.isArray(red.dragons) ? red.dragons.length : asNumber(red.dragons));
    const barons = asNumber(blue.barons) + asNumber(red.barons);

    return totalCs > 0 || combinedGold > STARTING_GOLD_TOTAL || highestLevel > 1 ||
      kills > 0 || towers > 0 || dragons > 0 || barons > 0;
  }

  function snapshotHasGameplay(snapshot) {
    if (!snapshot || snapshot.status !== 'ok') return false;
    const players = [...(snapshot.blue?.players || []), ...(snapshot.red?.players || [])];
    const totalCs = players.reduce((sum, player) => sum + asNumber(player.creepScore), 0);
    const combinedGold = asNumber(snapshot.blue?.gold) + asNumber(snapshot.red?.gold);
    const highestLevel = players.reduce((highest, player) => Math.max(highest, asNumber(player.level)), 0);
    return totalCs > 0 || combinedGold > STARTING_GOLD_TOTAL || highestLevel > 1 ||
      asNumber(snapshot.blue?.kills) + asNumber(snapshot.red?.kills) > 0 ||
      asNumber(snapshot.blue?.towers) + asNumber(snapshot.red?.towers) > 0;
  }

  function metadataPlayers(teamMetadata = {}) {
    return Array.isArray(teamMetadata.participantMetadata) ? teamMetadata.participantMetadata : [];
  }

  function eventTeamForSide(event, gameId, side) {
    const game = (event?.match?.games || []).find(item => String(item.id) === String(gameId));
    const sideTeamId = game?.teams?.find(team => team.side === side)?.id;
    return (event?.match?.teams || []).find(team => String(team.id) === String(sideTeamId)) || {};
  }

  function normalizePlayers(rawTeam, metadata) {
    const rawById = new Map((rawTeam?.participants || []).map((player, index) => [
      asNumber(player.participantId ?? player.participantID ?? index + 1),
      player
    ]));

    return metadataPlayers(metadata).map((meta, index) => {
      const id = asNumber(meta.participantId ?? index + 1);
      const raw = rawById.get(id) || {};
      return {
        participantId: id,
        name: meta.summonerName || raw.summonerName || `Player ${id}`,
        champion: meta.championId || raw.championId || null,
        role: meta.role || null,
        level: asNumber(raw.level),
        kills: asNumber(raw.kills),
        deaths: asNumber(raw.deaths),
        assists: asNumber(raw.assists),
        creepScore: asNumber(raw.creepScore ?? raw.cs),
        totalGold: asNumber(raw.totalGold ?? raw.gold),
        currentGold: asNumber(raw.currentGold),
        items: []
      };
    });
  }

  function normalizeSide(frame, metadata, eventTeam, side) {
    const raw = teamFrame(frame, side);
    const players = normalizePlayers(raw, metadata);
    return {
      id: side === 'blue' ? 100 : 200,
      side,
      name: eventTeam.name || (side === 'blue' ? 'Blue side' : 'Red side'),
      code: eventTeam.code || null,
      image: eventTeam.image || null,
      gold: asNumber(raw.totalGold ?? raw.gold) || players.reduce((sum, player) => sum + player.totalGold, 0),
      kills: asNumber(raw.totalKills ?? raw.kills) || players.reduce((sum, player) => sum + player.kills, 0),
      towers: asNumber(raw.towers),
      inhibitors: asNumber(raw.inhibitors),
      barons: asNumber(raw.barons),
      heralds: asNumber(raw.heralds),
      dragons: Array.isArray(raw.dragons) ? raw.dragons : [],
      players
    };
  }

  function buildSnapshot(payload) {
    const frame = latestFrame(payload);
    if (!frame || !gameplayProgress(frame)) return null;

    const gameId = String(payload?.esportsGameId || state.selectedGameId || '');
    const matchId = String(payload?.esportsMatchId || state.selectedEventId || '');
    const event = selectedScheduleEvent() || {};
    const game = (event?.match?.games || []).find(item => String(item.id) === gameId);
    const metadata = payload?.gameMetadata || {};
    const blue = normalizeSide(
      frame,
      metadata.blueTeamMetadata || {},
      eventTeamForSide(event, gameId, 'blue'),
      'blue'
    );
    const red = normalizeSide(
      frame,
      metadata.redTeamMetadata || {},
      eventTeamForSide(event, gameId, 'red'),
      'red'
    );
    const timestamp = frame.rfc460Timestamp || frame.timestamp || new Date().toISOString();

    return {
      schemaVersion: '1.2-client-probe',
      status: 'ok',
      updatedAt: new Date().toISOString(),
      source: {
        provider: 'Riot LoL Esports web feed',
        gameId,
        matchId,
        unofficialIntegration: true,
        live: true,
        frameTimestamp: timestamp,
        retrieval: 'explicit_starting_time_probe'
      },
      match: {
        league: event?.league?.name || null,
        bestOf: asNumber(event?.match?.strategy?.count) || null,
        gameNumber: asNumber(game?.number) || null,
        patch: metadata.patchVersion || null,
        state: 'in_game'
      },
      clock: null,
      clockSeconds: null,
      blue,
      red,
      differences: {
        gold: blue.gold - red.gold,
        kills: blue.kills - red.kills,
        towers: blue.towers - red.towers,
        dragons: blue.dragons.length - red.dragons.length,
        barons: blue.barons - red.barons
      },
      summary: `${blue.name} vs ${red.name}: ${blue.kills}-${red.kills} kills, ${blue.towers}-${red.towers} towers.`
    };
  }

  function roundedIso(timestampMs) {
    return new Date(Math.floor(timestampMs / 10000) * 10000).toISOString();
  }

  async function probeRealGameplay() {
    if (probeInFlight || !state.selectedGameId) return null;
    probeInFlight = true;

    try {
      const times = [];
      const lastTimestamp = Date.parse(String(state.lastSnapshot?.source?.frameTimestamp || ''));
      if (Number.isFinite(lastTimestamp)) times.push(lastTimestamp + 10000);
      for (const offset of PROBE_OFFSETS_SECONDS) times.push(Date.now() - offset * 1000);

      const unique = [...new Set(times.map(roundedIso))];
      const results = await Promise.allSettled(unique.map(startingTime =>
        api(`/api/window?gameId=${encodeURIComponent(state.selectedGameId)}&startingTime=${encodeURIComponent(startingTime)}`)
      ));

      let best = null;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const snapshot = buildSnapshot(result.value);
        if (!snapshot) continue;
        const timestamp = Date.parse(snapshot.source.frameTimestamp) || 0;
        if (!best || timestamp > best.timestamp) best = { snapshot, timestamp };
      }
      return best?.snapshot || null;
    } finally {
      probeInFlight = false;
    }
  }

  function showPregameSnapshot(snapshot) {
    state.lastSnapshot = snapshot;
    markMatchLive(state.selectedEventId);

    showWaiting(selectedScheduleEvent(), {
      selectedGame: null,
      games: [],
      checkedAt: snapshot?.updatedAt
    });

    const blue = snapshot?.blue || {};
    const red = snapshot?.red || {};
    const event = selectedScheduleEvent();
    const league = snapshot?.match?.league || event?.league?.name || 'LoL Esports';
    const gameNumber = snapshot?.match?.gameNumber || '?';

    gameContent.innerHTML = `
      <div class="pregame-shell">
        <div class="pregame-banner">
          <div>
            <p class="eyebrow">${league} · LIVE SERIES · GAME ${gameNumber}</p>
            <h2>${blue.name || 'Blue side'} vs ${red.name || 'Red side'}</h2>
          </div>
          <span class="pregame-badge">AWAITING GAMEPLAY</span>
        </div>
        <div class="pregame-message">
          Champion selections were received, but Riot is still returning the loading-frame values
          (2,500 starting gold, 0 CS and 0 objectives). The dashboard is probing explicit live windows;
          stats and the clock will appear as soon as a genuine gameplay frame is available.
        </div>
        <div class="pregame-lineups">
          <section class="pregame-team"><h3>${blue.name || 'Blue side'}</h3>${playerRows(blue.players || [])}</section>
          <section class="pregame-team"><h3>${red.name || 'Red side'}</h3>${playerRows(red.players || [])}</section>
        </div>
      </div>`;

    setJsonEndpoint(state.selectedGameId);
    jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
    setConnection('LIVE · probing gameplay telemetry', 'live');
  }

  async function renderLiveSnapshot(snapshot, historical) {
    if (historical) snapshot.match = { ...(snapshot.match || {}), state: 'finished' };
    else markMatchLive(state.selectedEventId);

    renderGame(snapshot);
    if (historical) {
      setConnection('Finished · historical snapshot', '');
    } else {
      const frameTime = snapshot.source?.frameTimestamp
        ? new Date(snapshot.source.frameTimestamp).toLocaleTimeString()
        : new Date(snapshot.updatedAt).toLocaleTimeString();
      setConnection(`LIVE · frame ${frameTime}`, 'live');
    }
  }

  loadGame = async function guardedLoadGame() {
    if (!state.selectedGameId || document.hidden) return;

    try {
      const historical = state.selectedMatchState === 'completed';
      const cursor = !historical ? state.lastSnapshot?.source?.frameTimestamp : null;
      const cursorParam = cursor ? `&startingTime=${encodeURIComponent(cursor)}` : '';
      const snapshot = await api(
        `/api/chatgpt?gameId=${encodeURIComponent(state.selectedGameId)}` +
        `${historical ? '&historical=1' : ''}${cursorParam}`
      );

      if (historical) {
        await renderLiveSnapshot(snapshot, true);
        return;
      }

      if (snapshotHasGameplay(snapshot)) {
        await renderLiveSnapshot(snapshot, false);
        return;
      }

      const probedSnapshot = await probeRealGameplay();
      if (probedSnapshot) {
        await renderLiveSnapshot(probedSnapshot, false);
        return;
      }

      if (snapshot?.status === 'telemetry_unavailable') {
        showTelemetryUnavailable(selectedScheduleEvent(), snapshot);
        return;
      }

      showPregameSnapshot(snapshot);
    } catch (error) {
      setConnection(error.message, 'error');
      gameContent.innerHTML = `<div class="empty hero-empty"><strong>Feed unavailable</strong><span>${error.message}</span></div>`;
    }
  };
})();