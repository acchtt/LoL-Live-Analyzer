import {
  finiteOrNull,
  formatClock,
  integerOrNull,
  normalizeDragonData,
  parseTimestamp,
  subtract
} from './reliability-policy.js';
import { latestFrame, teamFrame } from './riot-client.js';

function metadataMap(teamMetadata = {}) {
  return new Map((teamMetadata?.participantMetadata || []).map((player, index) => [
    integerOrNull(player?.participantId) ?? index + 1,
    player
  ]));
}

function detailsMap(frame) {
  return new Map((frame?.participants || []).map((player, index) => [
    integerOrNull(player?.participantId ?? player?.participantID) ?? index + 1,
    player
  ]));
}

function teamInfo(event, teamMetadata, gameId, side) {
  const teams = event?.match?.teams || [];
  const metadataTeamId = String(teamMetadata?.esportsTeamId || '');
  const byMetadata = teams.find(team => String(team?.id || '') === metadataTeamId);
  if (byMetadata) return byMetadata;
  const game = (event?.match?.games || []).find(item => String(item?.id) === String(gameId));
  const sideTeamId = String(game?.teams?.find(team => String(team?.side || '').toLowerCase() === side)?.id || '');
  return teams.find(team => String(team?.id || '') === sideTeamId) || {};
}

function numberField(value, path, missing) {
  const parsed = finiteOrNull(value);
  if (parsed === null) missing.push(path);
  return parsed;
}

function normalizePlayer(raw, index, metadataById, detailedById, side, missing) {
  const participantId = integerOrNull(raw?.participantId ?? raw?.participantID) ?? index + 1;
  const metadata = metadataById.get(participantId) || {};
  const detail = detailedById.get(participantId) || {};
  const combined = { ...(raw || {}), ...(detail || {}) };
  const path = `${side}.players.${index}`;
  return {
    participantId,
    name: metadata?.summonerName || combined?.summonerName || combined?.name || null,
    champion: metadata?.championId || combined?.championId || combined?.championName || null,
    role: metadata?.role || combined?.role || null,
    level: numberField(combined?.level, `${path}.level`, missing),
    kills: numberField(combined?.kills, `${path}.kills`, missing),
    deaths: numberField(combined?.deaths, `${path}.deaths`, missing),
    assists: numberField(combined?.assists, `${path}.assists`, missing),
    creepScore: numberField(combined?.creepScore ?? combined?.cs ?? combined?.minionsKilled, `${path}.creepScore`, missing),
    totalGold: numberField(combined?.totalGold ?? combined?.totalGoldEarned ?? combined?.gold, `${path}.totalGold`, missing),
    currentGold: finiteOrNull(combined?.currentGold),
    items: Array.isArray(combined?.items) ? combined.items : null
  };
}

function normalizeSide(frame, side, teamMetadata, detailedById, info, missing) {
  const rawTeam = teamFrame(frame, side);
  const metadataById = metadataMap(teamMetadata);
  const rawPlayers = Array.isArray(rawTeam?.participants) ? rawTeam.participants : [];
  if (!rawPlayers.length) missing.push(`${side}.players`);
  const dragonData = normalizeDragonData(rawTeam?.dragons);
  if (dragonData.missing) missing.push(`${side}.dragons`);
  return {
    id: String(info?.id || teamMetadata?.esportsTeamId || ''),
    side,
    name: info?.name || (side === 'blue' ? 'Blue side' : 'Red side'),
    code: info?.code || null,
    image: info?.image || null,
    gold: numberField(rawTeam?.totalGold ?? rawTeam?.gold, `${side}.gold`, missing),
    kills: numberField(rawTeam?.totalKills ?? rawTeam?.kills, `${side}.kills`, missing),
    towers: numberField(rawTeam?.towers ?? rawTeam?.towerKills ?? rawTeam?.turretsDestroyed, `${side}.towers`, missing),
    inhibitors: finiteOrNull(rawTeam?.inhibitors ?? rawTeam?.inhibitorKills),
    barons: numberField(rawTeam?.barons ?? rawTeam?.baronKills, `${side}.barons`, missing),
    heralds: finiteOrNull(rawTeam?.heralds ?? rawTeam?.riftHeraldKills),
    dragons: dragonData.dragons,
    dragonCount: dragonData.dragonCount,
    players: rawPlayers.map((player, index) => normalizePlayer(player, index, metadataById, detailedById, side, missing))
  };
}

export function lineupSide(side, teamMetadata, info) {
  return {
    id: String(info?.id || teamMetadata?.esportsTeamId || ''),
    side,
    name: info?.name || (side === 'blue' ? 'Blue side' : 'Red side'),
    code: info?.code || null,
    image: info?.image || null,
    gold: null,
    kills: null,
    towers: null,
    inhibitors: null,
    barons: null,
    heralds: null,
    dragons: null,
    dragonCount: null,
    players: (teamMetadata?.participantMetadata || []).map((player, index) => ({
      participantId: integerOrNull(player?.participantId) ?? index + 1,
      name: player?.summonerName || null,
      champion: player?.championId || null,
      role: player?.role || null,
      level: null,
      kills: null,
      deaths: null,
      assists: null,
      creepScore: null,
      totalGold: null,
      currentGold: null,
      items: null
    }))
  };
}

export function seriesTeams(event) {
  return (event?.match?.teams || []).map(team => ({
    id: String(team?.id || ''),
    name: team?.name || null,
    code: team?.code || null,
    image: team?.image || null,
    wins: finiteOrNull(team?.result?.gameWins)
  }));
}

function gameStartFromVod(event, gameId) {
  const game = (event?.match?.games || []).find(item => String(item?.id) === String(gameId));
  for (const vod of game?.vods || []) {
    const firstFrame = parseTimestamp(vod?.firstFrameTime);
    const offset = finiteOrNull(vod?.startMillis);
    if (firstFrame !== null && offset !== null) return firstFrame + offset;
  }
  return null;
}

function summarize(blue, red) {
  if (blue?.gold === null || red?.gold === null) return 'Gold totals are unavailable in the current verified frame.';
  const goldDiff = blue.gold - red.gold;
  const kills = blue.kills === null || red.kills === null ? 'unknown' : `${blue.kills}-${red.kills}`;
  const towers = blue.towers === null || red.towers === null ? 'unknown' : `${blue.towers}-${red.towers}`;
  if (goldDiff === 0) return `Gold is even. Kills are ${kills}; towers are ${towers}.`;
  const leader = goldDiff > 0 ? blue : red;
  return `${leader.name} leads by ${Math.abs(goldDiff).toLocaleString('en-US')} gold. Kills are ${kills}; towers are ${towers}.`;
}

export function normalizeGameplay({ candidate, event, gameId, detailedPayload, afterMs }) {
  const metadata = candidate?.payload?.gameMetadata || candidate?.frame?.gameMetadata || {};
  const blueMetadata = metadata?.blueTeamMetadata || {};
  const redMetadata = metadata?.redTeamMetadata || {};
  const blueInfo = teamInfo(event, blueMetadata, gameId, 'blue');
  const redInfo = teamInfo(event, redMetadata, gameId, 'red');
  const missingFields = [];
  const detailedById = detailsMap(latestFrame(detailedPayload));
  const blue = normalizeSide(candidate.frame, 'blue', blueMetadata, detailedById, blueInfo, missingFields);
  const red = normalizeSide(candidate.frame, 'red', redMetadata, detailedById, redInfo, missingFields);
  const teamMappingVerified = Boolean(blue.id && red.id && blue.id !== red.id);
  const criticalExact = new Set([
    'blue.gold', 'red.gold', 'blue.kills', 'red.kills', 'blue.towers', 'red.towers',
    'blue.barons', 'red.barons', 'blue.dragons', 'red.dragons', 'blue.players', 'red.players'
  ]);
  const criticalMissingFields = missingFields.filter(path => criticalExact.has(path));
  if (blue.players.length !== 5) criticalMissingFields.push('blue.players.count');
  if (red.players.length !== 5) criticalMissingFields.push('red.players.count');
  if (!teamMappingVerified) criticalMissingFields.push('teamMapping');
  const safeForLiveAnalysis = candidate.timestampQuality.freshness === 'fresh'
    && teamMappingVerified && criticalMissingFields.length === 0;
  const startMs = gameStartFromVod(event, gameId);
  const clockSeconds = startMs !== null && candidate.timestampMs >= startMs
    ? Math.round((candidate.timestampMs - startMs) / 1000)
    : null;
  return {
    metadata,
    blue,
    red,
    clock: formatClock(clockSeconds),
    clockSeconds,
    quality: {
      timestampValid: true,
      freshness: candidate.timestampQuality.freshness,
      frameAgeSeconds: candidate.timestampQuality.dataAgeSeconds,
      futureSkewSeconds: candidate.timestampQuality.futureSkewSeconds,
      telemetryAdvancing: afterMs === null ? null : candidate.timestampMs > afterMs,
      teamMappingVerified,
      detailsAvailable: Boolean(latestFrame(detailedPayload)),
      criticalMissingFields: [...new Set(criticalMissingFields)],
      missingFields: [...new Set(missingFields)],
      safeForLiveAnalysis
    },
    differences: {
      gold: subtract(blue.gold, red.gold),
      kills: subtract(blue.kills, red.kills),
      towers: subtract(blue.towers, red.towers),
      dragons: subtract(blue.dragonCount, red.dragonCount),
      barons: subtract(blue.barons, red.barons)
    },
    summary: summarize(blue, red)
  };
}

export function pregameTeams(candidate, event, gameId) {
  const metadata = candidate?.payload?.gameMetadata || candidate?.frame?.gameMetadata || {};
  const blueMetadata = metadata?.blueTeamMetadata || {};
  const redMetadata = metadata?.redTeamMetadata || {};
  const blue = lineupSide('blue', blueMetadata, teamInfo(event, blueMetadata, gameId, 'blue'));
  const red = lineupSide('red', redMetadata, teamInfo(event, redMetadata, gameId, 'red'));
  return { metadata, blue, red, teamMappingVerified: Boolean(blue.id && red.id && blue.id !== red.id) };
}
