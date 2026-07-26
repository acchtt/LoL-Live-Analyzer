// Uses a rotating path token so chat clients fetch a fresh feed instead of reusing an old tool result.
(() => {
  const BUILD = '20260726-31';
  const ROTATE_MS = 10_000;

  function freshToken() {
    return `f${Date.now().toString(36)}`;
  }

  function rotatingFeedUrl(gameId, historical = false) {
    const base = `${WORKER_BASE}/api/chatgpt/${encodeURIComponent(gameId)}/${freshToken()}`;
    return historical ? `${base}?historical=1` : base;
  }

  function currentGameId() {
    return String(state.selectedGameId || state.lastSnapshot?.source?.gameId || '');
  }

  function refreshDisplayedFeedUrl() {
    const gameId = currentGameId();
    if (!gameId) return;
    jsonUrl.value = rotatingFeedUrl(gameId, state.selectedMatchState === 'completed');
    copyJsonUrl.disabled = false;
  }

  setJsonEndpoint = function rotatingPathJsonEndpoint(gameId, historical = false) {
    if (!gameId) {
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      return;
    }
    jsonUrl.value = rotatingFeedUrl(gameId, historical);
    copyJsonUrl.disabled = false;
  };

  refreshDisplayedFeedUrl();
  setInterval(() => {
    if (!document.hidden) refreshDisplayedFeedUrl();
  }, ROTATE_MS);

  window.addEventListener('focus', refreshDisplayedFeedUrl);

  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark"> Rotating feed URL · ${BUILD}</span>`);
})();
