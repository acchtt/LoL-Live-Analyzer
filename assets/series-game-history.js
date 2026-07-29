// Restores every played game's archived snapshot in completed-series history.
(() => {
  'use strict';

  const style = document.createElement('style');
  style.dataset.riftpulseSeriesHistory = 'all-games';
  style.textContent = `
    .history-game-nav { display: grid !important; }
    .history-summary-meta::after { content: none !important; display: none !important; }
  `;
  document.head.appendChild(style);

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeImageUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
    return '';
  }

  function initials(name = '') {
    return String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || '?';
  }

  function teamLogo(team = {}) {
    const image = safeImageUrl(team?.image);
    return image
      ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
      : `<span>${escapeHtml(initials(team?.name))}</span>`;
  }

  function historyIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M11 7v4l3 2M16.5 16.5 21 21"></path></svg>';
  }

  function archiveIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.4-2.7 8.2-7 10-4.3-1.8-7-5.6-7-10V6l7-3Z"></path><path d="m9 12 2 2 4-5"></path></svg>';
  }

  function contextIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"></path><path d="M8 6H5v1a4 4 0 0 0 4 4m7-5h3v1a4 4 0 0 1-4 4M12 12v5m-3 3h6"></path></svg>';
  }

  function finiteScore(team = {}) {
    const value = team?.result?.gameWins;
    const parsed = Number(value);
    return value === undefined || value === null || !Number.isFinite(parsed) || parsed < 0
      ? null
      : parsed;
  }

  function gameNumber(game, index) {
    const parsed = Number(game?.number);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 1;
  }

  function seriesLength(event = {}, games = []) {
    const configured = Number(event?.match?.strategy?.count);
    if ([1, 2, 3, 5].includes(configured)) return configured;

    const highestNumber = games.reduce(
      (highest, game, index) => Math.max(highest, gameNumber(game, index)),
      0
    );
    if ([1, 2, 3, 5].includes(highestNumber)) return highestNumber;
    return Math.max(1, Math.min(5, highestNumber || games.length || 1));
  }

  function hasCompletionEvidence(game) {
    return game?.state === 'completed' || (Array.isArray(game?.vods) && game.vods.length > 0);
  }

  function playedGames(event = {}) {
    const rawGames = (Array.isArray(event?.match?.games) ? event.match.games : [])
      .filter(game => game?.id)
      .sort((left, right) => Number(left?.number || 0) - Number(right?.number || 0));
    if (!rawGames.length) return [];

    const scores = (event?.match?.teams || []).map(finiteScore);
    const scoreCount = scores.length >= 2 && scores.every(score => score !== null)
      ? scores.reduce((sum, score) => sum + score, 0)
      : 0;

    const evidenceCount = rawGames.reduce((highest, game, index) => (
      hasCompletionEvidence(game) ? Math.max(highest, gameNumber(game, index)) : highest
    ), 0);

    // Riot occasionally marks only the last game completed. A final Game 3 plus a
    // 2-1 series score still means Games 1-3 were played, even if Games 1-2 have
    // stale state flags. Never use the best-of length because sweeps leave games unplayed.
    const playedCount = Math.min(rawGames.length, Math.max(scoreCount, evidenceCount));
    if (playedCount > 0) return rawGames.slice(0, playedCount);
    return rawGames.filter(hasCompletionEvidence);
  }

  function selectedGameNumber(games = []) {
    const selectedId = String(state.selectedGameId || '');
    const selectedIndex = games.findIndex(game => String(game?.id || '') === selectedId);
    if (selectedIndex >= 0) return gameNumber(games[selectedIndex], selectedIndex);
    const last = games[games.length - 1];
    return last ? gameNumber(last, games.length - 1) : 1;
  }

  function renderSeriesNavigation() {
    if (state.selectedMatchState !== 'completed' || !state.historyMatch) return;
    if (typeof document?.querySelector !== 'function' || typeof document?.createElement !== 'function'
        || typeof gameContent?.insertBefore !== 'function') return;
    document.querySelector('#historySeriesSummary')?.remove();

    const event = state.historyMatch.event || selectedScheduleEvent() || {};
    const teams = eventTeams(event);
    const a = teams[0] || {};
    const b = teams[1] || {};
    const games = state.historyMatch.games || [];
    const format = seriesLength(event, games);
    const aScore = finiteScore(a);
    const bScore = finiteScore(b);
    const selectedNumber = selectedGameNumber(games);
    const league = event?.league?.name || event?.league?.slug || 'League of Legends';
    const gameByNumber = new Map(games.map((game, index) => [gameNumber(game, index), game]));
    const summary = document.createElement('section');
    summary.id = 'historySeriesSummary';
    summary.className = 'history-series-summary series-hero series-hero--history';
    summary.dataset.seriesLength = String(format);
    summary.innerHTML = `
      <div class="series-hero-top">
        <div class="series-hero-main">
          <div class="series-hero-kicker">
            <span class="series-hero-kicker-icon">${historyIcon()}</span>
            <span><strong>Match history</strong><small>Best of ${format}</small></span>
          </div>
          <div class="series-hero-matchup">
            <article class="series-hero-team is-left">
              <span class="series-hero-team-logo">${teamLogo(a)}</span>
              <strong>${escapeHtml(a.name || 'Team 1')}</strong>
            </article>
            <span class="series-hero-versus">vs</span>
            <article class="series-hero-team is-right">
              <span class="series-hero-team-logo">${teamLogo(b)}</span>
              <strong>${escapeHtml(b.name || 'Team 2')}</strong>
            </article>
          </div>
        </div>
        <div class="series-hero-score is-final">
          <span>Final</span>
          <strong>${aScore ?? '—'}–${bScore ?? '—'}</strong>
          <small>${games.length} played game${games.length === 1 ? '' : 's'}</small>
        </div>
      </div>
      <div class="history-series-track series-hero-rail" data-series-length="${format}">
        <div class="history-game-nav series-hero-games" role="tablist" aria-label="Best of ${format} game navigation">
          ${Array.from({ length: format }, (_, index) => {
            const number = index + 1;
            const game = gameByNumber.get(number) || null;
            const id = String(game?.id || '');
            const selected = Boolean(id) && id === String(state.selectedGameId);
            const available = Boolean(id);
            const status = selected ? 'Selected' : available ? 'Open archive' : 'Not played';
            return `<button class="history-game-button series-hero-game ${available ? 'is-complete' : 'is-locked'} ${selected ? 'active is-selected' : ''}" ${available ? `data-history-game-id="${escapeHtml(id)}"` : ''} type="button" role="tab" aria-selected="${selected}" ${available ? '' : 'disabled aria-disabled="true"'}>
              <span>Game ${number}</span><small>${status}</small>
            </button>`;
          }).join('')}
        </div>
        <span class="history-archive-badge series-hero-badge is-archive" aria-label="Verified historical archive">${archiveIcon()}<span>Verified archive</span></span>
      </div>
      <div class="series-hero-context">
        <span class="series-hero-context-icon">${contextIcon()}</span>
        <strong>${escapeHtml(league)}</strong><i>•</i><span>Match history</span><i>•</i><span>Game ${selectedNumber}</span>
      </div>`;
    gameContent.insertBefore(summary, gameContent.firstChild);
  }

  globalThis.renderHistorySeriesSummary = renderSeriesNavigation;
  globalThis.RiftPulseSeriesHistory = { playedGames, seriesLength };

  loadFinishedMatch = async function allGameHistory(id) {
    gameContent.innerHTML = '<div class="empty hero-empty"><strong>Loading match history</strong><span>Finding every played game and its archived final frame…</span></div>';

    const payload = await api(`/api/match-details?matchId=${encodeURIComponent(id)}`);
    const event = payload.data?.event || payload.event || payload.data || payload;
    const games = playedGames(event);
    const finalGame = games[games.length - 1] || null;

    state.historyMatch = {
      matchId: String(id),
      event,
      games,
      finalGame
    };
    state.selectedMatchState = 'completed';

    if (!finalGame?.id) {
      state.selectedGameId = null;
      state.historyGameId = null;
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      jsonPreview.textContent = JSON.stringify({
        status: 'history_without_game_telemetry',
        matchId: String(id),
        event
      }, null, 2);
      gameContent.innerHTML = '<div class="empty hero-empty"><strong>Series result available</strong><span>No archived game IDs were returned for this match.</span></div>';
      renderSeriesNavigation();
      setConnection('History · game archive unavailable', '');
      return;
    }

    state.selectedGameId = String(finalGame.id);
    state.historyGameId = state.selectedGameId;
    setJsonEndpoint(state.selectedGameId, true);
    await loadGame();
    renderSeriesNavigation();
    setConnection(`History · Game ${finalGame.number || games.length} of ${games.length}`, '');
  };
})();