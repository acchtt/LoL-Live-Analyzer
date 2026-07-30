// Selects the first active schedule event once, so the analysis workspace does not open blank.
(() => {
  'use strict';

  let selectionStarted = false;

  function preferredEvent() {
    const events = Array.isArray(state.events) ? state.events : [];
    return events.find(event => displayState(event) === 'inProgress')
      || events.find(event => displayState(event) === 'starting')
      || events.find(event => displayState(event) === 'unstarted')
      || null;
  }

  function selectInitialMatch() {
    if (selectionStarted || state.selectedEventId) return;
    const event = preferredEvent();
    const id = event ? eventId(event) : '';
    if (!id) return;

    selectionStarted = true;
    Promise.resolve(selectEvent(id)).catch(error => {
      selectionStarted = false;
      setConnection(error?.message || 'Unable to open the first match', 'error');
    });
  }

  const observer = new MutationObserver(() => queueMicrotask(selectInitialMatch));
  observer.observe(scheduleList, { childList: true, subtree: true });

  queueMicrotask(selectInitialMatch);
  window.addEventListener('load', selectInitialMatch, { once: true });
})();
