// Exposes the existing global lexical app state to the unified series renderer.
(() => {
  'use strict';
  if (typeof state === 'object' && state) globalThis.state = state;
  if (typeof eventTeams === 'function') globalThis.eventTeams = eventTeams;
  globalThis.RiftPulseUnifiedSeriesPanel?.render?.();
})();
