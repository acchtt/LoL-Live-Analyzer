// Rebuilds live and historical series headers into one readable scoreboard component.
(() => {
  'use strict';

  const root = document.getElementById('gameContent');
  if (!root) return;

  function scoreValues(score) {
    const text = score?.querySelector(':scope > strong')?.textContent || '';
    const values = text.split(/[–-]/).map(value => value.trim());
    return values.length >= 2 ? values : ['—', '—'];
  }

  function teamCopy(team, wins, side) {
    const logo = team.querySelector('.series-hero-team-logo');
    const name = team.querySelector(':scope > strong');
    if (!logo || !name) return;

    const copy = document.createElement('span');
    copy.className = 'series-scoreboard-team-copy';
    copy.append(name);

    const detail = document.createElement('small');
    detail.className = 'series-scoreboard-team-result';
    detail.textContent = wins === '—'
      ? 'Series score unavailable'
      : `${wins} series win${wins === '1' ? '' : 's'}`;
    copy.append(detail);

    team.classList.add('series-scoreboard-team', `is-team-${side}`);
    team.replaceChildren();
    if (side === 'a') team.append(copy, logo);
    else team.append(logo, copy);
  }

  function enhanceSeriesScoreboard(hero) {
    if (!(hero instanceof HTMLElement) || hero.dataset.seriesScoreboardV3 === 'true') return;

    const top = hero.querySelector('.series-hero-top');
    const kicker = hero.querySelector('.series-hero-kicker');
    const matchup = hero.querySelector('.series-hero-matchup');
    const leftTeam = matchup?.querySelector('.series-hero-team.is-left');
    const rightTeam = matchup?.querySelector('.series-hero-team.is-right');
    const score = hero.querySelector('.series-hero-score');
    const games = hero.querySelector('.series-hero-games');
    const actions = hero.querySelector('.series-hero-actions');
    const historyBadge = hero.querySelector('.history-archive-badge');
    const context = hero.querySelector('.series-hero-context');

    if (!top || !kicker || !matchup || !leftTeam || !rightTeam || !score || !games) return;

    const [leftWins, rightWins] = scoreValues(score);
    teamCopy(leftTeam, leftWins, 'a');
    teamCopy(rightTeam, rightWins, 'b');

    score.classList.add('series-scoreboard-score');
    matchup.querySelector('.series-hero-versus')?.remove();

    const meta = document.createElement('div');
    meta.className = 'series-scoreboard-meta';

    const metaPrimary = document.createElement('div');
    metaPrimary.className = 'series-scoreboard-meta-primary';
    metaPrimary.append(kicker);

    const metaContext = document.createElement('div');
    metaContext.className = 'series-scoreboard-meta-context';
    if (context) metaContext.append(context);

    const metaActions = document.createElement('div');
    metaActions.className = 'series-scoreboard-meta-actions';
    const controls = actions || historyBadge;
    if (controls) metaActions.append(controls);

    const returnButton = metaActions.querySelector('[data-return-live-game]');
    if (returnButton) {
      returnButton.textContent = 'Back to live';
      returnButton.setAttribute('aria-label', 'Return to the active live game');
    }

    meta.append(metaPrimary, metaContext, metaActions);

    const main = document.createElement('div');
    main.className = 'series-scoreboard-main';
    main.append(leftTeam, score, rightTeam);

    const navigation = document.createElement('div');
    navigation.className = 'series-scoreboard-navigation';
    navigation.append(games);

    hero.replaceChildren(meta, main, navigation);
    hero.dataset.seriesScoreboardV3 = 'true';
  }

  function enhanceAll() {
    root.querySelectorAll('.series-hero').forEach(enhanceSeriesScoreboard);
  }

  const observer = new MutationObserver(enhanceAll);
  observer.observe(root, { childList: true, subtree: true });
  queueMicrotask(enhanceAll);
})();
