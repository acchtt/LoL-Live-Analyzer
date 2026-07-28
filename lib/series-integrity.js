const PLACEHOLDER_TEAM_KEYS = new Set([
  '',
  'tbd',
  'tba',
  'unknown',
  'tobedetermined',
  'team1',
  'team2'
]);

function normalized(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function teamWins(team = {}) {
  const value = team?.result?.gameWins ?? team?.wins;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function seriesTargetWins(event = {}) {
  const count = Number(event?.match?.strategy?.count);
  return Number.isInteger(count) && count > 0 ? Math.floor(count / 2) + 1 : null;
}

export function authoritativeSeriesComplete(event = {}) {
  if (event?.state === 'completed' || event?.match?.state === 'completed') return true;
  const target = seriesTargetWins(event);
  const teams = Array.isArray(event?.match?.teams) ? event.match.teams : [];
  if (target === null || teams.length < 2) return false;
  return teams.some(team => {
    const wins = teamWins(team);
    return wins !== null && wins >= target;
  });
}

export function normalizeAuthoritativeCompletion(event = {}) {
  if (!authoritativeSeriesComplete(event)) return false;
  event.state = 'completed';
  if (event.match) event.match.state = 'completed';
  if (!event.completionSource) event.completionSource = 'riot_series_score';
  return true;
}

export function resolvedTeam(team = {}) {
  if (String(team?.id || '').trim()) return true;
  if (String(team?.image || '').trim()) return true;
  const code = normalized(team?.code);
  const name = normalized(team?.name);
  return !PLACEHOLDER_TEAM_KEYS.has(code) || !PLACEHOLDER_TEAM_KEYS.has(name);
}

export function unresolvedPlaceholderEvent(event = {}) {
  const teams = Array.isArray(event?.match?.teams) ? event.match.teams : [];
  return teams.length < 2 || teams.every(team => !resolvedTeam(team));
}
