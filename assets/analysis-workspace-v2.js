// Compact main analysis layout with a dedicated bookmaker-odds region.
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

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function integer(value) {
    return Math.round(number(value));
  }

  function formatted(value) {
    return number(value).toLocaleString();
  }

  function count(value) {
    return Array.isArray(value) ? value.length : integer(value);
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

    const clock = gameContent.querySelector('.analysis-v2-clock');
    if (!clock) return;

    const rawSeconds = snapshot.clockSeconds;
    const initialSeconds = rawSeconds !== null && rawSeconds !== undefined && rawSeconds !== ''
      ? number(rawSeconds, NaN)
      : parseClock(snapshot.clock);

    if (!Number.isFinite(initialSeconds)) {
      clock.textContent = snapshot.clock || '—';
      return;
    }

    const frameMs = Date.parse(snapshot.source?.frameTimestamp || snapshot.updatedAt || '') || Date.now();
    const paint = () => {
      if (!clock.isConnected) {
        clearInterval(analysisClockTimer);
        analysisClockTimer = null;
        return;
      }
      const elapsed = historical ? 0 : Math.max(0, (Date.now() - frameMs) / 1000);
      clock.textContent = formatClock(initialSeconds + elapsed);
    };

    paint();
    if (!historical) analysisClockTimer = setInterval(paint, 1000);
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
    return `<article class="analysis-v2-team ${red ? 'is-red' : ''}">
      <div class="analysis-v2-team-logo">${logo(team)}</div>
      <div class="analysis-v2-team-copy">
        <span>${escapeHtml(side)}</span>
        <h3>${escapeHtml(team.name || side)}</h3>
        <small>${formatted(team.gold)} gold</small>
      </div>
      <strong class="analysis-v2-team-kills">${integer(team.kills)}</strong>
    </article>`;
  }

  function objectiveCard(label, blueValue, redValue) {
    return `<article class="analysis-v2-objective">
      <span>${escapeHtml(label)}</span>
      <div><strong>${escapeHtml(String(blueValue))}</strong><i>–</i><strong>${escapeHtml(String(redValue))}</strong></div>
      <small>Blue · Red</small>
    </article>`;
  }

  function oddsPlaceholder(historical) {
    return `<div class="analysis-v2-odds-placeholder" data-odds-placeholder>
      <span>Bookmaker markets</span>
      <h3>${historical ? 'No live market for this archive' : 'Waiting for matched odds'}</h3>
      <p>${historical
        ? 'Completed matches remain available for analysis, but live bookmaker markets are no longer active.'
        : 'When the private odds bridge matches this event, the current markets will appear here automatically.'}</p>
    </div>`;
  }

  renderGame = function rearrangedAnalysisRender(snapshot) {
    state.lastSnapshot = snapshot;

    const blue = snapshot.blue || {};
    const red = snapshot.red || {};
    const event = selectedScheduleEvent();
    const historical = state.selectedMatchState === 'completed' || snapshot.match?.state === 'finished';
    const league = snapshot.match?.league || event?.league?.name || event?.league?.slug || 'LoL Esports';
    const gameNumber = snapshot.match?.gameNumber || '?';
    const goldDiff = number(snapshot.differences?.gold, number(blue.gold) - number(red.gold));
    const safeForLive = !historical && snapshot.status === 'ok' && snapshot.quality?.safeForLiveAnalysis !== false;
    const leadingTeam = goldDiff > 0 ? (blue.name || 'Blue side') : goldDiff < 0 ? (red.name || 'Red side') : 'Even game';
    const leadText = goldDiff === 0 ? 'Gold is even' : `${leadingTeam} +${formatted(Math.abs(goldDiff))}`;
    const frameText = snapshot.source?.frameTimestamp
      ? new Date(snapshot.source.frameTimestamp).toLocaleTimeString()
      : 'Latest frame';

    gameContent.innerHTML = `<div class="analysis-v2-shell">
      <header class="analysis-v2-header">
        <div class="analysis-v2-title">
          <p>${escapeHtml(league)} · ${historical ? 'Match history' : 'Live analysis'} · Game ${escapeHtml(gameNumber)}</p>
          <h2>${escapeHtml(blue.name || 'Blue side')} <span>vs</span> ${escapeHtml(red.name || 'Red side')}</h2>
        </div>
        <div class="analysis-v2-header-meta">
          <span class="analysis-v2-quality ${safeForLive ? '' : 'is-context'}">${historical ? 'Verified archive' : safeForLive ? 'Verified live frame' : 'Context only'}</span>
          <span class="analysis-v2-clock">${escapeHtml(snapshot.clock || '—')}</span>
        </div>
      </header>

      <section class="analysis-v2-scoreboard" aria-label="Game scoreboard">
        ${teamCard(blue, 'Blue side')}
        <div class="analysis-v2-score-center">
          <span>KILLS</span>
          <strong>${integer(blue.kills)} – ${integer(red.kills)}</strong>
          <small>Series ${escapeHtml(seriesScore(snapshot))}<br>Frame ${escapeHtml(frameText)}</small>
        </div>
        ${teamCard(red, 'Red side', true)}
      </section>

      <div class="analysis-v2-body">
        <section class="analysis-v2-state" aria-label="Verified map state">
          <header><div><span>Map state</span><h3>Verified game totals</h3></div><small>Blue · Red</small></header>
          <div class="analysis-v2-lead">
            <span>Gold advantage</span>
            <strong>${escapeHtml(leadText)}</strong>
            <small>${formatted(blue.gold)} – ${formatted(red.gold)} team gold</small>
          </div>
          <div class="analysis-v2-objectives">
            ${objectiveCard('Towers', integer(blue.towers), integer(red.towers))}
            ${objectiveCard('Dragons', count(blue.dragons), count(red.dragons))}
            ${objectiveCard('Barons', integer(blue.barons), integer(red.barons))}
            ${objectiveCard('Inhibitors', integer(blue.inhibitors), integer(red.inhibitors))}
          </div>
        </section>

        <section id="analysisOddsSlot" class="analysis-v2-odds" aria-label="Bookmaker odds">
          ${oddsPlaceholder(historical)}
        </section>
      </div>

      <section class="analysis-v2-lineups players" aria-label="Player lineups">
        <article class="analysis-v2-lineup">
          <header><strong>${escapeHtml(blue.name || 'Blue side')}</strong><span>Blue players</span></header>
          <div class="player-column">${playerRows(blue.players || [])}</div>
        </article>
        <article class="analysis-v2-lineup">
          <header><strong>${escapeHtml(red.name || 'Red side')}</strong><span>Red players</span></header>
          <div class="player-column">${playerRows(red.players || [])}</div>
        </article>
      </section>
    </div>`;

    jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
    startAnalysisClock(snapshot, historical);
  };
})();