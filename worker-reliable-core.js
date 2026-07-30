import {
  DEGRADED_FRAME_SECONDS,
  FRESH_FRAME_SECONDS,
  FUTURE_TOLERANCE_SECONDS
} from './lib/reliability-policy.js';
import { createRiotClient } from './lib/fresh-riot-client.js';
import { buildLiveSnapshot } from './lib/live-snapshot.js';
import { resolveActiveGame } from './lib/live-resolver.js';
import {
  normalizeAuthoritativeCompletion,
  unresolvedPlaceholderEvent
} from './lib/series-integrity.js';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Type, Cache-Control, X-Data-Quality, X-Retrieval-Ms, X-Worker-Version, Server-Timing',
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

function eventMatchId(event) {
  return String(event?.match?.id || event?.id || '');
}

function retrievalHeaders(payload) {
  const elapsed = Number(payload?.retrieval?.totalMs);
  if (!Number.isFinite(elapsed)) return {};
  return {
    'X-Retrieval-Ms': String(Math.max(0, Math.round(elapsed))),
    'Server-Timing': `retrieval;dur=${Math.max(0, elapsed)}`
  };
}

async function reliableSchedule(riot, leagueId) {
  const [scheduleResult, liveResult] = await Promise.allSettled([
    riot.getSchedule(leagueId),
    riot.getLive()
  ]);
  if (scheduleResult.status === 'rejected') throw scheduleResult.reason;
  const payload = scheduleResult.value || {};
  const events = payload?.data?.schedule?.events || payload?.schedule?.events || [];
  const liveEvents = liveResult.status === 'fulfilled'
    ? (liveResult.value?.data?.schedule?.events || [])
    : [];
  const liveByMatch = new Map(liveEvents.map(event => [eventMatchId(event), event]));
  const visibleEvents = [];

  for (const event of events) {
    let completed = normalizeAuthoritativeCompletion(event);
    const live = liveByMatch.get(eventMatchId(event));

    if (live && !completed) {
      if (live?.match) event.match = { ...(event.match || {}), ...live.match };
      completed = normalizeAuthoritativeCompletion(event);
      if (!completed) {
        event.state = 'inProgress';
        event.liveSource = 'riot_getLive';
      }
    }

    if (!unresolvedPlaceholderEvent(event)) visibleEvents.push(event);
  }

  events.splice(0, events.length, ...visibleEvents);
  return payload;
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
            maximumWindowRequestsPerSnapshot: 17,
            detailsProbeKeys: 4,
            hedgedWindowLookup: true,
            delayedPrimaryFreshnessSweep: true,
            freshnessSweepCooldownSeconds: 15,
            upstreamTimeoutsEnabled: true,
            officialScoresFromTelemetryInference: false,
            clinchedSeriesRetiredFromLiveSchedule: true,
            unresolvedPlaceholderMatchesHidden: true
          }
        });
      }
      if (url.pathname === '/api/schedule') {
        return json(await reliableSchedule(riot, url.searchParams.get('leagueId')), 200, {
          'Cache-Control': 'public, max-age=10'
        });
      }
      if (url.pathname === '/api/live') {
        return json(await riot.getLive(), 200, { 'Cache-Control': 'public, max-age=10' });
      }
      if (url.pathname === '/api/event' || url.pathname === '/api/match-details') {
        const matchId = required(url.searchParams.get('matchId') || url.searchParams.get('id'), 'match id');
        const event = await riot.getEvent(matchId);
        normalizeAuthoritativeCompletion(event);
        return json(event);
      }
      if (url.pathname === '/api/chatgpt') {
        const gameId = required(url.searchParams.get('gameId'), 'gameId');
        const snapshot = await buildLiveSnapshot(gameId, env, url.searchParams.get('after'), riot);
        return json(snapshot, 200, {
          'X-Data-Quality': snapshot?.quality?.safeForLiveAnalysis ? 'safe' : snapshot?.quality?.freshness || 'unavailable',
          ...retrievalHeaders(snapshot)
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
