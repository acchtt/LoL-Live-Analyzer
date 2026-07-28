import { classifyTimestamp, parseTimestamp } from './reliability-policy.js';

const SNAPSHOT_CACHE_TTL_SECONDS = 10 * 60;

function cacheKey(gameId) {
  return new Request(`https://reliable-snapshot-cache.invalid/game/${encodeURIComponent(gameId)}`);
}

export async function readSnapshot(gameId) {
  try {
    const response = await caches.default.match(cacheKey(gameId));
    return response ? response.json() : null;
  } catch {
    return null;
  }
}

export async function writeSnapshot(gameId, snapshot) {
  if (!snapshot || !['ok', 'degraded', 'pregame'].includes(snapshot.status)) return;
  try {
    await caches.default.put(cacheKey(gameId), new Response(JSON.stringify(snapshot), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${SNAPSHOT_CACHE_TTL_SECONDS}`
      }
    }));
  } catch {
    // Cache API may be unavailable in local preview.
  }
}

export function recoveredSnapshot(cachedSnapshot) {
  const freshness = classifyTimestamp(parseTimestamp(cachedSnapshot?.source?.frameTimestamp));
  return {
    ...cachedSnapshot,
    status: 'telemetry_stale',
    updatedAt: new Date().toISOString(),
    source: {
      ...(cachedSnapshot?.source || {}),
      live: false,
      recoveredFromWorkerCache: true,
      dataAgeSeconds: freshness.dataAgeSeconds
    },
    quality: {
      ...(cachedSnapshot?.quality || {}),
      freshness: 'stale',
      safeForLiveAnalysis: false,
      recoveredFromWorkerCache: true
    },
    message: 'Riot returned no usable live frame. This cached snapshot is context only and is not safe for live analysis.'
  };
}
