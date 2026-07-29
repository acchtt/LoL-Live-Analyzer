// Rebuilds the map overview into a readable gold summary and objective comparison dashboard.
(() => {
  'use strict';

  const root = document.getElementById('gameContent');
  if (!root) return;

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function integer(value) {
    const parsed = finiteNumber(value);
    return parsed === null ? '—' : String(Math.round(parsed));
  }

  function count(value) {
    return Array.isArray(value) ? String(value.length) : integer(value);
  }

  function formatted(value) {
    const parsed = finiteNumber(value);
    return parsed === null ? '—' : Math.round(parsed).toLocaleString('en-US');
  }

  function goldDifference(snapshot, blueGold, redGold) {
    const reported = finiteNumber(snapshot?.differences?.gold);
    if (reported !== null) return reported;
    return blueGold !== null && redGold !== null ? blueGold - redGold : null;
  }

  function objectiveCard(label, blueValue, redValue) {
    const blueNumber = finiteNumber(blueValue);
    const redNumber = finiteNumber(redValue);
    const total = blueNumber !== null && redNumber !== null ? blueNumber + redNumber : null;
    const blueShare = total !== null && total > 0 ? Math.round((blueNumber / total) * 1000) / 10 : 50;
    const redShare = total !== null && total > 0 ? Math.round((redNumber / total) * 1000) / 10 : 50;

    return `<article class="overview-objective-v2">
      <div class="overview-objective-value is-blue">
        <strong>${escapeHtml(integer(blueValue))}</strong>
        <small>Blue</small>
      </div>
      <div class="overview-objective-center">
        <span>${escapeHtml(label)}</span>
        <div class="overview-objective-track" aria-hidden="true">
          <i class="is-blue" style="--share:${blueShare}%"></i>
          <i class="is-red" style="--share:${redShare}%"></i>
        </div>
      </div>
      <div class="overview-objective-value is-red">
        <strong>${escapeHtml(integer(redValue))}</strong>
        <small>Red</small>
      </div>
    </article>`;
  }

  function enhanceOverview(section) {
    if (!(section instanceof HTMLElement) || section.dataset.overviewPanelV2 === 'true') return;

    const content = section.querySelector('.analysis-v2-state-content');
    const snapshot = globalThis.state?.lastSnapshot;
    if (!content || !snapshot) return;

    const blue = snapshot.blue || {};
    const red = snapshot.red || {};
    const blueName = blue.name || 'Blue side';
    const redName = red.name || 'Red side';
    const blueGold = finiteNumber(blue.gold);
    const redGold = finiteNumber(red.gold);
    const difference = goldDifference(snapshot, blueGold, redGold);

    let leadValue = '—';
    let leadDetail = 'Gold difference unavailable';
    let leadClass = 'is-even';

    if (difference !== null) {
      if (difference === 0) {
        leadValue = 'Even';
        leadDetail = 'No gold advantage';
      } else {
        leadValue = `+${formatted(Math.abs(difference))}`;
        leadDetail = `${difference > 0 ? blueName : redName} lead`;
        leadClass = difference > 0 ? 'is-blue' : 'is-red';
      }
    }

    const dashboard = document.createElement('div');
    dashboard.className = 'overview-panel-v2';
    dashboard.innerHTML = `
      <section class="overview-gold-summary" aria-label="Team gold comparison">
        <article class="overview-gold-team is-blue">
          <span>Blue side</span>
          <strong>${escapeHtml(blueName)}</strong>
          <b>${escapeHtml(formatted(blue.gold))}<small> gold</small></b>
        </article>
        <article class="overview-gold-lead ${leadClass}">
          <span>Gold advantage</span>
          <strong>${escapeHtml(leadValue)}</strong>
          <small>${escapeHtml(leadDetail)}</small>
        </article>
        <article class="overview-gold-team is-red">
          <span>Red side</span>
          <strong>${escapeHtml(redName)}</strong>
          <b>${escapeHtml(formatted(red.gold))}<small> gold</small></b>
        </article>
      </section>
      <section class="overview-objective-grid-v2" aria-label="Objective comparison">
        ${objectiveCard('Towers', blue.towers, red.towers)}
        ${objectiveCard('Dragons', Array.isArray(blue.dragons) ? blue.dragons.length : blue.dragons, Array.isArray(red.dragons) ? red.dragons.length : red.dragons)}
        ${objectiveCard('Barons', blue.barons, red.barons)}
        ${objectiveCard('Inhibitors', blue.inhibitors, red.inhibitors)}
      </section>`;

    content.replaceChildren(dashboard);
    section.dataset.overviewPanelV2 = 'true';
  }

  function enhanceAll() {
    root.querySelectorAll('.analysis-v2-state').forEach(enhanceOverview);
  }

  const observer = new MutationObserver(enhanceAll);
  observer.observe(root, { childList: true, subtree: true });
  queueMicrotask(enhanceAll);
})();