import workerV20 from './worker-v2.0.js';

const WORKER_VERSION = '2.1';
const VSGG_MATCH_ID_PATTERN = /^\d{4,12}$/;
const VSGG_CACHE_SECONDS = 5;

function corsHeaders(request, extra = {}) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    ...extra
  };
}

function json(data, status = 200, request, extraHeaders = {}) {
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

function vsggOddsPath(pathname) {
  const match = pathname.match(/^\/api\/odds\/vsgg\/(\d+)\/?$/);
  return match?.[1] || null;
}

async function readVsggOdds(request, env, ctx, vsggMatchId) {
  if (!VSGG_MATCH_ID_PATTERN.test(vsggMatchId)) {
    return json({ status: 'error', error: 'Invalid VSGG match ID' }, 400, request);
  }

  const token = String(env?.VSGG_API_TOKEN || '').trim();
  if (!token) {
    return json({
      status: 'configuration_required',
      provider: 'VSGG',
      vsggMatchId,
      error: 'VSGG_API_TOKEN is not configured in Cloudflare Worker secrets.'
    }, 503, request, { 'X-Odds-Provider': 'VSGG' });
  }

  const cacheKey = new Request(`https://odds-cache.invalid/vsgg/${encodeURIComponent(vsggMatchId)}`);
  const cached = await caches.default.match(cacheKey).catch(() => null);
  if (cached) {
    const payload = await cached.json().catch(() => null);
    if (payload) return json({ ...payload, cache: 'hit' }, 200, request, { 'X-Odds-Cache': 'hit' });
  }

  const upstream = new URL(`https://api.vsgg.com/api/vsgg/v1/matches/odds/${encodeURIComponent(vsggMatchId)}`);
  upstream.searchParams.set('token', token);

  let response;
  try {
    response = await fetch(upstream.toString(), {
      headers: {
        Accept: '*/*',
        Origin: 'https://vsgg.com',
        Referer: 'https://vsgg.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; LoL-Live-Analyzer/2.1; +https://github.com/acchtt/LoL-Live-Analyzer)'
      }
    });
  } catch (error) {
    return json({
      status: 'upstream_unavailable',
      provider: 'VSGG',
      vsggMatchId,
      error: String(error?.message || error)
    }, 502, request, { 'X-Odds-Provider': 'VSGG' });
  }

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    return json({
      status: 'upstream_error',
      provider: 'VSGG',
      vsggMatchId,
      upstreamStatus: response.status,
      data
    }, response.status, request, { 'X-Odds-Provider': 'VSGG' });
  }

  const payload = {
    status: 'ok',
    provider: 'VSGG',
    vsggMatchId,
    fetchedAt: new Date().toISOString(),
    cacheTtlSeconds: VSGG_CACHE_SECONDS,
    cache: 'miss',
    data
  };

  const cacheResponse = new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${VSGG_CACHE_SECONDS}`
    }
  });
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, cacheResponse));

  return json(payload, 200, request, {
    'X-Odds-Provider': 'VSGG',
    'X-Odds-Cache': 'miss'
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const vsggMatchId = vsggOddsPath(url.pathname);
    if (vsggMatchId) return readVsggOdds(request, env, ctx, vsggMatchId);

    const response = await workerV20.fetch(request, env, ctx);
    if (url.pathname !== '/' && url.pathname !== '/health') return response;

    const payload = await response.clone().json().catch(() => null);
    if (!payload) return response;
    return json({
      ...payload,
      version: WORKER_VERSION,
      odds: {
        provider: 'VSGG',
        configured: Boolean(String(env?.VSGG_API_TOKEN || '').trim()),
        endpoint: `${url.origin}/api/odds/vsgg/VSGG_MATCH_ID`
      }
    }, response.status, request);
  }
};
