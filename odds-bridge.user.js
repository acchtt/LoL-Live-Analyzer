// ==UserScript==
// @name         LoL Live Analyzer - BK8/IME Odds Bridge
// @namespace    https://github.com/acchtt/LoL-Live-Analyzer
// @version      1.2.0
// @description  Captures sanitized eSportsBull market responses and sends them to your private Cloudflare Worker bridge.
// @author       LoL Live Analyzer
// @match        https://*.dotnapu.com/*
// @match        https://dotnapu.com/*
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

  const TARGET = '/api/GetMatchDetailsByParentV2';
  const DEFAULT_WORKER = 'https://lol-live-analyzer-api.acchtt.workers.dev';
  const SECRET_KEY = 'oddsBridgeSecret';
  const WORKER_KEY = 'oddsBridgeWorker';
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  let host;
  let root;
  let badge;
  let modal;
  let modalOpen = false;
  let message = '';
  let state = 'idle';
  let lastPayload;
  let lastHash = '';
  let timer;
  let sending = false;

  const workerBase = () => String(GM_getValue(WORKER_KEY, DEFAULT_WORKER) || DEFAULT_WORKER).replace(/\/+$/, '');
  const bridgeSecret = () => String(GM_getValue(SECRET_KEY, '') || '').trim();
  const text = (value, fallback = '') => String(value ?? fallback).trim();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const integer = value => Number.isInteger(Number(value)) ? Number(value) : null;

  function mountHost() {
    const mount = document.body || document.documentElement;
    if (!mount) return false;
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;display:block;pointer-events:auto';
      root = host.attachShadow({ mode: 'open' });
    }
    if (!host.isConnected || host.parentNode !== mount) mount.appendChild(host);
    return true;
  }

  function colors(kind) {
    return {
      idle: ['#182033', '#cbd5e1'], waiting: ['#332d18', '#fde68a'],
      sending: ['#172554', '#bfdbfe'], ok: ['#123524', '#bbf7d0'], error: ['#3f1717', '#fecaca']
    }[kind] || ['#182033', '#cbd5e1'];
  }

  function ensureBadge() {
    if (!mountHost()) return;
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.style.cssText = 'all:initial;display:block;box-sizing:border-box;border:1px solid rgba(255,255,255,.24);border-radius:9px;padding:9px 12px;font:600 12px/1.35 system-ui,sans-serif;box-shadow:0 5px 20px rgba(0,0,0,.42);cursor:pointer;max-width:340px;text-align:left;white-space:normal;pointer-events:auto;user-select:none';
      badge.addEventListener('pointerdown', event => event.stopPropagation(), true);
      badge.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openSettings();
      }, true);
      root.appendChild(badge);
    }
    const currentMessage = message || (bridgeSecret() ? 'Odds bridge ready · waiting for odds' : 'Odds bridge · click to set secret');
    const currentState = message ? state : (bridgeSecret() ? 'waiting' : 'idle');
    const [background, color] = colors(currentState);
    badge.textContent = currentMessage;
    badge.style.background = background;
    badge.style.color = color;
  }

  function setBadge(nextMessage, nextState = 'idle') {
    message = String(nextMessage || '');
    state = nextState;
    ensureBadge();
  }

  function button(label, background) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.style.cssText = `all:initial;display:inline-block;box-sizing:border-box;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:9px 12px;background:${background};color:#fff;font:600 13px/1.3 system-ui,sans-serif;cursor:pointer;text-align:center`;
    return element;
  }

  function closeSettings() {
    modalOpen = false;
    modal?.remove();
    modal = null;
  }

  function openSettings() {
    modalOpen = true;
    ensureSettings();
  }

  function ensureSettings() {
    if (!modalOpen || !mountHost() || modal?.isConnected) return;
    modal = document.createElement('div');
    modal.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:18px;background:rgba(3,7,18,.78);font:14px/1.45 system-ui,sans-serif;color:#e5e7eb;pointer-events:auto';

    const panel = document.createElement('div');
    panel.style.cssText = 'all:initial;display:block;box-sizing:border-box;width:min(520px,100%);border:1px solid #3a4761;border-radius:14px;padding:18px;background:#111827;box-shadow:0 18px 60px rgba(0,0,0,.6);font:14px/1.45 system-ui,sans-serif;color:#e5e7eb';
    panel.innerHTML = '<div style="font-weight:700;font-size:17px;color:#f8fafc;margin-bottom:6px">Configure private odds bridge</div><div style="color:#aab4c7;margin-bottom:16px">Paste the same ODDS_BRIDGE_SECRET stored in GitHub. It stays only in Tampermonkey storage.</div>';

    const secretLabel = document.createElement('label');
    secretLabel.textContent = 'Bridge secret';
    secretLabel.style.cssText = 'display:block;margin-bottom:6px;font-weight:600;color:#dbeafe';
    const secretInput = document.createElement('input');
    secretInput.type = 'password';
    secretInput.autocomplete = 'off';
    secretInput.value = bridgeSecret();
    secretInput.placeholder = 'ODDS_BRIDGE_SECRET';

    const workerLabel = document.createElement('label');
    workerLabel.textContent = 'Cloudflare Worker URL';
    workerLabel.style.cssText = 'display:block;margin:14px 0 6px;font-weight:600;color:#dbeafe';
    const workerInput = document.createElement('input');
    workerInput.type = 'url';
    workerInput.value = workerBase();

    for (const input of [secretInput, workerInput]) {
      input.style.cssText = 'all:initial;display:block;box-sizing:border-box;width:100%;border:1px solid #43516d;border-radius:9px;padding:10px 11px;background:#0b1220;color:#f8fafc;font:14px/1.35 system-ui,sans-serif';
    }

    const error = document.createElement('div');
    error.style.cssText = 'display:none;margin-top:10px;color:#fecaca';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px';
    const clear = button('Clear secret', '#263247');
    const cancel = button('Cancel', '#263247');
    const save = button('Save and connect', '#315efb');

    clear.addEventListener('click', () => {
      GM_deleteValue(SECRET_KEY);
      setBadge('Odds bridge · secret cleared', 'idle');
      closeSettings();
    });
    cancel.addEventListener('click', closeSettings);
    save.addEventListener('click', () => {
      const secret = text(secretInput.value);
      const worker = text(workerInput.value).replace(/\/+$/, '');
      if (!secret || !/^https:\/\//i.test(worker)) {
        error.textContent = !secret ? 'Paste ODDS_BRIDGE_SECRET first.' : 'Worker URL must start with https://';
        error.style.display = 'block';
        return;
      }
      GM_setValue(SECRET_KEY, secret);
      GM_setValue(WORKER_KEY, worker);
      setBadge('Odds bridge ready · waiting for odds', 'waiting');
      closeSettings();
      if (lastPayload) queueSend(lastPayload, true);
    });

    modal.addEventListener('click', event => { if (event.target === modal) closeSettings(); });
    panel.addEventListener('click', event => event.stopPropagation());
    actions.append(clear, cancel, save);
    panel.append(secretLabel, secretInput, workerLabel, workerInput, error, actions);
    modal.appendChild(panel);
    root.appendChild(modal);
    setTimeout(() => secretInput.focus(), 0);
  }

  function selectionSide(name, code) {
    const value = text(name).toLowerCase();
    if (value === 'tài' || value === 'over') return 'over';
    if (value === 'xỉu' || value === 'under') return 'under';
    if (value.includes('{teama}') || Number(code) === 1) return 'home';
    if (value.includes('{teamb}') || Number(code) === 2) return 'away';
    return null;
  }

  function normalizeResponse(data) {
    const matches = [];
    for (const sport of Array.isArray(data?.Sport) ? data.Sport : []) {
      for (const league of Array.isArray(sport?.LG) ? sport.LG : []) {
        for (const parent of Array.isArray(league?.ParentMatch) ? league.ParentMatch : []) {
          const home = text(parent?.PHTName);
          const away = text(parent?.PATName);
          const markets = (Array.isArray(parent?.Match) ? parent.Match : []).map(market => ({
            providerMarketId: text(market?.MatchNo), code: text(market?.GTCode), name: text(market?.GTName),
            gameOrder: integer(market?.GameOrder), group: text(market?.GTGroup) || null,
            marketGroup: text(market?.GTMarketGroup) || null, live: Boolean(market?.IsLive),
            providerStatus: integer(market?.Status), available: Number(market?.Status) === 1,
            tabs: Array.isArray(market?.Tabs) ? market.Tabs.map(text) : [],
            lines: (Array.isArray(market?.Odds) ? market.Odds : []).map(group => {
              const selections = (Array.isArray(group?.SEL) ? group.SEL : []).map(selection => {
                const handicap = number(selection?.HDP);
                const name = text(selection?.SName)
                  .replaceAll('{TeamA}', home).replaceAll('{TeamB}', away)
                  .replaceAll('{HDP}', handicap === null ? '' : String(Math.abs(handicap)))
                  .replace(/\s+/g, ' ').trim();
                return { code: integer(selection?.SCode), name, side: selectionSide(selection?.SName, selection?.SCode), handicap, odds: number(selection?.Odds), locked: Boolean(selection?.IsLock), prompt: Boolean(selection?.IsPrompt) };
              }).filter(selection => selection.name && selection.odds !== null);
              return { handicap: selections.find(selection => selection.handicap !== null)?.handicap ?? null, selections };
            }).filter(line => line.selections.length)
          })).filter(market => market.providerMarketId && market.code && market.lines.length);

          const providerMatchId = text(parent?.PMatchNo);
          if (!/^\d{4,14}$/.test(providerMatchId) || !home || !away) continue;
          matches.push({
            providerMatchId, externalMatchId: text(parent?.ExtMatchId) || null,
            sport: text(sport?.SportName, 'League of Legends'), sportCode: text(sport?.SportAbbr, 'LOL'),
            league: text(league?.LGName || league?.BaseLGName), leagueCode: text(league?.BaseLGAbbr) || null,
            matchType: text(parent?.MatchType) || null, group: text(parent?.MatchGroup) || null,
            live: Boolean(parent?.HasLive), liveOpened: Boolean(parent?.HasLiveOpened),
            providerStatus: integer(parent?.GameStatus), updatedAt: text(parent?.LiveUpdateTime || parent?.LiveRefTime) || null,
            teams: {
              home: { id: text(parent?.PHTId) || null, name: home, code: text(parent?.PHTAbbr) || null, score: number(parent?.PHTScore), image: text(parent?.PHTImgURL) || null },
              away: { id: text(parent?.PATId) || null, name: away, code: text(parent?.PATAbbr) || null, score: number(parent?.PATScore), image: text(parent?.PATImgURL) || null }
            },
            markets
          });
        }
      }
    }
    return { schemaVersion: '1.0', source: 'ime-esportsbull-browser-bridge', capturedAt: new Date().toISOString(), matches };
  }

  function hashPayload(payload) {
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
    const nextHash = hashPayload(payload);
    if (!force && nextHash === lastHash) return;
    lastHash = nextHash;
    clearTimeout(timer);
    timer = setTimeout(() => sendPayload(payload), 350);
  }

  function sendPayload(payload) {
    const secret = bridgeSecret();
    const first = payload.matches[0];
    if (!secret) {
      setBadge(`Odds captured · ${first?.teams?.home?.code || 'A'} vs ${first?.teams?.away?.code || 'B'} · click to set secret`, 'waiting');
      return;
    }
    if (sending) return setTimeout(() => queueSend(lastPayload, true), 500);
    sending = true;
    setBadge(`Sending ${first?.teams?.home?.code || 'A'} vs ${first?.teams?.away?.code || 'B'} odds…`, 'sending');
    GM_xmlhttpRequest({
      method: 'POST', url: `${workerBase()}/api/odds/bridge`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      data: JSON.stringify(payload), timeout: 15000,
      onload(response) {
        sending = false;
        let body;
        try { body = JSON.parse(response.responseText); } catch { body = null; }
        if (response.status >= 200 && response.status < 300 && body?.status === 'accepted') {
          const count = body.matches?.reduce((sum, match) => sum + Number(match.marketCount || 0), 0) || 0;
          setBadge(`Odds bridge live · ${body.matches?.length || 0} match · ${count} markets`, 'ok');
        } else setBadge(`Odds bridge failed · ${body?.error || body?.status || `HTTP ${response.status}`}`, 'error');
      },
      onerror() { sending = false; setBadge('Odds bridge failed · network error', 'error'); },
      ontimeout() { sending = false; setBadge('Odds bridge failed · timeout', 'error'); }
    });
  }

  function handleData(data) {
    try {
      const payload = normalizeResponse(data);
      if (payload.matches.length) queueSend(payload);
    } catch (error) {
      console.warn('[LoL Odds Bridge] Parse failed:', error);
      setBadge('Odds bridge · response parse failed', 'error');
    }
  }

  const isTarget = url => String(url || '').includes(TARGET);

  function patchXHR() {
    const prototype = page.XMLHttpRequest?.prototype;
    if (!prototype || (prototype.open?.__oddsBridge && prototype.send?.__oddsBridge)) return;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    function open(method, url, ...rest) {
      this.__oddsBridgeUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    }
    function send(...args) {
      if (isTarget(this.__oddsBridgeUrl)) this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return;
        try { handleData(this.responseType === 'json' && this.response ? this.response : JSON.parse(this.responseText)); } catch {}
      }, { once: true });
      return originalSend.apply(this, args);
    }
    Object.defineProperty(open, '__oddsBridge', { value: true });
    Object.defineProperty(send, '__oddsBridge', { value: true });
    prototype.open = open;
    prototype.send = send;
  }

  function patchFetch() {
    if (typeof page.fetch !== 'function' || page.fetch.__oddsBridge) return;
    const original = page.fetch;
    async function wrapped(input, init) {
      const response = await original.call(this, input, init);
      const url = typeof input === 'string' ? input : input?.url;
      if (isTarget(url) && response.ok) response.clone().json().then(handleData).catch(() => {});
      return response;
    }
    Object.defineProperty(wrapped, '__oddsBridge', { value: true });
    page.fetch = wrapped;
  }

  function maintain() {
    ensureBadge();
    if (modalOpen) ensureSettings();
    patchXHR();
    patchFetch();
  }

  GM_registerMenuCommand('Open bridge settings', openSettings);
  GM_registerMenuCommand('Show bridge badge', () => { host?.remove(); ensureBadge(); });
  GM_registerMenuCommand('Send last captured odds again', () => lastPayload ? queueSend(lastPayload, true) : setBadge('Odds bridge · no response captured yet', 'waiting'));
  GM_registerMenuCommand('Clear bridge secret', () => { GM_deleteValue(SECRET_KEY); setBadge('Odds bridge · secret cleared', 'idle'); });

  maintain();
  document.addEventListener('DOMContentLoaded', maintain, { once: true });
  setInterval(maintain, 1500);
  console.info('[LoL Odds Bridge] v1.2.0 installed.');
})();
