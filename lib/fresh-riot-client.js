import {
  candidateFromPayload,
  createRiotClient as createBaseRiotClient
} from './riot-client.js';
import {
  FUTURE_TOLERANCE_SECONDS,
  parseTimestamp
} from './reliability-policy.js';

const FRESHNESS_SWEEP_COOLDOWN_MS = 15_000;
const CANDIDATE_FORWARD_OFFSETS_SECONDS = [10, 30, 60, 120];
const WALL_CLOCK_SWEEP_OFFSETS_SECONDS = [120, 240];
const lastSweepAtByGame = new Map();

function roundedIso(timestampMs) {
  return new Date(Math.floor(timestampMs / 10_000) * 10_000).toISOString();
}

export function freshnessSweepTimes(candidateTimestamp, nowMs = Date.now(), after = null) {
  const candidateMs = parseTimestamp(candidateTimestamp);
  const afterMs = parseTimestamp(after);
  if (candidateMs === null) return [];

  const values = [
    ...CANDIDATE_FORWARD_OFFSETS_SECONDS.map(seconds => candidateMs + seconds * 1000),
    ...WALL_CLOCK_SWEEP_OFFSETS_SECONDS.map(seconds => nowMs - seconds * 1000)
  ];

  return [...new Set(values
    .filter(value => Number.isFinite(value)
      && value > candidateMs
      && (afterMs === null || value > afterMs)
      && value <= nowMs + FUTURE_TOLERANCE_SECONDS * 1000)
    .map(roundedIso))];
}

function newestGameplay(candidates, afterMs) {
  return candidates
    .filter(candidate => candidate?.phase === 'gameplay'
      && (afterMs === null || candidate.timestampMs > afterMs))
    .sort((left, right) => right.timestampMs - left.timestampMs)[0] || null;
}

function sweepAllowed(gameId, nowMs) {
  const key = String(gameId);
  const lastSweepAt = lastSweepAtByGame.get(key) || 0;
  if (nowMs - lastSweepAt < FRESHNESS_SWEEP_COOLDOWN_MS) return false;
  lastSweepAtByGame.set(key, nowMs);
  return true;
}

export function createRiotClient(env) {
  const base = createBaseRiotClient(env);

  async function fetchBestLiveWindow(gameId, after) {
    const startedAt = Date.now();
    const initial = await base.fetchBestLiveWindow(gameId, after);
    if (!initial || initial.phase !== 'gameplay') return initial;
    if (initial.timestampQuality?.freshness === 'fresh') return initial;

    const nowMs = Date.now();
    if (!sweepAllowed(gameId, nowMs)) return initial;

    const afterMs = parseTimestamp(after);
    const alreadyAttempted = new Set(
      (initial.retrieval?.attemptedStartingTimes || []).filter(Boolean)
    );
    const probeTimes = freshnessSweepTimes(initial.timestampMs, nowMs, after)
      .filter(startingTime => !alreadyAttempted.has(startingTime));

    if (!probeTimes.length) return initial;

    const swept = await Promise.all(probeTimes.map(async startingTime => {
      const payload = await base.fetchWindow(gameId, startingTime).catch(() => null);
      const candidate = candidateFromPayload(payload, nowMs);
      if (candidate) candidate.lookupStartingTime = startingTime;
      return candidate;
    }));

    const selected = newestGameplay([initial, ...swept], afterMs) || initial;
    const initialTimestampMs = Number(initial.timestampMs);
    const selectedTimestampMs = Number(selected.timestampMs);
    const improvedBySeconds = Number.isFinite(initialTimestampMs) && Number.isFinite(selectedTimestampMs)
      ? Math.max(0, Math.round((selectedTimestampMs - initialTimestampMs) / 1000))
      : 0;
    const attemptedStartingTimes = [
      ...(initial.retrieval?.attemptedStartingTimes || []),
      ...probeTimes
    ];

    return {
      ...selected,
      retrieval: {
        ...(initial.retrieval || {}),
        elapsedMs: Date.now() - startedAt,
        requestCount: Number(initial.retrieval?.requestCount || 0) + probeTimes.length,
        attemptedStartingTimes: [...new Set(attemptedStartingTimes)],
        selectedStartingTime: selected.lookupStartingTime
          ?? initial.retrieval?.selectedStartingTime
          ?? null,
        freshnessSweep: true,
        freshnessSweepRequests: probeTimes.length,
        freshnessSweepCooldownMs: FRESHNESS_SWEEP_COOLDOWN_MS,
        freshnessSweepImprovedBySeconds: improvedBySeconds,
        initialFrameTimestamp: new Date(initial.timestampMs).toISOString()
      }
    };
  }

  return {
    ...base,
    fetchBestLiveWindow
  };
}
