// Compact main analysis layout with a centered game clock and mirrored team cards.
(() => {
  'use strict';

  let analysisClockTimer = null;

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function number(value, fallback = 0) {
    const parsed = finiteNumber(value);
    return parsed === null ? fallback : parsed;
  }

  function integer(value, fallback = '—') {
    const parsed = finiteNumber(value);
    return parsed === null ? fallback : Math.round(parsed);
  }

  function formatted(value, fallback = '—') {
    const parsed = finiteNumber(value);
    return parsed === null ? fallback : parsed.toLocaleString('en-US');
  }

  function count(value) {
    if (Array.isArray(value)) return value.length;
    return integer(value);
  }

  function initials(name = '') {
    const result = String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
    return result || '?';
  }

  function logo(team = {}) {
    if (!team.image) return `<span>${escapeHtml(initials(team.name))}</span>`;
    return `<img src="${escapeHtml(secureUrl(team.image))}" alt="">`;
  }

  function parseClock(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value !== 'string' || !value.includes(':')) return null;
    const parts = value.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part))) return null;
    if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
    if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    return null;
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
      : `${minutes}:${String(remaining).padStart(2, '0')}`;
  }

  function startAnalysisClock(snapshot, historical) {
    clearInterval(analysisClockTimer);
    analysisClockTimer = null;

    if (typeof globalThis.RiftPulsePlayerUI?.configureClock === 'function') {
      globalThis.RiftPulsePlayerUI.configureClock(snapshot);
      return;
    }

    const clock = gameContent.querySelector('.analysis-v2-clock');
    if (!clock) return;

    const rawSeconds = snapshot.clockSeconds;
    const initialSeconds = rawSeconds !== null && rawSeconds !== undefined && rawSeconds !== ''
      ? number(rawSeconds, NaN)
      : parseClock(snapshot.clock);

    if (!Number.isFinite(initialSeconds)) {
      clock.textContent = '—';
      clock.title = 'Riot did not provide a reliable game clock for this frame.';
      return;
    }

    const frozen = historical || snapshot.status === 'telemetry_stale' || snapshot.source?.live === false;
    const frameMs = Date.parse(snapshot.source?.frameTimestamp || snapshot.updatedAt || '') || Date.now();
    const paint = () => {
      if (!clock.isConnected) {
        clearInterval(analysisClockTimer);
        analysisClockTimer = null;
        return;
      }
      const elapsed = frozen ? 0 : Math.max(0, (Date.now() - frameMs) / 1000);
      clock.textContent = formatClock(initialSeconds + elapsed);
    };

    paint();
    if (!frozen) analysisClockTimer = setInterval(paint, 1000);
  }

  function seriesScore(snapshot) {
    const event = selectedScheduleEvent();
    const eventTeamsValue = event?.match?.teams || [];
    if (eventTeamsValue.length >= 2) {
      return `${integer(eventTeamsValue[0]?.result?.gameWins)}–${integer(eventTeamsValue[1]?.result?.gameWins)}`;
    }

    const teams = Array.isArray(snapshot.series?.teams) ? snapshot.series.teams : [];
    if (teams.length >= 2) return `${integer(teams[0]?.wins)}–${integer(teams[1]?.wins)}`;
    return '—';
  }

  function teamCard(team, side, red = false) {
    return `<article class="analysis-v2-team ${red ? 'is-red' : 'is-blue'}">
      <div class="analysis-v2-team-logo">${logo(team)}</div>
      <div class="analysis-v2-team-copy">
        <span>${escapeHtml(side)}</span>
        <h3>${escapeHtml(team.name || side)}</h3>
        <small>${escapeHtml(String(formatted(team.gold)))} gold</small>
      </div>
      <strong class="analysis-v2-team-kills">${escapeHtml(String(integer(team.kills)))}</strong>
    </article>`;
  }

  function objectiveCard(label, blueValue, redValue) {
    return `<article class="analysis-v2-objective">
      <span>${escapeHtml(label)}</span>
      <div><strong>${escapeHtml(String(blueValue))}</strong><i>–</i><strong>${escapeHtml(String(redValue))}</strong></div>
    </article>`;
  }

  function oddsPlaceholder(historical) {
    if (historical) {
      return `<div class="analysis-v2-odds-placeholder is-archive" data-odds-placeholder>
        <span>Bookmaker markets</span>
        <h3>Markets closed</h3>
        <p>This completed game does not show current bookmaker prices as historical odds.</p>
      </div>`;
    }

    return `<div class="analysis-v2-odds-placeholder" data-odds-placeholder>
      <span>Live odds</span>
      <h3>Odds unavailable</h3>
      <p>The private bookmaker bridge has not matched this Riot game yet.</p>
    </div>`;
  }

  function qualityLabel(snapshot, historical, safeForLive) {
    if (historical) return 'Verified archive';
    if (safeForLive) return 'Verified live';
    if (snapshot.status === 'degraded') return 'Delayed data';
    if (snapshot.status === 'telemetry_stale') return 'Stale context';
    return 'Context only';
  }

  function stateHeading(snapshot, historical, safeForLive) {
    if (historical) return 'Final map totals';
    if (snapshot.status === 'telemetry_stale') return 'Last available map totals';
    if (safeForLive) return 'Current map totals';
    return 'Available map totals';
  }

  function lineupHeader(teamName, sideLabel) {
    return `<header>
      <div><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(sideLabel)}</span></div>
      <div class="analysis-v2-lineup-columns" aria-hidden="true">
        <span>KDA</span><span>CS</span><span>Gold</span><span>Items</span>
      </div>
    </header>`;
  }

  renderGame = function rearrangedAnalysisRender(snapshot) {
    state.lastSnapshot = snapshot;

    const blue = snapshot.blue || {};
    const red = snapshot.red || {};
    const event = selectedScheduleEvent();
    const historical = state.selectedMatchState === 'completed' || snapshot.match?.state === 'finished';
    const league = snapshot.match?.league || event?.league?.name || event?.league?.slug || 'LoL Esports';
    const gameNumber = snapshot.match?.gameNumber || '?';
    const blueGold = finiteNumber(blue.gold);
    const redGold = finiteNumber(red.gold);
    const reportedGoldDiff = finiteNumber(snapshot.differences?.gold);
    const goldDiff = reportedGoldDiff !== null
      ? reportedGoldDiff
      : blueGold !== null && redGold !== null
        ? blueGold - redGold
        : null;
    const safeForLive = !historical && snapshot.status === 'ok' && snapshot.quality?.safeForLiveAnalysis !== false;
    const leadingTeam = goldDiff === null
      ? null
      : goldDiff > 0
        ? (blue.name || 'Blue side')
        : goldDiff < 0
          ? (red.name || 'Red side')
          : 'Even game';
    const leadText = goldDiff === null
      ? 'Gold lead unavailable'
      : goldDiff === 0
        ? 'Gold is even'
        : `${leadingTeam} +${formatted(Math.abs(goldDiff))}`;

    const overviewSection = `<section class="analysis-v2-state" aria-label="Game overview">
      <header class="analysis-v2-state-header">
        <div class="analysis-v2-state-heading">
          <span>Game overview</span>
          <h3>${escapeHtml(stateHeading(snapshot, historical, safeForLive))}</h3>
        </div>
        <div class="analysis-v2-state-legend" aria-label="Stat order">
          <span class="is-blue">Blue</span><i aria-hidden="true">·</i><span class="is-red">Red</span>
        </div>
      </header>
      <div class="analysis-v2-state-content">
        <div class="analysis-v2-lead">
          <span>Gold advantage</span>
          <strong>${escapeHtml(leadText)}</strong>
          <small>${escapeHtml(String(formatted(blue.gold)))} – ${escapeHtml(String(formatted(red.gold)))} team gold</small>
        </div>
        <div class="analysis-v2-objectives">
          ${objectiveCard('Towers', integer(blue.towers), integer(red.towers))}
          ${objectiveCard('Dragons', count(blue.dragons), count(red.dragons))}
          ${objectiveCard('Barons', integer(blue.barons), integer(red.barons))}
          ${objectiveCard('Inhibitors', integer(blue.inhibitors), integer(red.inhibitors))}
        </div>
      </div>
    </section>`;

    const oddsSection = `<section id="analysisOddsSlot" class="analysis-v2-odds" data-odds-mode="${historical ? 'archive' : 'live'}" aria-label="Bookmaker odds">
      ${oddsPlaceholder(historical)}
    </section>`;

    gameContent.innerHTML = `<div class="analysis-v2-shell">
      <header class="analysis-v2-header">
        <div class="analysis-v2-title">
          <p>${escapeHtml(league)} · ${historical ? 'Match history' : 'Live analysis'} · Game ${escapeHtml(gameNumber)}</p>
          <h2>${escapeHtml(blue.name || 'Blue side')} <span>vs</span> ${escapeHtml(red.name || 'Red side')}</h2>
        </div>
        <div class="analysis-v2-header-meta">
          <span class="analysis-v2-quality ${safeForLive ? '' : 'is-context'}">${escapeHtml(qualityLabel(snapshot, historical, safeForLive))}</span>
        </div>
      </header>

      <section class="analysis-v2-scoreboard" aria-label="Game scoreboard">
        ${teamCard(blue, 'Blue side')}
        <div class="analysis-v2-score-center" aria-label="Game time and series score">
          <span>GAME TIME</span>
          <strong class="analysis-v2-clock">${escapeHtml(snapshot.clock || '—')}</strong>
          <small>Game ${escapeHtml(gameNumber)} · Series ${escapeHtml(seriesScore(snapshot))}</small>
        </div>
        ${teamCard(red, 'Red side', true)}
      </section>

      ${overviewSection}
      ${oddsSection}

      <section class="analysis-v2-lineups players" aria-label="Player lineups">
        <article class="analysis-v2-lineup">
          ${lineupHeader(blue.name || 'Blue side', 'Blue team')}
          <div class="player-column">${playerRows(blue.players || [])}</div>
        </article>
        <article class="analysis-v2-lineup">
          ${lineupHeader(red.name || 'Red side', 'Red team')}
          <div class="player-column">${playerRows(red.players || [])}</div>
        </article>
      </section>
    </div>`;

    jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
    startAnalysisClock(snapshot, historical);
  };
})();
