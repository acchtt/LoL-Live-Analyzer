import workerV14 from './worker-v1.4.js';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const DEFAULT_LOCALE = 'en-US';
const MAX_REASONABLE_GAME_SECONDS = 6 * 60 * 60;

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

async function getGameRecord(gameId, env) {
  const key = env.LOL_ESPORTS_API_KEY;
  if (!key) return null;

  const url = new URL(`${PERSISTED_BASE}/getGames`);
  url.searchParams.set('hl', DEFAULT_LOCALE);
  url.searchParams.append('id', String(gameId));

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'x-api-key': key },
    cache: 'no-store'
  });
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  const games = payload?.data?.games || payload?.games || [];
  return games.find(game => String(game?.id) === String(gameId)) || games[0] || null;
}

function firstFrameAnchor(game) {
  const anchors = (game?.vods || [])
    .map(vod => parseTimestamp(vod?.firstFrameTime))
    .filter(value => value !== null)
    .sort((a, b) => a - b);
  return anchors[0] ?? null;
}

async function correctSnapshotClock(snapshot, gameId, env) {
  if (!snapshot || snapshot.status !== 'ok') return snapshot;

  const frameMs = parseTimestamp(snapshot?.source?.frameTimestamp);
  if (frameMs === null) return snapshot;

  const game = await getGameRecord(gameId, env).catch(() => null);
  const anchorMs = firstFrameAnchor(game);
  if (anchorMs === null || frameMs < anchorMs) return snapshot;

  const seconds = Math.round((frameMs - anchorMs) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_REASONABLE_GAME_SECONDS) return snapshot;

  return {
    ...snapshot,
    schemaVersion: '1.5',
    clockSeconds: seconds,
    clock: formatClock(seconds),
    source: {
      ...(snapshot.source || {}),
      clockSource: 'Riot VOD firstFrameTime',
      clockAnchorTime: new Date(anchorMs).toISOString(),
      clockCorrected: true
    }
  };
}

function jsonResponse(data, original) {
  const headers = new Headers(original.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Timer-Version', '1.5');
  return new Response(JSON.stringify(data, null, 2), {
    status: original.status,
    statusText: original.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await workerV14.fetch(request, env, ctx);

    if (url.pathname === '/' || url.pathname === '/health') {
      const payload = await response.clone().json().catch(() => null);
      return payload ? jsonResponse({ ...payload, version: '1.5' }, response) : response;
    }

    if (url.pathname !== '/api/chatgpt' || !response.ok) return response;

    const snapshot = await response.clone().json().catch(() => null);
    if (!snapshot) return response;

    const gameId = url.searchParams.get('gameId');
    if (!gameId) return response;

    const corrected = await correctSnapshotClock(snapshot, gameId, env);
    return jsonResponse(corrected, response);
  }
};
