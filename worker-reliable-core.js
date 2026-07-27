import {
  DEGRADED_FRAME_SECONDS,
  FRESH_FRAME_SECONDS,
  FUTURE_TOLERANCE_SECONDS
} from './lib/reliability-policy.js';
import { createRiotClient } from './lib/riot-client.js';
import { buildLiveSnapshot } from './lib/live-snapshot.js';
import { resolveActiveGame } from './lib/live-resolver.js';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Type, Cache-Control, X-Data-Quality, X-Worker-Version',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Worker-Version': '2.4',
      ...cors(),
      ...extra
    }
  });
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const url = new URL(request.url);
    const riot = createRiotClient(env);
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({
          ok: true,
          service: 'RiftPulse reliable live telemetry core',
          apiKeyConfigured: Boolean(env.LOL_ESPORTS_API_KEY),
          version: '2.4',
          reliability: {
            freshFrameSeconds: FRESH_FRAME_SECONDS,
            degradedFrameSeconds: DEGRADED_FRAME_SECONDS,
            futureToleranceSeconds: FUTURE_TOLERANCE_SECONDS,
            maximumWindowRequestsPerSnapshot: 3
          }
        });
      }
      if (url.pathname === '/api/chatgpt') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        const snapshot = await buildLiveSnapshot(gameId, env, url.searchParams.get('after'), riot);
        return json(snapshot, 200, {
          'X-Data-Quality': snapshot?.quality?.safeForLiveAnalysis ? 'safe' : snapshot?.quality?.freshness || 'unavailable'
        });
      }
      if (url.pathname === '/api/resolve-game') {
        const matchId = required(url.searchParams.get('matchId'), 'match id');
        const resolution = await resolveActiveGame(matchId, riot);
        return json(resolution, 200, {
          'X-Data-Quality': resolution?.quality?.safeForLiveAnalysis ? 'safe' : resolution?.quality?.freshness || 'unavailable'
        });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : 'Unknown error',
        path: url.pathname,
        updatedAt: new Date().toISOString()
      }, 502);
    }
  }
};
