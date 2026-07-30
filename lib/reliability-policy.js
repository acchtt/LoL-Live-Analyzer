export const FRESH_FRAME_SECONDS = 30;
// Match production behavior: frames older than 90 seconds are stale and must not
// be promoted into an active live-game selection. They may still be retained by
// the snapshot store for explicitly historical or stale-context rendering.
export const DEGRADED_FRAME_SECONDS = 90;
export const FUTURE_TOLERANCE_SECONDS = 15;

export function finiteOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function integerOrNull(value) {
  const parsed = finiteOrNull(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? (value > 1e12 ? value : value * 1000) : null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') return numeric > 1e12 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyTimestamp(timestampMs, nowMs = Date.now()) {
  if (!Number.isFinite(timestampMs)) {
    return { timestampValid: false, freshness: 'invalid', dataAgeSeconds: null, futureSkewSeconds: null };
  }

  const skewSeconds = Math.round((timestampMs - nowMs) / 1000);
  if (skewSeconds > FUTURE_TOLERANCE_SECONDS) {
    return { timestampValid: false, freshness: 'invalid', dataAgeSeconds: 0, futureSkewSeconds: skewSeconds };
  }

  const dataAgeSeconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  const freshness = dataAgeSeconds <= FRESH_FRAME_SECONDS
    ? 'fresh'
    : dataAgeSeconds <= DEGRADED_FRAME_SECONDS
      ? 'degraded'
      : 'stale';
  return {
    timestampValid: true,
    freshness,
    dataAgeSeconds,
    futureSkewSeconds: Math.max(0, skewSeconds)
  };
}

export function normalizeDragonData(value) {
  if (Array.isArray(value)) return { dragons: value, dragonCount: value.length, missing: false };
  const count = integerOrNull(value);
  if (count !== null && count >= 0) {
    return { dragons: Array.from({ length: count }, () => null), dragonCount: count, missing: false };
  }
  return { dragons: null, dragonCount: null, missing: true };
}

export function subtract(left, right) {
  return left === null || right === null ? null : left - right;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}
