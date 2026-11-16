// ==UserScript==
// @name         Discord Plus
// @namespace    https://github.com/domcodes1/discord-plus
// @version      1.0.0
// @description  Discord web extras: voice join/leave log, inline Italian-to-English translate, and a decluttered custom look.
// @author       domcodes1
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @match        https://discordapp.com/*
// @connect      translate.googleapis.com
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/domcodes1/discord-plus/main/discord-plus.user.js
// @downloadURL  https://raw.githubusercontent.com/domcodes1/discord-plus/main/discord-plus.user.js
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';
  const TAG = '[DiscordPlus]';
  const log = (...a) => console.log(TAG, ...a);

  /* ---------------- settings ---------------- */
  const DEFAULTS = { voiceLog: true, translate: true, customCss: true, targetLang: 'en' };
  const get = (k) => GM_getValue(k, DEFAULTS[k]);
  const set = (k, v) => GM_setValue(k, v);

  /* ---------------- voice log ---------------- */
  const LOG_KEY = 'dp_voice_log_v1';
  const MAX_LOG = 200;
  let voiceState = new Map();
  let firstScan = true;

  function loadLog() {
    try { return JSON.parse(GM_getValue(LOG_KEY, '[]')); } catch (e) { return []; }
  }
  function saveLog(entries) {
    GM_setValue(LOG_KEY, JSON.stringify(entries.slice(-MAX_LOG)));
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function addVoiceEvent(type, channel, user) {
    const entries = loadLog();
    entries.push({ t: Date.now(), type, channel, user });
    saveLog(entries);
    renderVoiceLog();
  }
  function findChannelName(row) {
    let el = row.parentElement;
    while (el && el !== document.body) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('containerDefault') !== -1) {
        const link = el.querySelector('a[aria-label]');
        if (link) {
          const label = link.getAttribute('aria-label') || '';
          return label.replace(/\s*\(voice channel\)\s*$/i, '').trim() || null;
        }
        const nameEl = el.querySelector('[class*="name"]');
        if (nameEl && nameEl.textContent.trim()) return nameEl.textContent.trim();
        return null;
      }
      el = el.parentElement;
    }
    return null;
  }
  function scanVoice() {
    if (!get('voiceLog')) return;
    const sidebar = document.querySelector('[class*="sidebar"]');
    const scope = sidebar || document;
    const rows = scope.querySelectorAll('[class*="voiceUser"]');
    const now = new Map();
    rows.forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      const user = nameEl ? nameEl.textContent.trim() : '';
      if (!user) return;
      const channel = findChannelName(row) || 'voice';
      now.set(channel + '|' + user, { channel, user });
    });
    if (firstScan) {
      voiceState = now;
      firstScan = false;
      return;
    }
    // If everything vanished at once, the user probably switched servers or views.
    // Reset the baseline silently instead of logging a mass exodus.
    if (now.size === 0 && voiceState.size > 0) {
      voiceState = now;
      return;
    }
    now.forEach((v, k) => { if (!voiceState.has(k)) addVoiceEvent('join', v.channel, v.user); });
    voiceState.forEach((v, k) => { if (!now.has(k)) addVoiceEvent('leave', v.channel, v.user); });
    voiceState = now;
  }

  /* ---------------- UI: floating panel ---------------- */
  let panel = null;
  let panelOpen = false;

  function renderVoiceLog() {
    const list = document.getElementById('dp-log-list');
    if (!list) return;
    const entries = loadLog().slice().reverse();
    if (!entries.length) {
      list.innerHTML = '<div class="dp-empty">No voice activity logged yet.</div>';
      return;
    }
    list.innerHTML = entries.map((e) => {
      const verb = e.type === 'join' ? 'joined' : 'left';
      const cls = e.type === 'join' ? 'dp-join' : 'dp-leave';
      return '<div class="dp-log-row ' + cls + '"><span class="dp-time">' + fmtTime(e.t) + '</span> <strong>' + escapeHtml(e.user) + '</strong> ' + verb + ' <em>' + escapeHtml(e.channel) + '</em></div>';
    }).join('');
  }

  function togglePanel() {
    ensurePanel();
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) renderVoiceLog();
  }

  function ensurePanel() {
    if (panel) return panel;
    const btn = document.createElement('button');
    btn.id = 'dp-fab';
    btn.textContent = 'DP';
    btn.title = 'Discord Plus';
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);

    panel = document.createElement('div');
    panel.id = 'dp-panel';
    panel.innerHTML =
      '<div class="dp-panel-head"><strong>Discord Plus</strong><button id="dp-panel-close" title="Close">✕</button></div>' +
      '<div class="dp-section"><div class="dp-section-title">Voice log <button id="dp-log-clear">Clear</button></div>' +
      '<div id="dp-log-list" class="dp-log-list"></div>' +
      '<div class="dp-note">Only logs while this Discord tab is open, for the server you are viewing.</div></div>' +
      '<div class="dp-section"><div class="dp-section-title">Settings</div>' +
      '<label><input type="checkbox" id="dp-set-voice"> Voice join/leave log</label>' +
      '<label><input type="checkbox" id="dp-set-translate"> Inline translate</label>' +
      '<label><input type="checkbox" id="dp-set-css"> Custom look</label>' +
      '<label>Translate to <select id="dp-set-lang"><option value="en">English</option><option value="it">Italian</option></select></label>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('#dp-panel-close').addEventListener('click', togglePanel);
    panel.querySelector('#dp-log-clear').addEventListener('click', () => { saveLog([]); renderVoiceLog(); });
    const voiceCb = panel.querySelector('#dp-set-voice');
    const trCb = panel.querySelector('#dp-set-translate');
    const cssCb = panel.querySelector('#dp-set-css');
    const langSel = panel.querySelector('#dp-set-lang');
    voiceCb.checked = get('voiceLog');
    trCb.checked = get('translate');
    cssCb.checked = get('customCss');
    langSel.value = get('targetLang');
    voiceCb.addEventListener('change', () => {
      set('voiceLog', voiceCb.checked);
      if (!voiceCb.checked) { voiceState = new Map(); firstScan = true; }
    });
    trCb.addEventListener('change', () => set('translate', trCb.checked));
    cssCb.addEventListener('change', () => { set('customCss', cssCb.checked); applyCustomCss(); });
    langSel.addEventListener('change', () => set('targetLang', langSel.value));
    renderVoiceLog();
    return panel;
  }

  /* ---------------- inline translate ---------------- */
  function translateText(text, target, done) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      onload: (res) => {
        try {
          const data = JSON.parse(res.responseText);
          const out = (data[0] || []).map((seg) => seg[0] || '').join('');
          const src = data[2] || 'auto';
          done(null, out, src);
        } catch (e) { done(e); }
      },
      onerror: () => done(new Error('request failed')),
      ontimeout: () => done(new Error('timed out'))
    });
  }

  function messageText(msgEl) {
    const content = msgEl.querySelector('[class*="messageContent"]');
    if (!content) return '';
    return content.innerText.trim();
  }

  function toggleTranslation(msg) {
    const existing = msg.querySelector(':scope > .dp-translation');
    if (existing) { existing.remove(); return; }
    const text = messageText(msg);
    if (!text) return;
    const target = get('targetLang');
    const box = document.createElement('div');
    box.className = 'dp-translation';
    box.textContent = 'Translating…';
    msg.appendChild(box);
    translateText(text, target, (err, out, src) => {
      if (err || !out) { box.textContent = 'Translation failed. Try again.'; return; }
      if (src === target) {
        box.textContent = 'Already in ' + (target === 'en' ? 'English' : 'Italian') + '.';
        return;
      }
      box.textContent = '';
      const label = document.createElement('div');
      label.className = 'dp-translation-label';
      label.textContent = 'Translated from ' + (src || 'auto') + ' ';
      const close = document.createElement('span');
      close.className = 'dp-translation-close';
      close.textContent = '✕';
      close.addEventListener('click', () => box.remove());
      label.appendChild(close);
      const body = document.createElement('div');
      body.textContent = out;
      box.appendChild(label);
      box.appendChild(body);
    });
  }

  function attachTranslateButtons() {
    document.addEventListener('mouseover', (e) => {
      if (!get('translate')) return;
      const target = e.target;
      if (!target || !target.closest) return;
      const msg = target.closest('[id^="chat-messages-"]');
      if (!msg || msg.querySelector(':scope > .dp-translate-btn')) return;
      if (!msg.querySelector('[class*="messageContent"]')) return;
      const btn = document.createElement('button');
      btn.className = 'dp-translate-btn';
      btn.textContent = '🌐';
      btn.title = 'Translate';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleTranslation(msg);
      });
      msg.appendChild(btn);
    });
  }

  /* ---------------- custom look ---------------- */
  let customStyleEl = null;
  const CUSTOM_CSS = [
    '/* Discord Plus custom look — edit these rules to taste */',
    '[aria-label="Send a gift"] { display: none !important; }',
    'a[href="/shop"] { display: none !important; }',
    '[aria-label="Shop"] { display: none !important; }',
    ':root { --brand-500: #7c5cff; --brand-600: #6a4de0; --brand-400: #9a86ff; }',
    '[class*="containerDefault"] { padding-top: 1px !important; padding-bottom: 1px !important; }'
  ].join('\n');

  function applyCustomCss() {
    if (customStyleEl) { customStyleEl.remove(); customStyleEl = null; }
    if (get('customCss')) customStyleEl = GM_addStyle(CUSTOM_CSS);
  }

  /* ---------------- core UI styles (always on) ---------------- */
  const UI_CSS = [
    '#dp-fab { position: fixed; right: 16px; bottom: 16px; z-index: 9999; width: 44px; height: 44px; border-radius: 50%; border: none; background: #7c5cff; color: #fff; font-weight: 700; font-size: 14px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.4); }',
    '#dp-fab:hover { background: #6a4de0; }',
    '#dp-panel { position: fixed; right: 16px; bottom: 72px; z-index: 9999; width: 340px; max-height: 70vh; overflow-y: auto; display: none; background: #1e1f22; color: #dbdee1; border: 1px solid #3f4147; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5); font-family: inherit; font-size: 14px; }',
    '.dp-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #3f4147; }',
    '.dp-panel-head button { background: none; border: none; color: #dbdee1; cursor: pointer; font-size: 14px; }',
    '.dp-section { padding: 10px 12px; border-bottom: 1px solid #2b2d31; }',
    '.dp-section-title { font-weight: 700; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }',
    '.dp-section label { display: block; margin: 6px 0; }',
    '.dp-log-list { max-height: 220px; overflow-y: auto; }',
    '.dp-log-row { padding: 3px 0; }',
    '.dp-time { color: #949ba4; }',
    '.dp-join strong { color: #3ba55d; }',
    '.dp-leave strong { color: #ed4245; }',
    '.dp-empty { color: #949ba4; }',
    '.dp-note { color: #949ba4; font-size: 12px; margin-top: 8px; }',
    '#dp-log-clear { background: #2b2d31; color: #dbdee1; border: 1px solid #3f4147; border-radius: 6px; padding: 2px 8px; cursor: pointer; }',
    '.dp-translate-btn { position: absolute; top: 2px; right: 6px; z-index: 5; opacity: 0; background: #2b2d31; color: #dbdee1; border: 1px solid #3f4147; border-radius: 6px; padding: 1px 6px; cursor: pointer; font-size: 12px; }',
    '[id^="chat-messages-"]:hover .dp-translate-btn { opacity: 1; }',
    '[id^="chat-messages-"] { position: relative; }',
    '.dp-translation { margin: 4px 0 2px 0; padding: 6px 8px; background: #2b2d31; border-left: 3px solid #7c5cff; border-radius: 6px; color: #dbdee1; font-size: 14px; }',
    '.dp-translation-label { font-size: 11px; color: #949ba4; margin-bottom: 2px; display: flex; justify-content: space-between; }',
    '.dp-translation-close { cursor: pointer; }'
  ].join('\n');

  /* ---------------- boot ---------------- */
  function boot() {
    try {
      GM_addStyle(UI_CSS);
      ensurePanel();
      applyCustomCss();
      attachTranslateButtons();
      setInterval(scanVoice, 2000);
      GM_registerMenuCommand('Discord Plus: open panel', togglePanel);
      GM_registerMenuCommand('Discord Plus: toggle voice log', () => { set('voiceLog', !get('voiceLog')); });
      GM_registerMenuCommand('Discord Plus: toggle translate', () => { set('translate', !get('translate')); });
      GM_registerMenuCommand('Discord Plus: toggle custom look', () => { set('customCss', !get('customCss')); applyCustomCss(); });
      log('loaded v1.0.0');
    } catch (e) {
      console.error(TAG, 'boot failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
