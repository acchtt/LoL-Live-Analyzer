// Champion portraits and a continuously ticking in-game clock.
(() => {
  const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';
  const championCatalog = new Map();
  const vodAnchorPromises = new Map();
  const observedAnchors = new Map();

  let dataDragonVersion = null;
  let catalogReady = false;
  let clockTimer = null;
  let clockToken = 0;

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeChampionKey(value = '') {
    return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  async function loadChampionCatalog() {
    try {
      const versionsResponse = await fetch(`${DDRAGON_BASE}/api/versions.json`, { cache: 'force-cache' });
      if (!versionsResponse.ok) throw new Error(`Data Dragon versions returned ${versionsResponse.status}`);

      const versions = await versionsResponse.json();
      dataDragonVersion = Array.isArray(versions) ? versions[0] : null;
      if (!dataDragonVersion) throw new Error('Data Dragon returned no versions');

      const catalogResponse = await fetch(
        `${DDRAGON_BASE}/cdn/${encodeURIComponent(dataDragonVersion)}/data/en_US/champion.json`,
        { cache: 'force-cache' }
      );
      if (!catalogResponse.ok) throw new Error(`Data Dragon champion catalog returned ${catalogResponse.status}`);

      const payload = await catalogResponse.json();
      for (const champion of Object.values(payload?.data || {})) {
        const entry = {
          id: champion.id,
          name: champion.name,
          image: champion.image?.full || `${champion.id}.png`
        };
        championCatalog.set(normalizeChampionKey(champion.id), entry);
        championCatalog.set(normalizeChampionKey(champion.name), entry);
        championCatalog.set(String(champion.key || ''), entry);
      }

      catalogReady = championCatalog.size > 0;
      if (state.lastSnapshot) renderGame(state.lastSnapshot);
    } catch (error) {
      console.warn('Champion portrait catalog unavailable:', error);
    }
  }

  function championAsset(championValue) {
    if (!championValue || !dataDragonVersion) return null;

    const raw = String(championValue);
    const entry = championCatalog.get(normalizeChampionKey(raw)) || championCatalog.get(raw);
    const image = entry?.image || `${raw}.png`;
    return {
      name: entry?.name || raw,
      url: `${DDRAGON_BASE}/cdn/${encodeURIComponent(dataDragonVersion)}/img/champion/${encodeURIComponent(image)}`
    };
  }

  function playerIdentity(player) {
    const champion = championAsset(player?.champion);
    const championName = champion?.name || player?.champion || 'Unknown champion';
    const fallback = championName.slice(0, 1).toUpperCase() || '?';
    const role = player?.role ? ` · ${player.role}` : '';

    return `<span class="player-identity">
      <span class="champion-portrait" aria-hidden="true">
        ${champion?.url
          ? `<img src="${escapeHtml(champion.url)}" alt="" loading="lazy"><span>${escapeHtml(fallback)}</span>`
          : `<span>${escapeHtml(fallback)}</span>`}
      </span>
      <span class="player-copy">
        <strong>${escapeHtml(player?.name || `Player ${player?.participantId || ''}`)}</strong>
        <small>${escapeHtml(championName)}${escapeHtml(role)}</small>
      </span>
    </span>`;
  }

  playerRows = function enhancedPlayerRows(players = []) {
    if (!players.length) return '<div class="empty">Player details unavailable.</div>';

    return players.map(player => `<div class="player-row enhanced-player-row">
      ${playerIdentity(player)}
      <span class="player-kda">${Number(player?.kills || 0)}/${Number(player?.deaths || 0)}/${Number(player?.assists || 0)}</span>
      <span class="player-cs">${Number(player?.creepScore || 0)} CS</span>
    </div>`).join('');
  };

  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.champion-portrait')) return;
    image.hidden = true;
    image.closest('.champion-portrait')?.classList.add('image-failed');
  }, true);

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
    const secs = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function validTimestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function gameIdFrom(snapshot) {
    return String(snapshot?.source?.gameId || state.selectedGameId || '');
  }

  function stopClock() {
    clearInterval(clockTimer);
    clockTimer = null;
    clockToken += 1;
  }

  function startClock(secondsAtReference, referenceMs, estimated = false, historical = false) {
    const element = document.querySelector('.clock');
    if (!element || secondsAtReference === null || !Number.isFinite(secondsAtReference)) return;

    stopClock();
    const token = clockToken;
    element.classList.toggle('estimated-clock', estimated);
    element.title = estimated
      ? 'Estimated from the first telemetry frame observed by this dashboard.'
      : historical
        ? 'Final recorded in-game time.'
        : 'Live in-game time, synchronized to the latest Riot telemetry frame.';

    const paint = () => {
      if (token !== clockToken || !element.isConnected) return;
      const advance = historical ? 0 : Math.max(0, (Date.now() - referenceMs) / 1000);
      element.textContent = `${estimated ? '~' : ''}${formatClock(secondsAtReference + advance)}`;
    };

    paint();
    if (!historical) clockTimer = setInterval(paint, 1000);
  }

  async function vodGameAnchor(snapshot) {
    const matchId = String(snapshot?.source?.matchId || '');
    const gameId = gameIdFrom(snapshot);
    if (!matchId || !gameId) return null;

    const cacheKey = `${matchId}:${gameId}`;
    if (vodAnchorPromises.has(cacheKey)) return vodAnchorPromises.get(cacheKey);

    const promise = (async () => {
      try {
        const payload = await api(`/api/match-details?matchId=${encodeURIComponent(matchId)}`);
        const event = payload?.data?.event || payload?.event || payload?.data || payload;
        const game = (event?.match?.games || []).find(item => String(item?.id) === gameId);
        const vod = (game?.vods || []).find(item => {
          return validTimestamp(item?.firstFrameTime) !== null && Number.isFinite(Number(item?.startMillis));
        });
        if (!vod) return null;

        return validTimestamp(vod.firstFrameTime) + Number(vod.startMillis);
      } catch {
        return null;
      }
    })();

    vodAnchorPromises.set(cacheKey, promise);
    return promise;
  }

  async function configureClock(snapshot) {
    const gameId = gameIdFrom(snapshot);
    const frameMs = validTimestamp(snapshot?.source?.frameTimestamp) ?? validTimestamp(snapshot?.updatedAt) ?? Date.now();
    const historical = state.selectedMatchState === 'completed' || snapshot?.match?.state === 'finished';
    const nativeSeconds = Number.isFinite(Number(snapshot?.clockSeconds))
      ? Number(snapshot.clockSeconds)
      : parseClock(snapshot?.clock);

    if (nativeSeconds !== null) {
      startClock(nativeSeconds, frameMs, false, historical);
      return;
    }

    const anchor = await vodGameAnchor(snapshot);
    if (anchor !== null) {
      const elapsed = Math.max(0, (frameMs - anchor) / 1000);
      startClock(elapsed, frameMs, false, historical);
      return;
    }

    if (!gameId) return;
    if (!observedAnchors.has(gameId)) observedAnchors.set(gameId, frameMs);
    const elapsed = Math.max(0, (frameMs - observedAnchors.get(gameId)) / 1000);
    startClock(elapsed, frameMs, true, historical);
  }

  const baseRenderGame = renderGame;
  renderGame = function enhancedRenderGame(snapshot) {
    baseRenderGame(snapshot);
    configureClock(snapshot);
  };

  const baseShowUpcoming = showUpcoming;
  showUpcoming = function enhancedShowUpcoming(event) {
    stopClock();
    baseShowUpcoming(event);
  };

  const baseShowWaiting = showWaiting;
  showWaiting = function enhancedShowWaiting(event, resolution = {}) {
    stopClock();
    baseShowWaiting(event, resolution);
  };

  loadChampionCatalog();
})();
