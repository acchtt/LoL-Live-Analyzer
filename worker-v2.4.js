import workerV23 from './worker-v2.3.js';
import reliableCore from './worker-reliable-core.js';
import { createRiotClient } from './lib/riot-client.js';
import { buildHistoricalSnapshot } from './lib/historical-snapshot.js';
import {
  DEGRADED_FRAME_SECONDS,
  FRESH_FRAME_SECONDS,
  FUTURE_TOLERANCE_SECONDS
} from './lib/reliability-policy.js';

const WORKER_VERSION = '2.4';
const TELEMETRY_POLICY_REVISION = 'production-90s-1';
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
  headers.set('X-RiftPulse-Policy-Revision', TELEMETRY_POLICY_REVISION);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

function jsonResponse(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: versionedHeaders(new Response(null), {
      'Content-Type': 'application/json; charset=utf-8',
      ...extra
    })
  });
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
      reliabilityPolicy: `strict-live-v2.4:${TELEMETRY_POLICY_REVISION}`
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

async function historicalResponse(incomingUrl, parsedPath, env) {
  const gameId = parsedPath?.gameId || incomingUrl.searchParams.get('gameId');
  if (!gameId || !GAME_ID_PATTERN.test(gameId)) {
    return jsonResponse({ error: gameId ? 'Invalid game ID' : 'Missing game ID' }, 400);
  }

  try {
    const snapshot = await buildHistoricalSnapshot(gameId, env, createRiotClient(env));
    return jsonResponse({
      ...snapshot,
      request: {
        ...(snapshot.request || {}),
        gameId,
        freshToken: parsedPath?.token || null,
        format: parsedPath ? 'rotating-path' : 'query',
        reliabilityPolicy: 'historical-recovery-v2.4'
      }
    }, 200, {
      'X-Data-Quality': snapshot.status === 'ok' ? 'historical-recovered' : 'historical-unavailable',
      'X-Feed-Format': parsedPath ? 'rotating-path' : 'query'
    });
  } catch (error) {
    return jsonResponse({
      schemaVersion: WORKER_VERSION,
      status: 'historical_unavailable',
      source: { gameId, live: false, historicalProbe: true },
      quality: {
        freshness: 'historical',
        safeForLiveAnalysis: false,
        historical: true,
        criticalMissingFields: ['historicalGameplayFrame']
      },
      message: error instanceof Error ? error.message : 'Historical recovery failed.'
    }, 200, { 'X-Data-Quality': 'historical-unavailable' });
  }
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
      policyRevision: TELEMETRY_POLICY_REVISION,
      freshFrameSeconds: FRESH_FRAME_SECONDS,
      degradedFrameSeconds: DEGRADED_FRAME_SECONDS,
      futureTimestampToleranceSeconds: FUTURE_TOLERANCE_SECONDS,
      maximumWindowRequestsPerSnapshot: 17,
      missingValuesPreservedAsNull: true,
      inferredTelemetryWinnersDisabled: true,
      historicalPregameFramesRejected: true
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
      return jsonResponse({ error: 'Invalid feed path' }, 400);
    }

    if (incomingUrl.pathname === '/' || incomingUrl.pathname === '/health') {
      return healthResponse(request, env, ctx);
    }

    if (historical && (parsedPath || incomingUrl.pathname === '/api/chatgpt')) {
      return historicalResponse(incomingUrl, parsedPath, env);
    }

    if (parsedPath) {
      const response = await reliableCore.fetch(strictLiveRequest(request, incomingUrl, parsedPath.gameId), env, ctx);
      return decorateLiveResponse(response, incomingUrl, parsedPath);
    }

    if (incomingUrl.pathname === '/api/chatgpt') {
      const gameId = incomingUrl.searchParams.get('gameId');
      if (!gameId || !GAME_ID_PATTERN.test(gameId)) {
        return jsonResponse({ error: gameId ? 'Invalid game ID' : 'Missing game ID' }, 400);
      }
      const response = await reliableCore.fetch(request, env, ctx);
      return decorateLiveResponse(response, incomingUrl, null);
    }

    if ([
      '/api/schedule',
      '/api/live',
      '/api/event',
      '/api/match-details',
      '/api/resolve-game'
    ].includes(incomingUrl.pathname) && request.method === 'GET') {
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
