// Keeps the bookmaker panel inside the dedicated analysis-odds region.
// Retains the actual panel node while gameContent is replaced during telemetry refreshes.
(() => {
  'use strict';

  const PANEL_ID = 'bookmakerOddsPanel';
  const SLOT_ID = 'analysisOddsSlot';
  let panelRef = null;
  let placementQueued = false;

  function capturePanel() {
    const attached = document.getElementById(PANEL_ID);
    if (attached) panelRef = attached;
    return panelRef;
  }

  function placeOddsPanel() {
    placementQueued = false;

    const panel = capturePanel();
    const slot = gameContent?.querySelector(`#${SLOT_ID}`);
    if (!slot || !state?.selectedEventId) return;

    if (!panel) {
      slot.classList.remove('has-odds');
      return;
    }

    if (panel.parentNode !== slot) slot.appendChild(panel);
    slot.classList.add('has-odds');
    slot.querySelector('[data-odds-placeholder]')?.setAttribute('hidden', '');
  }

  function queuePlacement(useMicrotask = false) {
    capturePanel();
    if (placementQueued) return;
    placementQueued = true;

    if (useMicrotask) queueMicrotask(placeOddsPanel);
    else requestAnimationFrame(placeOddsPanel);
  }

  const gamePanel = gameContent?.parentElement;
  if (gamePanel) {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.id === PANEL_ID) panelRef = node;
          else {
            const nested = node.querySelector?.(`#${PANEL_ID}`);
            if (nested) panelRef = nested;
          }
        }
      }
      queuePlacement(true);
    });
    observer.observe(gamePanel, { childList: true, subtree: true });
  }

  const previousRenderGame = renderGame;
  renderGame = function oddsSlotRenderGame(...args) {
    capturePanel();
    const result = previousRenderGame(...args);
    queuePlacement(true);
    return result;
  };

  capturePanel();
  queuePlacement();
  // Covers delayed bridge responses and panels rebuilt by the polling layer.
  setInterval(() => queuePlacement(), 500);
})();