// Clean, information-first renderer for the selected League of Legends game.
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

    const clock = gameContent.querySelector('.clock');
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

  function comparisonRow(label, blueValue, redValue) {
    return `<strong>${escapeHtml(blueValue)}</strong><span>${escapeHtml(label)}</span><strong>${escapeHtml(redValue)}</strong>`;
  }

  function metric(label, blueValue, redValue) {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(blueValue))} – ${escapeHtml(String(redValue))}</strong></div>`;
  }

  function teamCard(team, side, red = false) {
    return `<article class="analysis-team ${red ? 'is-red' : ''}">
      <div class="analysis-team-logo">${logo(team)}</div>
      <div class="analysis-team-copy">
        <span class="analysis-side">${escapeHtml(side)}</span>
        <h3>${escapeHtml(team.name || side)}</h3>
      </div>
      <span class="analysis-team-gold">${formatted(team.gold)} gold</span>
      <strong class="analysis-team-kills">${integer(team.kills)}</strong>
    </article>`;
  }

  renderGame = function redesignedAnalysisRender(snapshot) {
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
    const leadValue = Math.abs(goldDiff);
    const leadText = goldDiff === 0 ? 'Gold is even' : `${leadingTeam} +${formatted(leadValue)} gold`;
    const frameText = snapshot.source?.frameTimestamp
      ? `Frame ${new Date(snapshot.source.frameTimestamp).toLocaleTimeString()}`
      : 'Latest verified frame';

    gameContent.innerHTML = `<div class="analysis-shell">
      <header class="analysis-header game-header">
        <div class="analysis-header-copy game-title">
          <div>
            <p class="analysis-kicker">${escapeHtml(league)} · ${historical ? 'Match history' : 'Live analysis'} · Game ${escapeHtml(gameNumber)}</p>
            <h2>${escapeHtml(blue.name || 'Blue side')} <span>vs</span> ${escapeHtml(red.name || 'Red side')}</h2>
          </div>
        </div>
        <div class="analysis-header-meta">
          <span class="analysis-quality ${safeForLive ? '' : 'is-context'}">${historical ? 'Verified archive' : safeForLive ? 'Verified live frame' : 'Context only'}</span>
          <span class="clock">${escapeHtml(snapshot.clock || '—')}</span>
        </div>
      </header>

      <section class="analysis-scoreboard score-grid" aria-label="Game score">
        ${teamCard(blue, 'Blue side')}
        <div class="analysis-score-center vs">
          <span class="analysis-score-label">KILLS</span>
          <strong>${integer(blue.kills)} – ${integer(red.kills)}</strong>
          <small>Series ${escapeHtml(seriesScore(snapshot))}<br>${escapeHtml(frameText)}</small>
        </div>
        ${teamCard(red, 'Red side', true)}
      </section>

      <section class="analysis-map-state">
        <div class="analysis-lead-card">
          <span>Current gold state</span>
          <strong>${escapeHtml(leadText)}</strong>
          <small>${goldDiff === 0 ? 'No gold advantage' : `${formatted(blue.gold)} – ${formatted(red.gold)} team gold`}</small>
        </div>
        <div class="analysis-metrics metrics">
          ${metric('Towers', integer(blue.towers), integer(red.towers))}
          ${metric('Dragons', count(blue.dragons), count(red.dragons))}
          ${metric('Barons', integer(blue.barons), integer(red.barons))}
          ${metric('Inhibitors', integer(blue.inhibitors), integer(red.inhibitors))}
        </div>
      </section>

      <section class="analysis-comparison">
        <header class="analysis-section-title"><h3>Team comparison</h3><span>Verified map totals</span></header>
        <div class="analysis-compare-grid">
          ${comparisonRow('Gold', formatted(blue.gold), formatted(red.gold))}
          ${comparisonRow('Kills', String(integer(blue.kills)), String(integer(red.kills)))}
          ${comparisonRow('Towers', String(integer(blue.towers)), String(integer(red.towers)))}
          ${comparisonRow('Dragons', String(count(blue.dragons)), String(count(red.dragons)))}
          ${comparisonRow('Barons', String(integer(blue.barons)), String(integer(red.barons)))}
          ${comparisonRow('Inhibitors', String(integer(blue.inhibitors)), String(integer(red.inhibitors)))}
        </div>
      </section>

      <section class="analysis-lineups players" aria-label="Player lineups">
        <article class="analysis-lineup">
          <header class="analysis-lineup-header"><strong>${escapeHtml(blue.name || 'Blue side')}</strong><span>Players</span></header>
          <div class="player-column">${playerRows(blue.players || [])}</div>
        </article>
        <article class="analysis-lineup">
          <header class="analysis-lineup-header"><strong>${escapeHtml(red.name || 'Red side')}</strong><span>Players</span></header>
          <div class="player-column">${playerRows(red.players || [])}</div>
        </article>
      </section>
    </div>`;

    jsonPreview.textContent = JSON.stringify(snapshot, null, 2);
    startAnalysisClock(snapshot, historical);
  };
})();
