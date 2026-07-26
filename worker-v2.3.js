import workerV22 from './worker-v2.2.js';

const WORKER_VERSION = '2.3';
const KV_TTL_SECONDS = 6 * 60 * 60;
const LATEST_KEY = 'odds-bridge:latest';
const MATCH_KEY_PREFIX = 'odds-bridge:match:';

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

function kvAvailable(env) {
  return Boolean(env?.ODDS_CACHE && typeof env.ODDS_CACHE.get === 'function' && typeof env.ODDS_CACHE.put === 'function');
}

function stripComputedFields(payload = {}) {
  const stored = { ...payload };
  delete stored.status;
  delete stored.ageSeconds;
  delete stored.stale;
  return stored;
}

function matchPayload(payload, match) {
  return {
    schemaVersion: payload.schemaVersion,
    provider: payload.provider,
    source: payload.source,
    capturedAt: payload.capturedAt,
    receivedAt: payload.receivedAt,
    match
  };
}

async function persistToKv(env, payload) {
  if (!kvAvailable(env)) return false;
  const clean = stripComputedFields(payload);
  const tasks = [
    env.ODDS_CACHE.put(LATEST_KEY, JSON.stringify(clean), { expirationTtl: KV_TTL_SECONDS })
  ];

  for (const match of Array.isArray(clean.matches) ? clean.matches : []) {
    const providerMatchId = String(match?.providerMatchId || '');
    if (!/^\d{4,14}$/.test(providerMatchId)) continue;
    tasks.push(env.ODDS_CACHE.put(
      `${MATCH_KEY_PREFIX}${providerMatchId}`,
      JSON.stringify(matchPayload(clean, match)),
      { expirationTtl: KV_TTL_SECONDS }
    ));
  }

  await Promise.all(tasks);
  return true;
}

async function readFromKv(request, env, key) {
  if (!kvAvailable(env)) return null;
  let payload;
  try {
    payload = await env.ODDS_CACHE.get(key, { type: 'json' });
  } catch {
    return null;
  }
  if (!payload) return null;

  const receivedAt = Date.parse(payload.receivedAt || '');
  const ageSeconds = Number.isFinite(receivedAt)
    ? Math.max(0, Math.round((Date.now() - receivedAt) / 1000))
    : null;

  return json({
    status: 'ok',
    ...payload,
    ageSeconds,
    stale: ageSeconds === null || ageSeconds > 30
  }, 200, request, { 'X-Odds-Bridge': 'stored-kv', 'X-Odds-Storage': 'kv' });
}

async function readAndBackfill(request, env, ctx, key) {
  const durable = await readFromKv(request, env, key);
  if (durable) return durable;

  const fallback = await workerV22.fetch(request, env, ctx);
  if (!fallback.ok || !kvAvailable(env)) return fallback;

  const payload = await fallback.clone().json().catch(() => null);
  if (payload?.status === 'ok') {
    const clean = stripComputedFields(payload);
    try {
      if (key === LATEST_KEY) await persistToKv(env, clean);
      else await env.ODDS_CACHE.put(key, JSON.stringify(clean), { expirationTtl: KV_TTL_SECONDS });
    } catch {
      // The edge-cache response remains usable even when the KV backfill fails.
    }
  }
  return fallback;
}

async function ingest(request, env) {
  // Passing a context without waitUntil makes v2.2 finish its validated edge-cache write
  // before this wrapper reads back the sanitized payload for durable persistence.
  const response = await workerV22.fetch(request, env, {});
  if (response.status !== 202 || !kvAvailable(env)) return response;

  const origin = new URL(request.url).origin;
  const localRead = await workerV22.fetch(new Request(`${origin}/api/odds/bridge/latest`, {
    method: 'GET',
    headers: { Origin: request.headers.get('Origin') || origin }
  }), env, {});
  const payload = await localRead.json().catch(() => null);

  let storage = 'edge-fallback';
  if (payload?.status === 'ok') {
    try {
      await persistToKv(env, payload);
      storage = 'kv+edge';
    } catch {
      storage = 'edge-fallback';
    }
  }

  const headers = new Headers(response.headers);
  headers.set('X-Worker-Version', WORKER_VERSION);
  headers.set('X-Odds-Storage', storage);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/odds/bridge' && request.method === 'POST') {
      return ingest(request, env);
    }

    if (url.pathname === '/api/odds/bridge/latest' && request.method === 'GET') {
      return readAndBackfill(request, env, ctx, LATEST_KEY);
    }

    const matchPath = url.pathname.match(/^\/api\/odds\/bridge\/(\d{4,14})\/?$/);
    if (matchPath && request.method === 'GET') {
      return readAndBackfill(request, env, ctx, `${MATCH_KEY_PREFIX}${matchPath[1]}`);
    }

    const response = await workerV22.fetch(request, env, ctx);
    if (url.pathname !== '/' && url.pathname !== '/health') return response;

    const payload = await response.clone().json().catch(() => null);
    if (!payload) return response;
    return json({
      ...payload,
      version: WORKER_VERSION,
      bookmakerBridge: {
        ...(payload.bookmakerBridge || {}),
        storage: kvAvailable(env) ? 'Workers KV + edge cache' : 'edge cache fallback',
        durable: kvAvailable(env)
      }
    }, response.status, request);
  }
};
