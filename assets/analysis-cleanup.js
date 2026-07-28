// Final presentation cleanup for delayed-but-complete live frames.
(() => {
  'use strict';

  let scheduled = false;

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