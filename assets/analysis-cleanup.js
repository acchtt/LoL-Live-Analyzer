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

  function applySeriesHeroPresentation(snapshot, age) {
    const hero = gameContent?.querySelector?.('.series-hero--live');
    if (!hero) return;

    setText(hero.querySelector('.series-hero-kicker strong'), 'Delayed live data');

    const score = hero.querySelector('.series-hero-score');
    score?.classList.remove('is-live', 'is-stale');
    score?.classList.add('is-pending');
    setText(score?.querySelector(':scope > span'), 'Delayed');
    const gameNumber = snapshot?.match?.gameNumber ?? '?';
    setText(
      score?.querySelector(':scope > small'),
      age === null ? `Latest delayed Riot frame · Game ${gameNumber}` : `${age}s behind · Game ${gameNumber}`
    );

    const badge = hero.querySelector('.series-hero-badge');
    badge?.classList.remove('is-live', 'is-stale');
    badge?.classList.add('is-pending');
    setText(badge?.querySelector('span'), 'Delayed frame');

    const selectedGame = hero.querySelector('.series-hero-game.is-selected');
    selectedGame?.classList.remove('is-live', 'is-stale');
    selectedGame?.classList.add('is-waiting');
    setText(selectedGame?.querySelector('small'), 'Delayed');

    const contextLabels = hero.querySelectorAll('.series-hero-context > span:not(.series-hero-context-icon)');
    setText(contextLabels?.[0], 'Delayed live data');
  }

  function applyFreshnessPresentation(snapshot) {
    if (snapshot?.status !== 'degraded') return;

    const fields = criticalMissing(snapshot);
    if (fields.length !== 0) return;

    const age = frameAge(snapshot);
    const ageText = age === null ? '' : ` Riot’s latest frame is ${age}s behind the current time.`;
    const quality = gameContent?.querySelector?.('.analysis-v2-quality');
    if (quality) {
      quality.classList.add('is-delayed');
      setText(quality, 'Full stats · delayed');
    }

    const banner = gameContent?.querySelector?.('.authority-context-banner');
    if (banner) {
      banner.classList.remove('is-stale');
      banner.classList.add('is-delayed');
      setText(banner.querySelector('strong'), 'Delayed live telemetry');
      setText(
        banner.querySelector('span'),
        `Score, gold, objectives, KDA, CS and available player details are loaded.${ageText} RiftPulse is polling for newer Riot frames; betting verification remains paused until a fresh frame arrives.`
      );
    }

    applySeriesHeroPresentation(snapshot, age);

    if (typeof setConnection === 'function') {
      setConnection(`LIVE · delayed telemetry${age === null ? '' : ` · ${age}s behind`}`, 'live');
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
