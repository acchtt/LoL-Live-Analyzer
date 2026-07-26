import workerV21 from './worker-v2.1.js';

const WORKER_VERSION = '2.2';
const MAX_BODY_BYTES = 750_000;
const MAX_MATCHES = 20;
const MAX_MARKETS = 500;
const MAX_LINES = 30;
const MAX_SELECTIONS = 20;
const BRIDGE_TTL_SECONDS = 60 * 60;
const MATCH_ID_PATTERN = /^\d{4,14}$/;

function corsHeaders(request, extra = {}) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Odds-Bridge-Secret',
    'Access-Control-Max-Age': '86400',
    ...extra
  };
}

function json(data, status, request, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Worker-Version': WORKER_VERSION,
      ...extraHeaders
    })
  });
}

function text(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function suppliedSecret(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return (request.headers.get('X-Odds-Bridge-Secret') || '').trim();
}

function bridgeConfigured(env) {
  return Boolean(String(env?.ODDS_BRIDGE_SECRET || '').trim());
}

function authorized(request, env) {
  const expected = String(env?.ODDS_BRIDGE_SECRET || '').trim();
  const supplied = suppliedSecret(request);
  return Boolean(expected && supplied && constantTimeEqual(expected, supplied));
}

function sanitizeSelection(selection = {}) {
  return {
    code: integer(selection.code),
    name: text(selection.name, 160),
    side: text(selection.side, 32) || null,
    handicap: finiteNumber(selection.handicap),
    odds: finiteNumber(selection.odds),
    locked: Boolean(selection.locked),
    prompt: Boolean(selection.prompt)
  };
}

function sanitizeLine(line = {}) {
  return {
    handicap: finiteNumber(line.handicap),
    selections: (Array.isArray(line.selections) ? line.selections : [])
      .slice(0, MAX_SELECTIONS)
      .map(sanitizeSelection)
      .filter(selection => selection.name && selection.odds !== null)
  };
}

function sanitizeMarket(market = {}) {
  return {
    providerMarketId: text(market.providerMarketId, 32),
    code: text(market.code, 80),
    name: text(market.name, 240),
    gameOrder: integer(market.gameOrder),
    group: text(market.group, 80) || null,
    marketGroup: text(market.marketGroup, 80) || null,
    live: Boolean(market.live),
    providerStatus: integer(market.providerStatus),
    available: Boolean(market.available),
    tabs: (Array.isArray(market.tabs) ? market.tabs : []).slice(0, 20).map(value => text(value, 40)),
    lines: (Array.isArray(market.lines) ? market.lines : [])
      .slice(0, MAX_LINES)
      .map(sanitizeLine)
      .filter(line => line.selections.length)
  };
}

function sanitizeTeam(team = {}) {
  return {
    id: text(team.id, 32) || null,
    name: text(team.name, 160),
    code: text(team.code, 32) || null,
    score: finiteNumber(team.score),
    image: /^https:\/\//i.test(String(team.image || '')) ? text(team.image, 500) : null
  };
}

function sanitizeMatch(match = {}) {
  const providerMatchId = text(match.providerMatchId, 32);
  if (!MATCH_ID_PATTERN.test(providerMatchId)) return null;

  return {
    providerMatchId,
    externalMatchId: text(match.externalMatchId, 64) || null,
    sport: text(match.sport, 120) || 'League of Legends',
    sportCode: text(match.sportCode, 32) || 'LOL',
    league: text(match.league, 180),
    leagueCode: text(match.leagueCode, 64) || null,
    matchType: text(match.matchType, 40) || null,
    group: text(match.group, 40) || null,
    live: Boolean(match.live),
    liveOpened: Boolean(match.liveOpened),
    providerStatus: integer(match.providerStatus),
    updatedAt: text(match.updatedAt, 64) || null,
    teams: {
      home: sanitizeTeam(match?.teams?.home),
      away: sanitizeTeam(match?.teams?.away)
    },
    markets: (Array.isArray(match.markets) ? match.markets : [])
      .slice(0, MAX_MARKETS)
      .map(sanitizeMarket)
      .filter(market => market.providerMarketId && market.code && market.lines.length)
  };
}

function sanitizePayload(payload = {}) {
  const matches = (Array.isArray(payload.matches) ? payload.matches : [])
    .slice(0, MAX_MATCHES)
    .map(sanitizeMatch)
    .filter(Boolean);

  return {
    schemaVersion: '1.0',
    provider: 'BK8 / IME eSportsBull',
    source: 'ime-esportsbull-browser-bridge',
    capturedAt: text(payload.capturedAt, 64) || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    matches
  };
}

function cacheRequest(key) {
  return new Request(`https://odds-bridge-cache.invalid/${key}`);
}

async function storePayload(payload, ctx) {
  const tasks = [];
  const latest = new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${BRIDGE_TTL_SECONDS}`
    }
  });
  tasks.push(caches.default.put(cacheRequest('latest'), latest));

  for (const match of payload.matches) {
    const matchPayload = {
      schemaVersion: payload.schemaVersion,
      provider: payload.provider,
      source: payload.source,
      capturedAt: payload.capturedAt,
      receivedAt: payload.receivedAt,
      match
    };
    const response = new Response(JSON.stringify(matchPayload), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${BRIDGE_TTL_SECONDS}`
      }
    });
    tasks.push(caches.default.put(cacheRequest(`match/${match.providerMatchId}`), response));
  }

  const storage = Promise.all(tasks);
  if (ctx?.waitUntil) ctx.waitUntil(storage);
  else await storage;
}

async function ingest(request, env, ctx) {
  if (!bridgeConfigured(env)) {
    return json({
      status: 'configuration_required',
      error: 'ODDS_BRIDGE_SECRET is not configured in Cloudflare Worker secrets.'
    }, 503, request, { 'X-Odds-Bridge': 'not-configured' });
  }

  if (!authorized(request, env)) {
    return json({ status: 'unauthorized', error: 'Invalid odds bridge secret.' }, 401, request, {
      'WWW-Authenticate': 'Bearer realm="odds-bridge"',
      'X-Odds-Bridge': 'unauthorized'
    });
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ status: 'payload_too_large' }, 413, request);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ status: 'payload_too_large' }, 413, request);
  }

  let incoming;
  try {
    incoming = JSON.parse(raw);
  } catch {
    return json({ status: 'invalid_json' }, 400, request);
  }

  const payload = sanitizePayload(incoming);
  if (!payload.matches.length) {
    return json({ status: 'invalid_payload', error: 'No valid bookmaker matches were supplied.' }, 400, request);
  }

  await storePayload(payload, ctx);
  return json({
    status: 'accepted',
    provider: payload.provider,
    receivedAt: payload.receivedAt,
    matches: payload.matches.map(match => ({
      providerMatchId: match.providerMatchId,
      league: match.league,
      home: match.teams.home.name,
      away: match.teams.away.name,
      marketCount: match.markets.length
    }))
  }, 202, request, { 'X-Odds-Bridge': 'accepted' });
}

async function readStored(request, key) {
  const cached = await caches.default.match(cacheRequest(key)).catch(() => null);
  if (!cached) {
    return json({
      status: 'waiting_for_bridge',
      message: 'Open the bookmaker page with the odds bridge userscript enabled.'
    }, 404, request, { 'X-Odds-Bridge': 'empty' });
  }

  const payload = await cached.json().catch(() => null);
  if (!payload) return json({ status: 'cache_error' }, 502, request);

  const receivedAt = Date.parse(payload.receivedAt || '');
  const ageSeconds = Number.isFinite(receivedAt) ? Math.max(0, Math.round((Date.now() - receivedAt) / 1000)) : null;
  return json({
    status: 'ok',
    ...payload,
    ageSeconds,
    stale: ageSeconds === null || ageSeconds > 30
  }, 200, request, { 'X-Odds-Bridge': 'stored' });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/odds/bridge' && request.method === 'POST') {
      return ingest(request, env, ctx);
    }

    if (url.pathname === '/api/odds/bridge/latest' && request.method === 'GET') {
      return readStored(request, 'latest');
    }

    const matchPath = url.pathname.match(/^\/api\/odds\/bridge\/(\d{4,14})\/?$/);
    if (matchPath && request.method === 'GET') {
      return readStored(request, `match/${matchPath[1]}`);
    }

    const response = await workerV21.fetch(request, env, ctx);
    if (url.pathname !== '/' && url.pathname !== '/health') return response;

    const payload = await response.clone().json().catch(() => null);
    if (!payload) return response;
    return json({
      ...payload,
      version: WORKER_VERSION,
      bookmakerBridge: {
        provider: 'BK8 / IME eSportsBull',
        configured: bridgeConfigured(env),
        ingestEndpoint: `${url.origin}/api/odds/bridge`,
        latestEndpoint: `${url.origin}/api/odds/bridge/latest`,
        matchEndpoint: `${url.origin}/api/odds/bridge/PROVIDER_MATCH_ID`
      }
    }, response.status, request);
  }
};
