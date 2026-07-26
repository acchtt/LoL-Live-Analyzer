import workerV17 from './worker-v1.7.js';

const WORKER_VERSION = '1.8';
const GAME_ID_PATTERN = /^\d{8,}$/;

function pathGameId(pathname) {
  const match = pathname.match(/^\/(?:api\/chatgpt|feed)\/(\d+)\/?$/);
  return match?.[1] || null;
}

function jsonResponse(data, original, extraHeaders = {}) {
  const headers = new Headers(original.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('X-Worker-Version', WORKER_VERSION);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(data, null, 2), {
    status: original.status,
    statusText: original.statusText,
    headers
  });
}

function noStoreResponse(original, extraHeaders = {}) {
  const headers = new Headers(original.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('X-Worker-Version', WORKER_VERSION);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(original.body, {
    status: original.status,
    statusText: original.statusText,
    headers
  });
}

function canonicalFeedUrl(origin, gameId, historical = false) {
  const url = new URL(`/api/chatgpt/${encodeURIComponent(gameId)}`, origin);
  if (historical) url.searchParams.set('historical', '1');
  return url.toString();
}

export default {
  async fetch(request, env, ctx) {
    const incomingUrl = new URL(request.url);
    const gameId = pathGameId(incomingUrl.pathname);

    if ((incomingUrl.pathname === '/api/chatgpt/' || incomingUrl.pathname === '/feed/') && !gameId) {
      const response = new Response('', { status: 400 });
      return jsonResponse({
        error: 'Missing game ID',
        usage: `${incomingUrl.origin}/api/chatgpt/GAME_ID`,
        example: `${incomingUrl.origin}/api/chatgpt/115548681803406194`
      }, response);
    }

    let effectiveRequest = request;
    if (gameId) {
      if (!GAME_ID_PATTERN.test(gameId)) {
        const response = new Response('', { status: 400 });
        return jsonResponse({ error: 'Invalid game ID' }, response);
      }

      const target = new URL('/api/chatgpt', incomingUrl.origin);
      target.searchParams.set('gameId', gameId);
      if (incomingUrl.searchParams.get('historical') === '1') target.searchParams.set('historical', '1');
      effectiveRequest = new Request(target.toString(), request);
    }

    const response = await workerV17.fetch(effectiveRequest, env, ctx);

    if (incomingUrl.pathname === '/' || incomingUrl.pathname === '/health') {
      const payload = await response.clone().json().catch(() => null);
      return payload
        ? jsonResponse({
          ...payload,
          version: WORKER_VERSION,
          preferredFeedFormat: `${incomingUrl.origin}/api/chatgpt/GAME_ID`
        }, response)
        : noStoreResponse(response);
    }

    if (!gameId) return noStoreResponse(response);

    const payload = await response.clone().json().catch(() => null);
    if (!payload) return noStoreResponse(response, { 'X-Feed-Alias': 'path' });

    const normalized = {
      ...payload,
      schemaVersion: WORKER_VERSION,
      request: {
        ...(payload.request || {}),
        gameId,
        feedUrl: canonicalFeedUrl(incomingUrl.origin, gameId, incomingUrl.searchParams.get('historical') === '1'),
        format: 'path'
      }
    };

    return jsonResponse(normalized, response, {
      'X-Feed-Alias': 'path',
      'X-Canonical-Feed': canonicalFeedUrl(incomingUrl.origin, gameId, incomingUrl.searchParams.get('historical') === '1')
    });
  }
};
