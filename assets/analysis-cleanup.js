// Final presentation cleanup for the live analysis workspace.
(() => {
  'use strict';

  let scheduled = false;

  function integer(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }

  function seriesScore(snapshot) {
    const event = typeof selectedScheduleEvent === 'function' ? selectedScheduleEvent() : null;
    const eventTeams = event?.match?.teams || [];
    if (eventTeams.length >= 2) {
      return `${integer(eventTeams[0]?.result?.gameWins)}–${integer(eventTeams[1]?.result?.gameWins)}`;
    }

    const teams = Array.isArray(snapshot?.series?.teams) ? snapshot.series.teams : [];
    if (teams.length >= 2) return `${integer(teams[0]?.wins)}–${integer(teams[1]?.wins)}`;
    return null;
  }

  function criticalMissing(snapshot) {
    return Array.isArray(snapshot?.quality?.criticalMissingFields)
      ? snapshot.quality.criticalMissingFields.filter(Boolean)
      : [];
  }

  function frameAge(snapshot) {
    const parsed = Number(snapshot?.quality?.frameAgeSeconds ?? snapshot?.source?.dataAgeSeconds);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function applyScoreboardCleanup(snapshot) {
    const scoreboard = gameContent?.querySelector?.('.analysis-v2-scoreboard');
    scoreboard?.querySelector?.('.analysis-v2-score-center')?.remove?.();

    const meta = gameContent?.querySelector?.('.analysis-v2-header-meta');
    if (!meta) return;

    const score = seriesScore(snapshot);
    let chip = meta.querySelector('.analysis-v2-series-score');
    if (!score) {
      chip?.remove();
      return;
    }

    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'analysis-v2-series-score';
      const quality = meta.querySelector('.analysis-v2-quality');
      meta.insertBefore(chip, quality || meta.firstChild);
    }
    setText(chip, `Series ${score}`);
  }

  function applyFreshnessPresentation(snapshot) {
    if (snapshot?.status !== 'degraded') return;

    const fields = criticalMissing(snapshot);
    if (fields.length !== 0) return;

    const age = frameAge(snapshot);
    const ageText = age === null ? '' : ` Riot’s latest frame is ${age}s old.`;
    const quality = gameContent?.querySelector?.('.analysis-v2-quality');
    if (quality) {
      quality.classList.add('is-delayed');
      setText(quality, 'Full stats · delayed');
    }

    const banner = gameContent?.querySelector?.('.authority-context-banner');
    if (banner) {
      banner.classList.add('is-delayed');
      setText(banner.querySelector('strong'), 'Delayed live frame');
      setText(
        banner.querySelector('span'),
        `Score, gold, objectives, KDA, CS and available player details are loaded.${ageText} Betting verification remains paused until a fresher frame arrives.`
      );
    }

    if (typeof setConnection === 'function') {
      setConnection(`LIVE · full stats${age === null ? '' : ` · ${age}s delayed`}`, 'live');
    }
  }

  function apply() {
    scheduled = false;
    const snapshot = typeof state === 'object' ? state?.lastSnapshot : null;
    if (!snapshot || !gameContent?.querySelector) return;
    applyScoreboardCleanup(snapshot);
    applyFreshnessPresentation(snapshot);
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(apply);
  }

  const observer = new MutationObserver(scheduleApply);
  observer.observe(gameContent, { childList: true, subtree: true, characterData: true });
  scheduleApply();
})();
