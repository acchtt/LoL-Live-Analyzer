import workerV23 from './worker-v2.3.js';
import reliableCore from './worker-reliable-core.js';

const WORKER_VERSION = '2.4';
const GAME_ID_PATTERN = /^\d{8,}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function parseFeedPath(pathname) {
  const match = pathname.match(/^\/(?:api\/chatgpt|feed)\/(\d+)(?:\/([A-Za-z0-9_-]+))?\/?$/);
  if (!match) return null;
  return { gameId: match[1], token: match[2] || null };
}

function strictLiveRequest(request, incomingUrl, gameId) {
  const target = new URL('/api/chatgpt', incomingUrl.origin);
  target.searchParams.set('gameId', gameId);
  const after = incomingUrl.searchParams.get('after');
  if (after) target.searchParams.set('after', after);
  return new Request(target.toString(), {
    method: 'GET',
    headers: request.headers
  });
}

function versionedHeaders(original, extra = {}) {
  const headers = new Headers(original.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  headers.set('X-Worker-Version', WORKER_VERSION);
  headers.set('X-RiftPulse-Reliability', 'strict-live');
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

async function decorateLiveResponse(response, incomingUrl, parsedPath) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: versionedHeaders(response)
    });
  }

  const gameId = parsedPath?.gameId || incomingUrl.searchParams.get('gameId');
  const normalized = {
    ...payload,
    schemaVersion: WORKER_VERSION,
    request: {
      ...(payload.request || {}),
      gameId: gameId || null,
      freshToken: parsedPath?.token || null,
      format: parsedPath ? 'rotating-path' : 'query',
      reliabilityPolicy: 'strict-live-v2.4'
    }
  };

  return new Response(JSON.stringify(normalized, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers: versionedHeaders(response, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Feed-Format': parsedPath ? 'rotating-path' : 'query'
    })
  });
}

async function healthResponse(request, env, ctx) {
  const response = await workerV23.fetch(request, env, ctx);
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;
  return new Response(JSON.stringify({
    ...payload,
    version: WORKER_VERSION,
    liveTelemetryReliability: {
      policy: 'strict-live-v2.4',
      freshFrameSeconds: 30,
      degradedFrameSeconds: 90,
      futureTimestampToleranceSeconds: 15,
      maximumWindowRequestsPerSnapshot: 3,
      missingValuesPreservedAsNull: true
    }
  }, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers: versionedHeaders(response, { 'Content-Type': 'application/json; charset=utf-8' })
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return workerV23.fetch(request, env, ctx);

    const incomingUrl = new URL(request.url);
    const parsedPath = parseFeedPath(incomingUrl.pathname);
    const historical = incomingUrl.searchParams.get('historical') === '1';

    if (parsedPath && (!GAME_ID_PATTERN.test(parsedPath.gameId) || (parsedPath.token && !TOKEN_PATTERN.test(parsedPath.token)))) {
      return new Response(JSON.stringify({ error: 'Invalid feed path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Worker-Version': WORKER_VERSION }
      });
    }

    if (incomingUrl.pathname === '/' || incomingUrl.pathname === '/health') {
      return healthResponse(request, env, ctx);
    }

    if (!historical && parsedPath) {
      const response = await reliableCore.fetch(strictLiveRequest(request, incomingUrl, parsedPath.gameId), env, ctx);
      return decorateLiveResponse(response, incomingUrl, parsedPath);
    }

    if (!historical && incomingUrl.pathname === '/api/chatgpt') {
      const gameId = incomingUrl.searchParams.get('gameId');
      if (!gameId || !GAME_ID_PATTERN.test(gameId)) {
        return new Response(JSON.stringify({ error: gameId ? 'Invalid game ID' : 'Missing game ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Worker-Version': WORKER_VERSION }
        });
      }
      const response = await reliableCore.fetch(request, env, ctx);
      return decorateLiveResponse(response, incomingUrl, null);
    }

    if (incomingUrl.pathname === '/api/resolve-game' && request.method === 'GET') {
      const response = await reliableCore.fetch(request, env, ctx);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: versionedHeaders(response)
      });
    }

    return workerV23.fetch(request, env, ctx);
  }
};
