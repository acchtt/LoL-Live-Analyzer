import workerV15 from './worker-v1.5.js';

const STALE_TELEMETRY_SECONDS = 90;

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dataAgeSeconds(snapshot) {
  const reported = Number(snapshot?.source?.dataAgeSeconds);
  if (Number.isFinite(reported) && reported >= 0) return reported;
  const frameMs = parseTimestamp(snapshot?.source?.frameTimestamp);
  return frameMs === null ? null : Math.max(0, Math.round((Date.now() - frameMs) / 1000));
}

function staleSnapshot(snapshot) {
  if (!snapshot || snapshot.status !== 'ok') return true;
  const age = dataAgeSeconds(snapshot);
  return snapshot?.match?.state === 'stale_frame'
    || snapshot?.source?.telemetryAdvancing === false
    || (age !== null && age >= STALE_TELEMETRY_SECONDS);
}

function jsonResponse(data, original, extraHeaders = {}) {
  const headers = new Headers(original.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Worker-Version', '1.6');
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(data, null, 2), {
    status: original.status,
    statusText: original.statusText,
    headers
  });
}

function markTelemetryStale(snapshot) {
  const age = dataAgeSeconds(snapshot);
  return {
    ...snapshot,
    schemaVersion: '1.6',
    match: { ...(snapshot.match || {}), state: 'stale_frame' },
    source: {
      ...(snapshot.source || {}),
      live: false,
      telemetryAdvancing: false,
      staleFinalFrame: true,
      dataAgeSeconds: age
    },
    message: 'The last Riot frame is no longer advancing. Treat this game as ended and resolve the next game in the series.'
  };
}

async function snapshotForSelectedGame(requestUrl, gameId, env, ctx) {
  const url = new URL('/api/chatgpt', requestUrl.origin);
  url.searchParams.set('gameId', String(gameId));
  const request = new Request(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  const response = await workerV15.fetch(request, env, ctx);
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await workerV15.fetch(request, env, ctx);

    if (url.pathname === '/' || url.pathname === '/health') {
      const payload = await response.clone().json().catch(() => null);
      return payload ? jsonResponse({ ...payload, version: '1.6' }, response) : response;
    }

    if (!response.ok) return response;

    if (url.pathname === '/api/chatgpt') {
      const snapshot = await response.clone().json().catch(() => null);
      if (!snapshot) return response;
      const historical = url.searchParams.get('historical') === '1';
      const normalized = !historical && staleSnapshot(snapshot)
        ? markTelemetryStale(snapshot)
        : { ...snapshot, schemaVersion: '1.6' };
      return jsonResponse(normalized, response, {
        'X-Telemetry-State': normalized?.match?.state === 'stale_frame' ? 'stale' : 'advancing'
      });
    }

    if (url.pathname === '/api/resolve-game') {
      const resolution = await response.clone().json().catch(() => null);
      if (!resolution?.selectedGame?.id) return resolution ? jsonResponse(resolution, response) : response;

      const selectedId = String(resolution.selectedGame.id);
      const snapshot = await snapshotForSelectedGame(url, selectedId, env, ctx);
      if (!snapshot || staleSnapshot(snapshot)) {
        const age = snapshot ? dataAgeSeconds(snapshot) : null;
        const corrected = {
          ...resolution,
          selectedGame: null,
          selectedPhase: 'between_games_stale_frame',
          telemetryAvailable: false,
          diagnostics: {
            ...(resolution.diagnostics || {}),
            staleSelectedGame: {
              gameId: selectedId,
              dataAgeSeconds: age,
              reason: snapshot ? 'Riot telemetry stopped advancing' : 'No usable telemetry snapshot'
            }
          }
        };
        return jsonResponse(corrected, response, { 'X-Telemetry-State': 'between-games' });
      }

      return jsonResponse(resolution, response, { 'X-Telemetry-State': 'advancing' });
    }

    return response;
  }
};
