// Uses the private bookmaker bridge as a series-score fallback when Riot's schedule is stale.
(() => {
  'use strict';

  const POLL_MS = 3000;
  const ENDPOINT = `${WORKER_BASE}/api/odds/bridge/latest`;
  const STRIP_ID = 'bookmakerSeriesScore';
  let timer = null;
  let lastPayload = null;

  function normalize(value = '') {
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
      .map(normalize)
      .filter(Boolean);
    const full = normalize(team.name);
    if (full) {
      const initials = full.split(' ').map(token => token[0]).join('');
      if (initials.length >= 2) values.push(initials);
    }
    return [...new Set(values)];
  }

  function similarity(left = {}, right = {}) {
    const a = aliases(left);
    const b = aliases(right);
    for (const leftAlias of a) {
      for (const rightAlias of b) {
        if (leftAlias === rightAlias) return 1;
        if (leftAlias.length >= 3 && rightAlias.length >= 3 && (
          leftAlias.includes(rightAlias) || rightAlias.includes(leftAlias)
        )) return 0.88;
      }
    }
    return 0;
  }

  function scoreValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function selectedEvent() {
    return typeof selectedScheduleEvent === 'function' ? selectedScheduleEvent() : null;
  }

  function matchingBookmakerMatch(payload, event) {
    const eventPair = eventTeams(event);
    if (eventPair.length < 2) return null;
    let best = null;
    for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
      const home = match?.teams?.home || {};
      const away = match?.teams?.away || {};
      const direct = similarity(eventPair[0], home) + similarity(eventPair[1], away);
      const reverse = similarity(eventPair[0], away) + similarity(eventPair[1], home);
      const score = Math.max(direct, reverse);
      if (!best || score > best.score) best = { match, score, reversed: reverse > direct };
    }
    return best && best.score >= 1.35 ? best : null;
  }

  function targetWins(event) {
    const bestOf = Number(event?.match?.strategy?.count || state?.lastSnapshot?.match?.bestOf || 0);
    return Number.isFinite(bestOf) && bestOf > 0 ? Math.floor(bestOf / 2) + 1 : null;
  }

  function updateSnapshotSeries(event) {
    if (!state?.lastSnapshot) return;
    const eventPair = eventTeams(event);
    const seriesTeams = Array.isArray(state.lastSnapshot?.series?.teams)
      ? state.lastSnapshot.series.teams
      : eventPair.map(team => ({ id: team.id, name: team.name, code: team.code, image: team.image }));
    state.lastSnapshot.series = {
      ...(state.lastSnapshot.series || {}),
      teams: seriesTeams.map(seriesTeam => {
        const eventTeam = eventPair.find(team => similarity(seriesTeam, team) >= 0.8);
        return eventTeam
          ? { ...seriesTeam, wins: Number(eventTeam?.result?.gameWins || 0) }
          : seriesTeam;
      }),
      source: state.lastSnapshot?.series?.source || 'BK8 live series score'
    };
  }

  function applyScore(payload) {
    const event = selectedEvent();
    if (!event?.match?.teams?.length) {
      renderStrip(null);
      return;
    }

    const found = matchingBookmakerMatch(payload, event);
    if (!found) {
      renderStrip(event);
      return;
    }

    const providerHome = found.match?.teams?.home || {};
    const providerAway = found.match?.teams?.away || {};
    const homeScore = scoreValue(providerHome.score);
    const awayScore = scoreValue(providerAway.score);
    if (homeScore === null || awayScore === null || homeScore + awayScore <= 0) {
      renderStrip(event);
      return;
    }

    const bestOf = Number(event?.match?.strategy?.count || state?.lastSnapshot?.match?.bestOf || 0);
    const target = targetWins(event);
    if (target && Math.max(homeScore, awayScore) > target) return;
    if (Number.isFinite(bestOf) && bestOf > 0 && homeScore + awayScore > bestOf) return;

    const providerTeams = [providerHome, providerAway];
    const providerScores = [homeScore, awayScore];
    const mapped = event.match.teams.slice(0, 2).map(eventTeam => {
      const similarities = providerTeams.map(providerTeam => similarity(eventTeam, providerTeam));
      const index = similarities[1] > similarities[0] ? 1 : 0;
      return similarities[index] >= 0.65 ? { eventTeam, score: providerScores[index], index } : null;
    });
    if (mapped.some(item => !item) || mapped[0].index === mapped[1].index) return;

    const currentScores = mapped.map(item => scoreValue(item.eventTeam?.result?.gameWins) ?? 0);
    const providerTotal = mapped.reduce((sum, item) => sum + item.score, 0);
    const currentTotal = currentScores.reduce((sum, value) => sum + value, 0);
    const differs = mapped.some((item, index) => item.score !== currentScores[index]);

    // Never replace a more advanced Riot/community score with an older bookmaker snapshot.
    if (currentTotal > providerTotal) {
      renderStrip(event);
      return;
    }
    if (currentTotal === providerTotal && currentTotal > 0 && differs && event.scoreSource !== 'BK8 live series score') {
      renderStrip(event);
      return;
    }

    if (differs || event.scoreUnavailable) {
      for (const item of mapped) {
        item.eventTeam.result = { ...(item.eventTeam.result || {}), gameWins: item.score };
      }
      event.scoreSource = 'BK8 live series score';
      event.scoreUnavailable = false;
      if (target && Math.max(...mapped.map(item => item.score)) >= target) {
        event.state = 'completed';
        if (event.match) event.match.state = 'completed';
        state.liveMatchIds.delete(String(event?.match?.id || event?.id || ''));
      }
      updateSnapshotSeries(event);
      renderSchedule();
    }

    renderStrip(event);
  }

  function ensureStrip() {
    const gamePanel = gameContent?.parentElement;
    if (!gamePanel) return null;
    let strip = document.querySelector(`#${STRIP_ID}`);
    if (!strip) {
      strip = document.createElement('div');
      strip.id = STRIP_ID;
      strip.className = 'bookmaker-series-score';
    }
    if (strip.parentNode !== gamePanel) gamePanel.insertBefore(strip, gameContent);
    return strip;
  }

  function renderStrip(event) {
    const strip = ensureStrip();
    if (!strip) return;
    if (!event) {
      strip.hidden = true;
      return;
    }
    const teams = eventTeams(event).slice(0, 2);
    const scores = teams.map(team => scoreValue(team?.result?.gameWins));
    if (teams.length < 2 || scores.some(value => value === null) || scores[0] + scores[1] <= 0) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    strip.replaceChildren();
    const label = document.createElement('span');
    label.textContent = event.scoreSource || 'Series score';
    const score = document.createElement('strong');
    score.textContent = `${teams[0].code || teams[0].name} ${scores[0]} – ${scores[1]} ${teams[1].code || teams[1].name}`;
    strip.append(label, score);
  }

  async function refresh() {
    if (document.hidden) return;
    try {
      const response = await fetch(`${ENDPOINT}?_=${Date.now()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.status === 'ok') lastPayload = payload;
    } catch {
      // Retain and reuse the latest valid bridge snapshot.
    }
    if (lastPayload) applyScore(lastPayload);
    else renderStrip(selectedEvent());
  }

  const style = document.createElement('style');
  style.textContent = `
    .bookmaker-series-score{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 20px;border-bottom:1px solid var(--border);background:#7cf7c708;color:var(--muted);font-size:12px}
    .bookmaker-series-score strong{color:var(--text);font-size:14px}
    .bookmaker-series-score[hidden]{display:none}
    @media(max-width:760px){.bookmaker-series-score{align-items:flex-start;flex-direction:column;padding:10px 14px}}
  `;
  document.head.appendChild(style);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  setInterval(() => renderStrip(selectedEvent()), 1000);
  refresh();
  timer = setInterval(refresh, POLL_MS);
})();