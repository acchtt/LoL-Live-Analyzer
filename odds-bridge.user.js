// ==UserScript==
// @name         LoL Live Analyzer - BK8/IME Odds Bridge
// @namespace    https://github.com/acchtt/LoL-Live-Analyzer
// @version      1.0.0
// @description  Captures sanitized eSportsBull market responses and sends them to your private Cloudflare Worker bridge.
// @author       LoL Live Analyzer
// @match        https://*.dotnapu.com/*
// @include      /^https:\/\/[^/]*\.dotnapu\.com(?::\d+)?\//
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      lol-live-analyzer-api.acchtt.workers.dev
// ==/UserScript==

(() => {
  'use strict';

  const TARGET_FRAGMENT = '/api/GetMatchDetailsByParentV2';
  const DEFAULT_WORKER = 'https://lol-live-analyzer-api.acchtt.workers.dev';
  const SECRET_KEY = 'oddsBridgeSecret';
  const WORKER_KEY = 'oddsBridgeWorker';
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  let badge = null;
  let lastPayload = null;
  let lastFingerprint = '';
  let sendTimer = null;
  let sending = false;

  function workerBase() {
    return String(GM_getValue(WORKER_KEY, DEFAULT_WORKER) || DEFAULT_WORKER).replace(/\/+$/, '');
  }

  function bridgeSecret() {
    return String(GM_getValue(SECRET_KEY, '') || '').trim();
  }

  function setBadge(message, state = 'idle') {
    if (!badge) createBadge();
    if (!badge) return;
    badge.textContent = message;
    badge.dataset.state = state;
    const colors = {
      idle: ['#182033', '#cbd5e1'],
      waiting: ['#332d18', '#fde68a'],
      sending: ['#172554', '#bfdbfe'],
      ok: ['#123524', '#bbf7d0'],
      error: ['#3f1717', '#fecaca']
    };
    const [background, color] = colors[state] || colors.idle;
    badge.style.background = background;
    badge.style.color = color;
  }

  function createBadge() {
    if (badge || !document.documentElement) return;
    badge = document.createElement('button');
    badge.type = 'button';
    badge.title = 'Click to configure the private odds bridge secret.';
    badge.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'border:1px solid rgba(255,255,255,.18)',
      'border-radius:9px',
      'padding:8px 11px',
      'font:12px/1.35 system-ui,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,.28)',
      'cursor:pointer',
      'max-width:320px',
      'text-align:left'
    ].join(';');
    badge.addEventListener('click', configureSecret);
    document.documentElement.appendChild(badge);
    setBadge(bridgeSecret() ? 'Odds bridge ready · waiting for odds' : 'Odds bridge · click to set secret', bridgeSecret() ? 'waiting' : 'idle');
  }

  function configureSecret() {
    const current = bridgeSecret();
    const value = prompt(
      'Paste ODDS_BRIDGE_SECRET. It stays in Tampermonkey storage on this browser and is never placed in the page or repository.',
      current
    );
    if (value === null) return;
    const secret = String(value).trim();
    if (!secret) {
      GM_deleteValue(SECRET_KEY);
      setBadge('Odds bridge · secret cleared', 'idle');
      return;
    }
    GM_setValue(SECRET_KEY, secret);
    setBadge('Odds bridge ready · waiting for odds', 'waiting');
    if (lastPayload) queueSend(lastPayload, true);
  }

  function configureWorker() {
    const value = prompt('Cloudflare Worker base URL:', workerBase());
    if (value === null) return;
    const normalized = String(value).trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(normalized)) {
      setBadge('Odds bridge · invalid Worker URL', 'error');
      return;
    }
    GM_setValue(WORKER_KEY, normalized);
    setBadge('Odds bridge · Worker URL updated', 'ok');
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function integer(value) {
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
  }

  function cleanText(value, fallback = '') {
    return String(value ?? fallback).trim();
  }

  function selectionSide(rawName, code) {
    const name = cleanText(rawName).toLowerCase();
    if (name === 'tài' || name === 'over') return 'over';
    if (name === 'xỉu' || name === 'under') return 'under';
    if (name.includes('{teama}') || Number(code) === 1) return 'home';
    if (name.includes('{teamb}') || Number(code) === 2) return 'away';
    return null;
  }

  function selectionName(rawName, homeName, awayName, handicap) {
    const hdp = handicap === null ? '' : String(Math.abs(handicap));
    return cleanText(rawName)
      .replaceAll('{TeamA}', homeName)
      .replaceAll('{TeamB}', awayName)
      .replaceAll('{HDP}', hdp)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeLine(group, homeName, awayName) {
    const selections = (Array.isArray(group?.SEL) ? group.SEL : []).map(selection => {
      const handicap = finite(selection?.HDP);
      return {
        code: integer(selection?.SCode),
        name: selectionName(selection?.SName, homeName, awayName, handicap),
        side: selectionSide(selection?.SName, selection?.SCode),
        handicap,
        odds: finite(selection?.Odds),
        locked: Boolean(selection?.IsLock),
        prompt: Boolean(selection?.IsPrompt)
      };
    }).filter(selection => selection.name && selection.odds !== null);

    return {
      handicap: selections.find(selection => selection.handicap !== null)?.handicap ?? null,
      selections
    };
  }

  function normalizeMarket(market, homeName, awayName) {
    const lines = (Array.isArray(market?.Odds) ? market.Odds : [])
      .map(group => normalizeLine(group, homeName, awayName))
      .filter(line => line.selections.length);

    return {
      providerMarketId: cleanText(market?.MatchNo),
      code: cleanText(market?.GTCode),
      name: cleanText(market?.GTName),
      gameOrder: integer(market?.GameOrder),
      group: cleanText(market?.GTGroup) || null,
      marketGroup: cleanText(market?.GTMarketGroup) || null,
      live: Boolean(market?.IsLive),
      providerStatus: integer(market?.Status),
      available: Number(market?.Status) === 1 && lines.some(line => line.selections.some(selection => !selection.locked)),
      tabs: Array.isArray(market?.Tabs) ? market.Tabs.map(cleanText) : [],
      lines
    };
  }

  function normalizeParent(sport, league, parent) {
    const homeName = cleanText(parent?.PHTName);
    const awayName = cleanText(parent?.PATName);
    const markets = (Array.isArray(parent?.Match) ? parent.Match : [])
      .map(market => normalizeMarket(market, homeName, awayName))
      .filter(market => market.providerMarketId && market.code && market.lines.length);

    return {
      providerMatchId: cleanText(parent?.PMatchNo),
      externalMatchId: cleanText(parent?.ExtMatchId) || null,
      sport: cleanText(sport?.SportName, 'League of Legends'),
      sportCode: cleanText(sport?.SportAbbr, 'LOL'),
      league: cleanText(league?.LGName || league?.BaseLGName),
      leagueCode: cleanText(league?.BaseLGAbbr) || null,
      matchType: cleanText(parent?.MatchType) || null,
      group: cleanText(parent?.MatchGroup) || null,
      live: Boolean(parent?.HasLive),
      liveOpened: Boolean(parent?.HasLiveOpened),
      providerStatus: integer(parent?.GameStatus),
      updatedAt: cleanText(parent?.LiveUpdateTime || parent?.LiveRefTime) || null,
      teams: {
        home: {
          id: cleanText(parent?.PHTId) || null,
          name: homeName,
          code: cleanText(parent?.PHTAbbr) || null,
          score: finite(parent?.PHTScore),
          image: cleanText(parent?.PHTImgURL) || null
        },
        away: {
          id: cleanText(parent?.PATId) || null,
          name: awayName,
          code: cleanText(parent?.PATAbbr) || null,
          score: finite(parent?.PATScore),
          image: cleanText(parent?.PATImgURL) || null
        }
      },
      markets
    };
  }

  function normalizeResponse(data) {
    const matches = [];
    for (const sport of Array.isArray(data?.Sport) ? data.Sport : []) {
      for (const league of Array.isArray(sport?.LG) ? sport.LG : []) {
        for (const parent of Array.isArray(league?.ParentMatch) ? league.ParentMatch : []) {
          const match = normalizeParent(sport, league, parent);
          if (/^\d{4,14}$/.test(match.providerMatchId) && match.teams.home.name && match.teams.away.name) {
            matches.push(match);
          }
        }
      }
    }

    return {
      schemaVersion: '1.0',
      source: 'ime-esportsbull-browser-bridge',
      capturedAt: new Date().toISOString(),
      matches
    };
  }

  function fingerprint(payload) {
    const value = JSON.stringify(payload.matches);
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }

  function queueSend(payload, force = false) {
    if (!payload?.matches?.length) return;
    lastPayload = payload;
    const nextFingerprint = fingerprint(payload);
    if (!force && nextFingerprint === lastFingerprint) return;
    lastFingerprint = nextFingerprint;
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => sendPayload(payload), 350);
  }

  function sendPayload(payload) {
    const secret = bridgeSecret();
    if (!secret) {
      setBadge(`Odds captured · ${payload.matches[0]?.teams?.home?.code || 'Team A'} vs ${payload.matches[0]?.teams?.away?.code || 'Team B'} · set secret`, 'waiting');
      return;
    }
    if (sending) {
      setTimeout(() => queueSend(lastPayload, true), 500);
      return;
    }

    sending = true;
    const first = payload.matches[0];
    setBadge(`Sending ${first?.teams?.home?.code || 'A'} vs ${first?.teams?.away?.code || 'B'} odds…`, 'sending');

    GM_xmlhttpRequest({
      method: 'POST',
      url: `${workerBase()}/api/odds/bridge`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`
      },
      data: JSON.stringify(payload),
      timeout: 15_000,
      onload(response) {
        sending = false;
        let body = null;
        try { body = JSON.parse(response.responseText); } catch { /* no-op */ }
        if (response.status >= 200 && response.status < 300 && body?.status === 'accepted') {
          const marketCount = body.matches?.reduce((sum, match) => sum + Number(match.marketCount || 0), 0) || 0;
          setBadge(`Odds bridge live · ${body.matches?.length || 0} match · ${marketCount} markets`, 'ok');
          return;
        }
        setBadge(`Odds bridge failed · ${body?.error || body?.status || `HTTP ${response.status}`}`, 'error');
      },
      onerror() {
        sending = false;
        setBadge('Odds bridge failed · network error', 'error');
      },
      ontimeout() {
        sending = false;
        setBadge('Odds bridge failed · timeout', 'error');
      }
    });
  }

  function handleProviderData(data) {
    try {
      const payload = normalizeResponse(data);
      if (payload.matches.length) queueSend(payload);
    } catch (error) {
      console.warn('[LoL Odds Bridge] Could not normalize provider response:', error);
      setBadge('Odds bridge · response parse failed', 'error');
    }
  }

  function isTarget(url) {
    return String(url || '').includes(TARGET_FRAGMENT);
  }

  function patchXmlHttpRequest() {
    const prototype = page.XMLHttpRequest?.prototype;
    if (!prototype || prototype.__lolOddsBridgePatched) return;

    const originalOpen = prototype.open;
    const originalSend = prototype.send;

    prototype.open = function patchedOpen(method, url, ...rest) {
      this.__lolOddsBridgeUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };

    prototype.send = function patchedSend(...args) {
      if (isTarget(this.__lolOddsBridgeUrl)) {
        this.addEventListener('load', () => {
          if (this.status < 200 || this.status >= 300) return;
          try {
            const data = this.responseType === 'json' && this.response
              ? this.response
              : JSON.parse(this.responseText);
            handleProviderData(data);
          } catch (error) {
            console.warn('[LoL Odds Bridge] XHR response was not readable JSON:', error);
          }
        }, { once: true });
      }
      return originalSend.apply(this, args);
    };

    Object.defineProperty(prototype, '__lolOddsBridgePatched', { value: true });
  }

  function patchFetch() {
    if (typeof page.fetch !== 'function' || page.fetch.__lolOddsBridgePatched) return;
    const originalFetch = page.fetch;

    async function patchedFetch(input, init) {
      const response = await originalFetch.call(this, input, init);
      const url = typeof input === 'string' ? input : input?.url;
      if (isTarget(url) && response.ok) {
        response.clone().json().then(handleProviderData).catch(() => {});
      }
      return response;
    }

    Object.defineProperty(patchedFetch, '__lolOddsBridgePatched', { value: true });
    page.fetch = patchedFetch;
  }

  GM_registerMenuCommand('Configure bridge secret', configureSecret);
  GM_registerMenuCommand('Configure Worker URL', configureWorker);
  GM_registerMenuCommand('Send last captured odds again', () => {
    if (lastPayload) queueSend(lastPayload, true);
    else setBadge('Odds bridge · no response captured yet', 'waiting');
  });
  GM_registerMenuCommand('Clear bridge secret', () => {
    GM_deleteValue(SECRET_KEY);
    setBadge('Odds bridge · secret cleared', 'idle');
  });

  patchXmlHttpRequest();
  patchFetch();
  createBadge();
  document.addEventListener('DOMContentLoaded', createBadge, { once: true });
  console.info('[LoL Odds Bridge] Installed. Waiting for GetMatchDetailsByParentV2 responses.');
})();
