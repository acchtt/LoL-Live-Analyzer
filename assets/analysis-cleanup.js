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

  function retrievalMs(snapshot) {
    const parsed = Number(snapshot?.retrieval?.totalMs);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }

  function responseAgeMs(snapshot, nowMs = Date.now()) {
    const generatedAt = Date.parse(snapshot?.updatedAt || '');
    return Number.isFinite(generatedAt) ? Math.max(0, Math.round(nowMs - generatedAt)) : null;
  }

  function durationLabel(seconds) {
    if (!Number.isFinite(seconds)) return null;
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }

  function millisecondsLabel(milliseconds) {
    if (!Number.isFinite(milliseconds)) return null;
    if (milliseconds < 1000) return '<1s';
    return durationLabel(Math.round(milliseconds / 1000));
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function applySeriesHeroPresentation(snapshot, ageLabel) {
    const hero = gameContent?.querySelector?.('.series-hero--live');
    if (!hero) return;

    setText(hero.querySelector('.series-hero-kicker strong'), 'Riot feed delayed');

    const score = hero.querySelector('.series-hero-score');
    score?.classList.remove('is-live', 'is-stale');
    score?.classList.add('is-pending');
    setText(score?.querySelector(':scope > span'), 'Delayed');
    const gameNumber = snapshot?.match?.gameNumber ?? '?';
    setText(
      score?.querySelector(':scope > small'),
      ageLabel ? `${ageLabel} source lag · Game ${gameNumber}` : `Latest delayed Riot frame · Game ${gameNumber}`
    );

    const badge = hero.querySelector('.series-hero-badge');
    badge?.classList.remove('is-live', 'is-stale');
    badge?.classList.add('is-pending');
    setText(badge?.querySelector('span'), 'Riot feed delayed');

    const selectedGame = hero.querySelector('.series-hero-game.is-selected');
    selectedGame?.classList.remove('is-live', 'is-stale');
    selectedGame?.classList.add('is-waiting');
    setText(selectedGame?.querySelector('small'), 'Source delayed');

    const contextLabels = hero.querySelectorAll('.series-hero-context > span:not(.series-hero-context-icon)');
    setText(contextLabels?.[0], 'Riot feed delayed');
  }

  function applyFreshnessPresentation(snapshot) {
    if (snapshot?.status !== 'degraded') return;

    const fields = criticalMissing(snapshot);
    if (fields.length !== 0) return;

    const age = frameAge(snapshot);
    const ageLabel = durationLabel(age);
    const requestMs = retrievalMs(snapshot);
    const displayAgeLabel = millisecondsLabel(responseAgeMs(snapshot));
    const sourceText = ageLabel
      ? `The newest frame Riot returned is ${ageLabel} behind the current time.`
      : 'Riot returned a delayed gameplay frame.';
    const retrievalText = requestMs === null
      ? ''
      : ` RiftPulse retrieved and processed this response in ${requestMs}ms.`;
    const displayText = displayAgeLabel === null
      ? ''
      : ` The displayed Worker response was generated ${displayAgeLabel} ago.`;

    const quality = gameContent?.querySelector?.('.analysis-v2-quality');
    if (quality) {
      quality.classList.add('is-delayed');
      setText(quality, 'Full stats · Riot source delayed');
    }

    const banner = gameContent?.querySelector?.('.authority-context-banner');
    if (banner) {
      banner.classList.remove('is-stale');
      banner.classList.add('is-delayed');
      setText(banner.querySelector('strong'), 'Riot feed delayed');
      setText(
        banner.querySelector('span'),
        `Score, gold, objectives, KDA, CS and available player details are loaded. ${sourceText}${retrievalText}${displayText} RiftPulse is polling for the next published frame; betting verification remains paused until Riot advances to a fresh frame.`
      );
    }

    applySeriesHeroPresentation(snapshot, ageLabel);

    if (typeof setConnection === 'function') {
      const lag = ageLabel ? ` · ${ageLabel} source lag` : '';
      const retrieval = requestMs === null ? '' : ` · ${requestMs}ms retrieval`;
      const display = displayAgeLabel === null ? '' : ` · ${displayAgeLabel} dashboard response age`;
      setConnection(`RIOT FEED DELAYED${lag}${retrieval}${display}`, 'live');
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
