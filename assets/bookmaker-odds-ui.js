// Live bookmaker odds panel for the selected Riot match.
(() => {
  'use strict';

  const POLL_MS = 3000;
  const MAX_VISIBLE_MARKETS = 12;
  const PANEL_ID = 'bookmakerOddsPanel';
  const ENDPOINT = `${WORKER_BASE}/api/odds/bridge/latest`;

  let latestPayload = null;
  let latestError = '';
  let pollTimer = null;
  let expanded = false;
  let lastSelectedEventId = null;

  const MARKET_LABELS = {
    LiveBall: game => `Game ${game || ''} winner`.replace(/\s+/g, ' ').trim(),
    GameWin: game => `Game ${game || ''} winner`.replace(/\s+/g, ' ').trim(),
    LBSeriesWin: () => 'Series winner',
    LBOuKill: game => `Game ${game || ''} total kills`.replace(/\s+/g, ' ').trim(),
    OuKill: game => `Game ${game || ''} total kills`.replace(/\s+/g, ' ').trim(),
    LBOuHdpKillB: game => `Game ${game || ''} kill handicap`.replace(/\s+/g, ' ').trim(),
    OuHdpKill: game => `Game ${game || ''} kill handicap`.replace(/\s+/g, ' ').trim(),
    LBOuTime: game => `Game ${game || ''} duration`.replace(/\s+/g, ' ').trim(),
    OuTime: game => `Game ${game || ''} duration`.replace(/\s+/g, ' ').trim(),
    FB: game => `Game ${game || ''} first blood`.replace(/\s+/g, ' ').trim(),
    FT: game => `Game ${game || ''} first tower`.replace(/\s+/g, ' ').trim(),
    FD: game => `Game ${game || ''} first dragon`.replace(/\s+/g, ' ').trim(),
    F5K: game => `Game ${game || ''} first 5 kills`.replace(/\s+/g, ' ').trim(),
    F10K: game => `Game ${game || ''} first 10 kills`.replace(/\s+/g, ' ').trim(),
    F15K: game => `Game ${game || ''} first 15 kills`.replace(/\s+/g, ' ').trim(),
    FirstHerald: game => `Game ${game || ''} first Herald`.replace(/\s+/g, ' ').trim(),
    FirstBaron: game => `Game ${game || ''} first Baron`.replace(/\s+/g, ' ').trim(),
    FirstInhibitor: game => `Game ${game || ''} first inhibitor`.replace(/\s+/g, ' ').trim()
  };

  const MARKET_PRIORITY = [
    'LiveBall', 'GameWin', 'LBSeriesWin', 'LBOuKill', 'OuKill',
    'LBOuHdpKillB', 'OuHdpKill', 'LBOuTime', 'OuTime',
    'FB', 'FT', 'FD', 'F5K', 'F10K', 'F15K',
    'FirstHerald', 'FirstBaron', 'FirstInhibitor'
  ];

  function normalizeName(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\b(esports?|e-sports?|gaming|team|club|organization)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function aliases(team = {}) {
    const values = [team.name, team.code, team.acronym, team.slug]
      .map(normalizeName)
      .filter(Boolean);
    const full = normalizeName(team.name);
    if (full) {
      const initials = full.split(' ').map(token => token[0]).join('');
      if (initials.length >= 2) values.push(initials);
    }
    return [...new Set(values)];
  }

  function teamSimilarity(left = {}, right = {}) {
    const leftAliases = aliases(left);
    const rightAliases = aliases(right);
    if (!leftAliases.length || !rightAliases.length) return 0;

    for (const a of leftAliases) {
      for (const b of rightAliases) {
        if (a === b) return 1;
        if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return 0.88;
      }
    }

    const leftTokens = new Set(normalizeName(left.name).split(' ').filter(Boolean));
    const rightTokens = new Set(normalizeName(right.name).split(' ').filter(Boolean));
    if (!leftTokens.size || !rightTokens.size) return 0;
    const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    return union ? overlap / union : 0;
  }

  function candidateMatches(payload) {
    if (Array.isArray(payload?.matches)) return payload.matches;
    if (payload?.match) return [payload.match];
    return [];
  }

  function selectedTeams() {
    const event = typeof selectedScheduleEvent === 'function' ? selectedScheduleEvent() : null;
    if (event) return eventTeams(event);
    const snapshot = state?.lastSnapshot || {};
    return [snapshot.blue || {}, snapshot.red || {}];
  }

  function findBookmakerMatch(payload) {
    const [first, second] = selectedTeams();
    if (!first?.name || !second?.name) return null;

    let best = null;
    for (const match of candidateMatches(payload)) {
      const home = match?.teams?.home || {};
      const away = match?.teams?.away || {};
      const direct = teamSimilarity(first, home) + teamSimilarity(second, away);
      const reverse = teamSimilarity(first, away) + teamSimilarity(second, home);
      const score = Math.max(direct, reverse);
      if (!best || score > best.score) best = { match, score, reversed: reverse > direct };
    }

    return best && best.score >= 1.35 ? best : null;
  }

  function currentGameNumber() {
    const number = Number(state?.lastSnapshot?.match?.gameNumber);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function marketLabel(market = {}) {
    const factory = MARKET_LABELS[market.code];
    if (factory) return factory(market.gameOrder);
    return market.name || market.code || 'Market';
  }

  function marketRank(market, gameNumber) {
    const currentGame = gameNumber && Number(market.gameOrder) === gameNumber ? 0 : 1;
    const series = Number(market.gameOrder) === 0 ? 0 : 1;
    const live = market.live ? 0 : 1;
    const available = market.available ? 0 : 1;
    const codeRank = MARKET_PRIORITY.indexOf(market.code);
    return [available, currentGame, live, series, codeRank === -1 ? 999 : codeRank, Number(market.gameOrder) || 0];
  }

  function compareRank(left, right, gameNumber) {
    const a = marketRank(left, gameNumber);
    const b = marketRank(right, gameNumber);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return marketLabel(left).localeCompare(marketLabel(right));
  }

  function formatAge(seconds) {
    if (!Number.isFinite(Number(seconds))) return 'just now';
    const value = Math.max(0, Math.round(Number(seconds)));
    if (value < 60) return `${value}s ago`;
    return `${Math.floor(value / 60)}m ago`;
  }

  function displaySelection(selection = {}, line = {}) {
    const handicap = Number.isFinite(Number(line.handicap)) ? Number(line.handicap) : null;
    if (selection.side === 'over') return handicap === null ? 'Over' : `Over ${handicap}`;
    if (selection.side === 'under') return handicap === null ? 'Under' : `Under ${handicap}`;
    return selection.name || 'Selection';
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createStatus(status, kind = '') {
    return createElement('span', `bookmaker-odds-status ${kind}`.trim(), status);
  }

  function createMarketCard(market) {
    const card = createElement('article', 'bookmaker-market');
    if (!market.available) card.classList.add('suspended');

    const header = createElement('div', 'bookmaker-market-header');
    header.append(createElement('h4', '', marketLabel(market)));
    header.append(createStatus(market.live ? 'LIVE' : (market.available ? 'OPEN' : 'SUSPENDED'), market.live ? 'live' : (market.available ? '' : 'stale')));
    card.append(header);

    const lines = createElement('div', 'bookmaker-market-lines');
    for (const line of Array.isArray(market.lines) ? market.lines : []) {
      const row = createElement('div', 'bookmaker-line');
      for (const selection of Array.isArray(line.selections) ? line.selections : []) {
        const item = createElement('div', 'bookmaker-selection');
        item.append(createElement('span', 'bookmaker-selection-name', displaySelection(selection, line)));
        item.append(createElement('strong', 'bookmaker-selection-price', Number(selection.odds).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')));
        if (selection.locked) item.classList.add('locked');
        row.append(item);
      }
      if (row.children.length) lines.append(row);
    }
    card.append(lines);
    return card;
  }

  function ensurePanel() {
  const host = gameContent?.parentElement || gameContent;
  if (!host) return null;

  let panel = document.querySelector(`#${PANEL_ID}`);
  if (!panel) {
    panel = createElement('section', 'bookmaker-odds');
    panel.id = PANEL_ID;
  }
  if (panel.parentNode !== host) host.append(panel);
  return panel;
}

function renderPanel() {
    if (!state?.selectedEventId) {
      document.querySelector(`#${PANEL_ID}`)?.remove();
      return;
    }

    if (lastSelectedEventId !== state.selectedEventId) {
      expanded = false;
      lastSelectedEventId = state.selectedEventId;
    }

    const panel = ensurePanel();
    panel.replaceChildren();

    const header = createElement('div', 'bookmaker-odds-header');
    const titleWrap = createElement('div');
    titleWrap.append(createElement('p', 'eyebrow', 'Private bookmaker bridge'));
    titleWrap.append(createElement('h3', '', 'Live odds'));
    header.append(titleWrap);

    if (latestPayload?.status === 'ok') {
      const freshness = latestPayload.stale ? 'stale' : 'live';
      header.append(createStatus(`${latestPayload.stale ? 'STALE' : 'LIVE'} · ${formatAge(latestPayload.ageSeconds)}`, freshness));
    } else {
      header.append(createStatus(latestError ? 'ERROR' : 'WAITING', latestError ? 'stale' : ''));
    }
    panel.append(header);

    if (latestError) {
      panel.append(createElement('div', 'bookmaker-odds-message', latestError));
      return;
    }

    if (!latestPayload || latestPayload.status !== 'ok') {
      panel.append(createElement('div', 'bookmaker-odds-message', latestPayload?.message || 'Open the bookmaker match with the odds bridge enabled.'));
      return;
    }

    const found = findBookmakerMatch(latestPayload);
    if (!found) {
      panel.append(createElement('div', 'bookmaker-odds-message', 'The bridge is live, but its bookmaker match does not match the selected Riot match. Open the same match in eSportsBull.'));
      return;
    }

    const match = found.match;
    const home = match?.teams?.home || {};
    const away = match?.teams?.away || {};
    const matchMeta = createElement('div', 'bookmaker-match-meta');
    matchMeta.append(
      createElement('strong', '', `${home.code || home.name} vs ${away.code || away.name}`),
      createElement('span', '', `${match.league || 'League of Legends'} · ${match.matchType || 'Match'} · ID ${match.providerMatchId}`)
    );
    panel.append(matchMeta);

    const gameNumber = currentGameNumber();
    const markets = (Array.isArray(match.markets) ? match.markets : [])
      .filter(market => Array.isArray(market.lines) && market.lines.some(line => Array.isArray(line.selections) && line.selections.length))
      .sort((a, b) => compareRank(a, b, gameNumber));

    const preferred = gameNumber
      ? markets.filter(market => Number(market.gameOrder) === gameNumber || Number(market.gameOrder) === 0 || market.live)
      : markets.filter(market => market.live || Number(market.gameOrder) === 0);
    const source = preferred.length ? preferred : markets;
    const shown = expanded ? markets : source.slice(0, MAX_VISIBLE_MARKETS);

    if (!shown.length) {
      panel.append(createElement('div', 'bookmaker-odds-message', 'No active markets are available for this match.'));
      return;
    }

    const grid = createElement('div', 'bookmaker-market-grid');
    shown.forEach(market => grid.append(createMarketCard(market)));
    panel.append(grid);

    if (markets.length > shown.length || expanded) {
      const toggle = createElement('button', 'ghost-button bookmaker-show-all', expanded ? 'Show key markets' : `Show all ${markets.length} markets`);
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        expanded = !expanded;
        renderPanel();
      });
      panel.append(toggle);
    }

    panel.append(createElement('p', 'bookmaker-odds-note', `Source: ${latestPayload.provider || 'BK8 / IME eSportsBull'} via your private browser bridge. Keep the bookmaker tab open for live updates.`));
  }

  async function loadOdds() {
    try {
      const response = await fetch(`${ENDPOINT}?_=${Date.now()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      latestPayload = payload;
      latestError = response.ok || response.status === 404
        ? ''
        : (payload.error || `Odds request failed (${response.status})`);
    } catch {
      latestError = 'Could not reach the private odds bridge.';
    }
    renderPanel();
  }

  function startOddsPolling() {
    clearInterval(pollTimer);
    loadOdds();
    pollTimer = setInterval(() => {
      if (!document.hidden) loadOdds();
    }, POLL_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadOdds();
  });

  setInterval(renderPanel, 1000);
  startOddsPolling();
})();
