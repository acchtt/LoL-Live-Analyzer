// Rebuilds the map overview into a clear side-led gold and objective comparison.
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
      <strong class="overview-objective-number is-blue">${escapeHtml(integer(blueValue))}</strong>
      <div class="overview-objective-center">
        <span>${escapeHtml(label)}</span>
        <div class="overview-objective-track" aria-label="Blue ${escapeHtml(integer(blueValue))}, Red ${escapeHtml(integer(redValue))}">
          <i class="is-blue" style="--share:${blueShare}%"></i>
          <i class="is-red" style="--share:${redShare}%"></i>
        </div>
      </div>
      <strong class="overview-objective-number is-red">${escapeHtml(integer(redValue))}</strong>
    </article>`;
  }

  function enhanceOverview(section) {
    if (!(section instanceof HTMLElement) || section.dataset.overviewPanelV2 === 'true') return;

    const content = section.querySelector('.analysis-v2-state-content');
    const snapshot = typeof state === 'object' && state ? state.lastSnapshot : null;
    if (!content || !snapshot) return;

    const blue = snapshot.blue || {};
    const red = snapshot.red || {};
    const blueName = blue.name || 'Blue team';
    const redName = red.name || 'Red team';
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

    const legend = section.querySelector('.analysis-v2-state-legend');
    if (legend) {
      legend.innerHTML = '<span class="overview-side-key is-blue"><i></i>Blue</span><span class="overview-side-key is-red"><i></i>Red</span>';
      legend.setAttribute('aria-label', 'Blue and red side color key');
    }

    const dashboard = document.createElement('div');
    dashboard.className = 'overview-panel-v2';
    dashboard.innerHTML = `
      <section class="overview-gold-summary" aria-label="Team gold comparison">
        <article class="overview-gold-team is-blue">
          <span class="overview-side-badge">Blue</span>
          <strong>${escapeHtml(blueName)}</strong>
          <b>${escapeHtml(formatted(blue.gold))}<small>gold</small></b>
        </article>
        <article class="overview-gold-lead ${leadClass}">
          <span>Gold lead</span>
          <strong>${escapeHtml(leadValue)}</strong>
          <small>${escapeHtml(leadDetail)}</small>
        </article>
        <article class="overview-gold-team is-red">
          <span class="overview-side-badge">Red</span>
          <strong>${escapeHtml(redName)}</strong>
          <b>${escapeHtml(formatted(red.gold))}<small>gold</small></b>
        </article>
      </section>
      <section class="overview-objective-grid-v2" aria-label="Objective comparison; blue values are left and red values are right">
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