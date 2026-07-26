// Uses a path-based public feed URL so chat clients do not split the query string.
(() => {
  const BUILD = '20260726-29';

  function cleanFeedUrl(gameId, historical = false) {
    const base = `${WORKER_BASE}/api/chatgpt/${encodeURIComponent(gameId)}`;
    return historical ? `${base}?historical=1` : base;
  }

  setJsonEndpoint = function pathBasedJsonEndpoint(gameId, historical = false) {
    if (!gameId) {
      jsonUrl.value = '';
      copyJsonUrl.disabled = true;
      return;
    }
    jsonUrl.value = cleanFeedUrl(gameId, historical);
    copyJsonUrl.disabled = false;
  };

  const currentGameId = String(state.selectedGameId || state.lastSnapshot?.source?.gameId || '');
  if (currentGameId) setJsonEndpoint(currentGameId, state.selectedMatchState === 'completed');

  const footer = document.querySelector('footer');
  if (footer) footer.insertAdjacentHTML('beforeend', `<span class="build-mark"> Clean feed URL · ${BUILD}</span>`);
})();
