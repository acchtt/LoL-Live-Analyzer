// Converts the two independent lineup tables into one mirrored role-by-role comparison board.
(() => {
  'use strict';

  const root = document.getElementById('gameContent');
  if (!root) return;

  const ROLE_ORDER = ['top', 'jungle', 'mid', 'bottom', 'support'];
  const ROLE_LABELS = {
    top: 'Top',
    jungle: 'Jungle',
    mid: 'Mid',
    bottom: 'Bottom',
    support: 'Support'
  };
  const ROLE_MARKS = {
    top: 'TOP',
    jungle: 'JGL',
    mid: 'MID',
    bottom: 'BOT',
    support: 'SUP'
  };

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

  function normalizeRole(value = '', fallbackIndex = 0) {
    const role = String(value).trim().toLowerCase().replace(/[^a-z]/g, '');
    if (['top', 'toplevel'].includes(role)) return 'top';
    if (['jungle', 'jungler', 'jg'].includes(role)) return 'jungle';
    if (['mid', 'middle', 'midlane'].includes(role)) return 'mid';
    if (['bottom', 'bot', 'adc', 'carry', 'botlane'].includes(role)) return 'bottom';
    if (['support', 'sup'].includes(role)) return 'support';
    return ROLE_ORDER[Math.max(0, Math.min(ROLE_ORDER.length - 1, fallbackIndex))];
  }

  function roleFromRow(row, index) {
    const subtitle = row?.querySelector('.player-copy small')?.textContent || '';
    const parts = subtitle.split('·').map(part => part.trim()).filter(Boolean);
    return normalizeRole(parts.at(-1) || '', index);
  }

  function mapRows(rows = []) {
    const mapped = new Map();
    rows.forEach((row, index) => {
      let role = roleFromRow(row, index);
      if (mapped.has(role)) role = ROLE_ORDER.find(candidate => !mapped.has(candidate)) || role;
      mapped.set(role, row);
    });
    return mapped;
  }

  function mapPlayers(players = []) {
    const mapped = new Map();
    players.forEach((player, index) => {
      let role = normalizeRole(player?.role, index);
      if (mapped.has(role)) role = ROLE_ORDER.find(candidate => !mapped.has(candidate)) || role;
      mapped.set(role, player);
    });
    return mapped;
  }

  function emptyItems() {
    const items = document.createElement('span');
    items.className = 'player-items';
    items.setAttribute('aria-label', 'Player items unavailable');
    items.innerHTML = Array.from({ length: 6 }, () => '<span class="player-item-empty" aria-hidden="true"></span>').join('');
    return items;
  }

  function clonedItems(row, side) {
    const items = row?.querySelector('.player-items')?.cloneNode(true) || emptyItems();
    items.classList.add('comparison-items', `is-${side}`);
    return items;
  }

  function emptyIdentity(side) {
    const identity = document.createElement('span');
    identity.className = `player-identity comparison-identity is-${side} is-missing`;
    identity.innerHTML = '<span class="champion-portrait"><span>?</span></span><span class="player-copy"><strong>Player unavailable</strong><small>Telemetry missing</small></span>';
    return identity;
  }

  function clonedIdentity(row, player, side) {
    const identity = row?.querySelector('.player-identity')?.cloneNode(true) || emptyIdentity(side);
    identity.classList.add('comparison-identity', `is-${side}`);

    const level = finiteNumber(player?.level);
    const portrait = identity.querySelector('.champion-portrait');
    if (portrait && level !== null) {
      const badge = document.createElement('span');
      badge.className = 'champion-level';
      badge.textContent = String(Math.round(level));
      badge.setAttribute('aria-label', `Level ${Math.round(level)}`);
      portrait.appendChild(badge);
    }
    return identity;
  }

  function statText(row, selector) {
    return row?.querySelector(selector)?.textContent?.trim() || '—';
  }

  function statBlock(row, side) {
    const stats = document.createElement('div');
    stats.className = `player-comparison-stats is-${side}`;
    stats.innerHTML = `
      <strong class="comparison-kda">${escapeHtml(statText(row, '.player-kda'))}</strong>
      <span><b>CS</b>${escapeHtml(statText(row, '.player-cs'))}</span>
      <span><b>Gold</b>${escapeHtml(statText(row, '.player-gold'))}</span>`;
    return stats;
  }

  function roleCell(role) {
    const cell = document.createElement('div');
    cell.className = 'player-comparison-role';
    cell.innerHTML = `<span aria-hidden="true">${ROLE_MARKS[role]}</span><strong>${ROLE_LABELS[role]}</strong>`;
    return cell;
  }

  function comparisonRow(role, blueRow, redRow, bluePlayer, redPlayer) {
    const row = document.createElement('article');
    row.className = 'player-comparison-row';
    row.dataset.role = role;

    const blueItems = clonedItems(blueRow, 'blue');
    blueItems.classList.add('blue-items');
    const blueStats = statBlock(blueRow, 'blue');
    blueStats.classList.add('blue-stats');
    const blueIdentity = clonedIdentity(blueRow, bluePlayer, 'blue');
    blueIdentity.classList.add('blue-identity');

    const redIdentity = clonedIdentity(redRow, redPlayer, 'red');
    redIdentity.classList.add('red-identity');
    const redStats = statBlock(redRow, 'red');
    redStats.classList.add('red-stats');
    const redItems = clonedItems(redRow, 'red');
    redItems.classList.add('red-items');

    row.append(
      blueItems,
      blueStats,
      blueIdentity,
      roleCell(role),
      redIdentity,
      redStats,
      redItems
    );
    return row;
  }

  function lineupTeamName(lineup, fallback) {
    return lineup?.querySelector('header strong')?.textContent?.trim() || fallback;
  }

  function enhanceLineups(lineups) {
    if (!(lineups instanceof HTMLElement) || lineups.dataset.playerComparison === 'true') return;

    const teams = [...lineups.querySelectorAll(':scope > .analysis-v2-lineup')];
    if (teams.length < 2) return;

    const blueLineup = teams[0];
    const redLineup = teams[1];
    const blueRows = mapRows([...blueLineup.querySelectorAll('.player-column > .player-row')]);
    const redRows = mapRows([...redLineup.querySelectorAll('.player-column > .player-row')]);
    const snapshot = state.lastSnapshot || {};
    const bluePlayers = mapPlayers(snapshot?.blue?.players || []);
    const redPlayers = mapPlayers(snapshot?.red?.players || []);
    const blueName = lineupTeamName(blueLineup, snapshot?.blue?.name || 'Blue side');
    const redName = lineupTeamName(redLineup, snapshot?.red?.name || 'Red side');

    const board = document.createElement('section');
    board.className = 'analysis-v2-lineups players player-comparison-board';
    board.dataset.playerComparison = 'true';
    board.setAttribute('aria-label', `${blueName} and ${redName} player comparison`);
    board.innerHTML = `
      <header class="player-comparison-header">
        <div>
          <span>Player comparison</span>
          <h3>Overall statistics</h3>
        </div>
        <div class="player-comparison-legend" aria-label="Team colors">
          <span class="is-blue"><i></i>${escapeHtml(blueName)}</span>
          <span class="is-red"><i></i>${escapeHtml(redName)}</span>
        </div>
      </header>
      <div class="player-comparison-table"></div>`;

    const table = board.querySelector('.player-comparison-table');
    ROLE_ORDER.forEach(role => {
      table.appendChild(comparisonRow(
        role,
        blueRows.get(role),
        redRows.get(role),
        bluePlayers.get(role),
        redPlayers.get(role)
      ));
    });

    lineups.replaceWith(board);
  }

  function enhanceAll() {
    root.querySelectorAll('.analysis-v2-lineups:not([data-player-comparison="true"])').forEach(enhanceLineups);
  }

  const observer = new MutationObserver(enhanceAll);
  observer.observe(root, { childList: true, subtree: true });
  queueMicrotask(enhanceAll);
})();