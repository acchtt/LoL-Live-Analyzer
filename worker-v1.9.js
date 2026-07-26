import workerV18 from './worker-v1.8.js';

const WORKER_VERSION = '1.9';
const GAME_ID_PATTERN = /^\d{8,}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function parseRotatingFeedPath(pathname) {
  const match = pathname.match(/^\/(?:api\/chatgpt|feed)\/(\d+)(?:\/([A-Za-z0-9_-]+))?\/?$/);
  if (!match) return null;
  return { gameId: match[1], token: match[2] || null };
}

function rotatingFeedUrl(origin, gameId, token, historical = false) {
  const safeToken = token || `m${Math.floor(Date.now() / 60_000)}`;
  const url = new URL(`/api/chatgpt/${encodeURIComponent(gameId)}/${encodeURIComponent(safeToken)}`, origin);
  if (historical) url.searchParams.set('historical', '1');
  return url.toString();
}

function freshHeaders(original, extraHeaders = {}) {
  const headers = new Headers(original.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  headers.set('Surrogate-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Vary', 'Accept, User-Agent');
  headers.set('X-Worker-Version', WORKER_VERSION);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return headers;
}

function jsonResponse(data, original, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: original.status,
    statusText: original.statusText,
    headers: freshHeaders(original, extraHeaders)
  });
}

function noStoreResponse(original, extraHeaders = {}) {
  return new Response(original.body, {
    status: original.status,
    statusText: original.statusText,
    headers: freshHeaders(original, extraHeaders)
  });
}

export default {
  async fetch(request, env, ctx) {
    const incomingUrl = new URL(request.url);
    const parsed = parseRotatingFeedPath(incomingUrl.pathname);

    if (parsed && (!GAME_ID_PATTERN.test(parsed.gameId) || (parsed.token && !TOKEN_PATTERN.test(parsed.token)))) {
      return jsonResponse({ error: 'Invalid feed path' }, new Response('', { status: 400 }));
    }

    let effectiveRequest = request;
    if (parsed?.token) {
      const target = new URL(`/api/chatgpt/${encodeURIComponent(parsed.gameId)}`, incomingUrl.origin);
      if (incomingUrl.searchParams.get('historical') === '1') target.searchParams.set('historical', '1');
      effectiveRequest = new Request(target.toString(), request);
    }

    const response = await workerV18.fetch(effectiveRequest, env, ctx);

    if (incomingUrl.pathname === '/' || incomingUrl.pathname === '/health') {
      const payload = await response.clone().json().catch(() => null);
      return payload
        ? jsonResponse({
          ...payload,
          version: WORKER_VERSION,
          preferredFeedFormat: `${incomingUrl.origin}/api/chatgpt/GAME_ID/FRESH_TOKEN`,
          tokenGuidance: 'Use a new minute token such as m29384271 for each fresh read.'
        }, response)
        : noStoreResponse(response);
    }

    if (!parsed?.token) return noStoreResponse(response);

    const payload = await response.clone().json().catch(() => null);
    if (!payload) return noStoreResponse(response, { 'X-Feed-Format': 'rotating-path' });

    const historical = incomingUrl.searchParams.get('historical') === '1';
    const normalized = {
      ...payload,
      schemaVersion: WORKER_VERSION,
      request: {
        ...(payload.request || {}),
        gameId: parsed.gameId,
        freshToken: parsed.token,
        feedUrl: rotatingFeedUrl(incomingUrl.origin, parsed.gameId, parsed.token, historical),
        format: 'rotating-path',
        cachePolicy: 'unique path token plus no-store headers'
      }
    };

    return jsonResponse(normalized, response, {
      'X-Feed-Format': 'rotating-path',
      'X-Fresh-Token': parsed.token,
      'X-Canonical-Feed': rotatingFeedUrl(incomingUrl.origin, parsed.gameId, parsed.token, historical)
    });
  }
};
