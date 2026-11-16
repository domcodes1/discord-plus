// ==UserScript==
// @name         Discord Plus
// @namespace    https://github.com/domcodes1/discord-plus
// @version      2.1.0
// @description  Discord web extras: voice join/leave log for a server you pick (tracked in the background), and a full custom theme engine.
// @author       domcodes1
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @match        https://discordapp.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
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
  const DEFAULTS = {
    voiceLog: true,
    themeOn: true,
    themePreset: 'neon',
    accent: '#7c5cff',
    bgUrl: '',
    watchGuildId: null
  };
  const get = (k) => GM_getValue(k, DEFAULTS[k]);
  const set = (k, v) => GM_setValue(k, v);
  const watchKey = () => get('watchGuildId') || null;
  function watchMatches(guildId, guildName) {
    const key = watchKey();
    if (!key) return true;
    if (key.indexOf('name:') === 0) return guildName === key.slice(5);
    return guildId === key;
  }

  /* ---------------- helpers ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function shade(hex, percent) {
    let h = String(hex || '#7c5cff').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const num = parseInt(h, 16) || 0;
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /* ---------------- Discord internal stores (background voice data) ---------------- */
  let wpRequire = null;
  let stores = { voice: null, channel: null, user: null, guild: null };
  let lastStoreAttempt = 0;

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (e) { /* ignore */ }
    return window;
  }
  function getWpRequire() {
    if (wpRequire) return wpRequire;
    const pw = getPageWindow();
    const chunk = (pw && pw.webpackChunkdiscord_app) || window.webpackChunkdiscord_app;
    if (!chunk || typeof chunk.push !== 'function') return null;
    try {
      chunk.push([['dp' + Math.random().toString(36).slice(2)], {}, (req) => { wpRequire = req; }]);
    } catch (e) { return null; }
    return wpRequire;
  }
  function findStore(props, anyOf) {
    const req = getWpRequire();
    if (!req || !req.c) return null;
    const cache = req.c;
    for (const id in cache) {
      const mod = cache[id];
      if (!mod || !mod.exports) continue;
      const candidates = [mod.exports, mod.exports.default, mod.exports.Z];
      for (const cand of candidates) {
        if (!cand || typeof cand !== 'object') continue;
        if (anyOf) {
          if (props.some((p) => typeof cand[p] === 'function')) return cand;
        } else {
          if (props.every((p) => typeof cand[p] === 'function')) return cand;
        }
      }
    }
    return null;
  }
  function ensureStores() {
    if (stores.voice && stores.channel && stores.user && stores.guild) return true;
    const now = Date.now();
    if (now - lastStoreAttempt < 5000) return false;
    lastStoreAttempt = now;
    if (!stores.voice) stores.voice = findStore(['getVoiceStatesForChannel', 'getAllVoiceStates'], true);
    if (!stores.channel) stores.channel = findStore(['getChannel', 'getDMChannelFromUserId'], true);
    if (!stores.user) stores.user = findStore(['getUser', 'getCurrentUser'], true);
    if (!stores.guild) stores.guild = findStore(['getGuild', 'getGuilds'], true);
    const ok = !!(stores.voice && stores.channel && stores.user);
    if (ok) log('background voice tracking on (Discord stores found)');
    return ok;
  }
  function resolveUserName(userId) {
    try {
      const u = stores.user && stores.user.getUser(userId);
      if (u) return u.globalName || u.username || userId;
    } catch (e) { /* ignore */ }
    return userId;
  }
  function resolveGuildName(guildId) {
    if (!guildId) return 'DM';
    try {
      const g = stores.guild && stores.guild.getGuild && stores.guild.getGuild(guildId);
      if (g && g.name) return g.name;
    } catch (e) { /* ignore */ }
    return guildNameFromRail(guildId) || 'Server';
  }

  /* ---------------- guild list (for the server picker) ---------------- */
  function listGuildsFromStores() {
    if (!stores.guild || typeof stores.guild.getGuilds !== 'function') return [];
    let all;
    try { all = stores.guild.getGuilds(); } catch (e) { return []; }
    if (!all) return [];
    const entries = all instanceof Map ? Array.from(all.entries()) : Object.entries(all);
    return entries.map(([id, g]) => ({ id: String(id), name: (g && g.name) || String(id) }));
  }
  function listGuildsFromRail() {
    const out = [];
    const rail = document.querySelector('nav[aria-label="Servers"]') || document.querySelector('[class*="guilds_"]');
    const scope = rail || document;
    scope.querySelectorAll('[aria-label]').forEach((el) => {
      let label = (el.getAttribute('aria-label') || '').trim();
      if (!label) return;
      if (/^(direct messages|add a server|explore|download apps|create a server|discover)/i.test(label)) return;
      label = label.replace(/,\s*\d+ unread.*$/i, '').replace(/,\s*muted$/i, '').trim();
      if (!label || out.some((g) => g.name === label)) return;
      out.push({ id: null, name: label });
    });
    return out;
  }
  function guildNameFromRail(guildId) {
    return null; // rail items carry names, not ids; resolved by name instead
  }
  function listGuilds() {
    const fromStores = listGuildsFromStores();
    if (fromStores.length) return fromStores;
    return listGuildsFromRail();
  }
  function guildName(id) {
    if (!id) return 'DM';
    const g = listGuilds().find((x) => x.id === id);
    if (g) return g.name;
    try {
      const gg = stores.guild && stores.guild.getGuild && stores.guild.getGuild(id);
      if (gg && gg.name) return gg.name;
    } catch (e) { /* ignore */ }
    return 'Server';
  }
  function currentGuildIdFromUrl() {
    const m = (location.pathname || '').match(/^\/channels\/(\d+)\//);
    return m ? m[1] : null;
  }
  function activeGuildName() {
    const sidebar = document.querySelector('[class*="sidebar_"]');
    if (sidebar) {
      const header = sidebar.querySelector('[class*="header_"]');
      if (header) {
        const nameEl = header.querySelector('h1, [class*="name_"]');
        if (nameEl && nameEl.textContent.trim()) return nameEl.textContent.trim();
      }
    }
    return null;
  }

  /* ---------------- voice log ---------------- */
  const LOG_KEY = 'dp_voice_log_v1';
  const MAX_LOG = 300;
  let voiceState = new Map();
  let firstScan = true;
  let trackingMode = 'dom'; // 'stores' or 'dom'

  function loadLog() {
    try { return JSON.parse(GM_getValue(LOG_KEY, '[]')); } catch (e) { return []; }
  }
  function saveLog(entries) {
    GM_setValue(LOG_KEY, JSON.stringify(entries.slice(-MAX_LOG)));
  }
  function addVoiceEvent(type, guild, channel, user) {
    const entries = loadLog();
    entries.push({ t: Date.now(), type, guild, channel, user });
    saveLog(entries);
    renderVoiceLog();
  }
  function diffVoice(now) {
    if (firstScan) {
      voiceState = now;
      firstScan = false;
      return;
    }
    if (now.size === 0 && voiceState.size > 0) {
      // Everything vanished at once: the user switched servers/views.
      // Reset the baseline silently instead of logging a mass exodus.
      voiceState = now;
      return;
    }
    now.forEach((v, k) => { if (!voiceState.has(k)) addVoiceEvent('join', v.guild, v.channel, v.user); });
    voiceState.forEach((v, k) => { if (!now.has(k)) addVoiceEvent('leave', v.guild, v.channel, v.user); });
    voiceState = now;
  }

  function scanVoiceStores() {
    if (!ensureStores()) return false;
    const now = new Map();
    let used = false;
    // Primary: all voice states at once.
    if (stores.voice && typeof stores.voice.getAllVoiceStates === 'function') {
      let all;
      try { all = stores.voice.getAllVoiceStates(); } catch (e) { all = null; }
      if (all) {
        const chanEntries = all instanceof Map ? Array.from(all.entries()) : Object.entries(all);
        for (const [channelId, users] of chanEntries) {
          const userIds = users instanceof Map ? Array.from(users.keys()) : Object.keys(users || {});
          if (!userIds.length) continue;
          let ch = null;
          try { ch = stores.channel.getChannel(channelId); } catch (e) { /* ignore */ }
          if (!ch) continue;
          const guildId = ch.guild_id || null;
          const guildName = resolveGuildName(guildId);
          if (!watchMatches(guildId, guildName)) continue;
          const channelName = ch.name || 'voice';
          for (const userId of userIds) {
            now.set((guildId || 'dm') + '|' + channelId + '|' + userId, { guild: guildName, guildId, channel: channelName, user: resolveUserName(userId) });
          }
        }
        used = true;
      }
    }
    // Secondary: enumerate channels and read each one's voice states.
    if (!used && stores.voice && typeof stores.voice.getVoiceStatesForChannel === 'function' && stores.channel && typeof stores.channel.getAllChannels === 'function') {
      let allChannels;
      try { allChannels = stores.channel.getAllChannels(); } catch (e) { allChannels = null; }
      if (allChannels) {
        const chanList = allChannels instanceof Map ? Array.from(allChannels.values()) : Object.values(allChannels);
        for (const ch of chanList) {
          if (!ch || !ch.id) continue;
          const guildId = ch.guild_id || null;
          const guildName = resolveGuildName(guildId);
          if (!watchMatches(guildId, guildName)) continue;
          let states;
          try { states = stores.voice.getVoiceStatesForChannel(ch.id); } catch (e) { continue; }
          if (!states) continue;
          const userIds = states instanceof Map ? Array.from(states.keys()) : Object.keys(states);
          for (const userId of userIds) {
            now.set((guildId || 'dm') + '|' + ch.id + '|' + userId, { guild: guildName, guildId, channel: ch.name || 'voice', user: resolveUserName(userId) });
          }
        }
        used = true;
      }
    }
    if (!used) return false;
    trackingMode = 'stores';
    diffVoice(now);
    return true;
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

  function scanVoiceDOM() {
    const currentGuild = currentGuildIdFromUrl();
    const currentName = activeGuildName() || guildName(currentGuild);
    if (watchKey() && !watchMatches(currentGuild, currentName)) {
      // Watching a specific server but viewing a different one: nothing visible to log.
      voiceState = new Map();
      firstScan = false;
      trackingMode = 'dom';
      return;
    }
    const sidebar = document.querySelector('[class*="sidebar"]');
    const scope = sidebar || document;
    const rows = scope.querySelectorAll('[class*="voiceUser"]');
    const now = new Map();
    rows.forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      const user = nameEl ? nameEl.textContent.trim() : '';
      if (!user) return;
      const channel = findChannelName(row) || 'voice';
      const gid = currentGuild || 'unknown';
      now.set(gid + '|' + channel + '|' + user, { guild: currentName, guildId: gid, channel, user });
    });
    trackingMode = 'dom';
    diffVoice(now);
  }

  function scanVoice() {
    if (!get('voiceLog')) return;
    if (scanVoiceStores()) return;
    scanVoiceDOM();
  }

  /* ---------------- theme engine ---------------- */
  let themeStyleEl = null;

  function buildThemeCss() {
    const preset = get('themePreset');
    const accent = get('accent') || '#7c5cff';
    const accentDark = shade(accent, -25);
    const accentLight = shade(accent, 30);
    const accentDeep = shade(accent, -70);
    const bgUrl = (get('bgUrl') || '').trim();
    const css = [];
    // declutter
    css.push('[aria-label="Send a gift"] { display: none !important; }');
    css.push('a[href="/shop"] { display: none !important; }');
    css.push('[aria-label="Shop"] { display: none !important; }');
    // accent (also drives the background gradient below)
    css.push(':root { --brand-500: ' + accent + ' !important; --brand-600: ' + accentDark + ' !important; --brand-400: ' + accentLight + ' !important; --dp-accent: ' + accent + ' !important; }');
    // background gradient: the accent is a stop, so changing the accent visibly changes the background
    let gradient;
    if (preset === 'glass') {
      gradient = 'linear-gradient(135deg, ' + accentDeep + ' 0%, ' + shade(accent, -10) + ' 45%, #0e3a4a 100%)';
    } else if (preset === 'midnight') {
      gradient = 'linear-gradient(180deg, #050507 0%, ' + accentDeep + ' 100%)';
    } else {
      gradient = 'linear-gradient(135deg, ' + accentDeep + ' 0%, ' + accent + ' 50%, #0a1a3a 100%)';
    }
    if (bgUrl) {
      css.push('[class*="appMount_"] { background-image: url("' + bgUrl.replace(/"/g, '') + '") !important; background-size: cover !important; background-position: center !important; }');
    } else {
      css.push('[class*="appMount_"] { background: ' + gradient + ' !important; }');
    }
    if (preset === 'glass' && !bgUrl) {
      css.push('[class*="appMount_"] { background-size: 300% 300% !important; animation: dpGrad 25s ease infinite !important; }');
      css.push('@keyframes dpGrad { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }');
    }
    // translucent panels so the gradient shows through, dark enough to read
    css.push('[class*="sidebar_"], [class*="chat_"], [class*="members_"], [class*="messagesWrapper_"] { background: rgba(8, 8, 18, 0.35) !important; backdrop-filter: blur(10px); }');
    // server icons: glow at rest, stronger on hover
    css.push('[class*="listItem_"] [class*="icon_"], [class*="listItem_"] img { border-radius: 14px !important; box-shadow: 0 0 8px ' + accent + '66 !important; transition: transform .15s ease, box-shadow .15s ease !important; }');
    css.push('[class*="listItem_"]:hover [class*="icon_"], [class*="listItem_"]:hover img { transform: scale(1.07); box-shadow: 0 0 16px ' + accent + ' !important; }');
    // message hover
    css.push('[id^="chat-messages-"]:hover { background: rgba(255,255,255,0.04) !important; border-radius: 8px; }');
    // accent scrollbar
    css.push('::-webkit-scrollbar { width: 10px !important; height: 10px !important; }');
    css.push('::-webkit-scrollbar-thumb { background: ' + accent + ' !important; border-radius: 8px !important; border: 2px solid transparent !important; background-clip: content-box !important; }');
    css.push('::-webkit-scrollbar-track { background: transparent !important; }');
    // midnight preset: flatter, darker panels
    if (preset === 'midnight') {
      css.push(':root { --background-primary: #0a0a10 !important; --background-secondary: #101018 !important; --background-tertiary: #15151f !important; }');
    }
    return css.join('\n');
  }

  function applyTheme() {
    if (themeStyleEl) { themeStyleEl.remove(); themeStyleEl = null; }
    if (get('themeOn')) themeStyleEl = GM_addStyle(buildThemeCss());
  }

  /* ---------------- UI: floating panel ---------------- */
  let panel = null;
  let panelOpen = false;

  function renderVoiceLog() {
    const list = document.getElementById('dp-log-list');
    if (list) {
      const entries = loadLog().slice().reverse();
      if (!entries.length) {
        list.innerHTML = '<div class="dp-empty">No voice activity logged yet.</div>';
      } else {
        list.innerHTML = entries.map((e) => {
          const verb = e.type === 'join' ? 'joined' : 'left';
          const cls = e.type === 'join' ? 'dp-join' : 'dp-leave';
          return '<div class="dp-log-row ' + cls + '"><span class="dp-time">' + fmtTime(e.t) + '</span> <strong>' + escapeHtml(e.user) + '</strong> ' + verb + ' <em>#' + escapeHtml(e.channel) + '</em> <span class="dp-guild">' + escapeHtml(e.guild || '') + '</span></div>';
        }).join('');
      }
    }
    const status = document.getElementById('dp-voice-status');
    if (status) {
      const key = watchKey();
      const watched = key ? (key.indexOf('name:') === 0 ? key.slice(5) : guildName(key)) : null;
      if (trackingMode === 'stores') {
        status.textContent = watched ? 'Watching ' + watched + ' in the background.' : 'Tracking every server in the background.';
      } else {
        status.textContent = watched ? 'Watching ' + watched + ' — switch to that server to log it.' : 'Only logs the server you are viewing right now.';
      }
    }
  }

  function refreshWatchSelect() {
    const sel = document.getElementById('dp-watch-guild');
    if (!sel) return;
    const guilds = listGuilds();
    const current = watchKey();
    let html = '<option value="">All servers</option>';
    guilds.forEach((g) => {
      const value = g.id ? g.id : 'name:' + g.name;
      html += '<option value="' + escapeHtml(value) + '">' + escapeHtml(g.name) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = current || '';
    // If the saved watch key is a name that is no longer listed, keep it visible.
    if (current && sel.value !== current) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current.indexOf('name:') === 0 ? current.slice(5) : current;
      sel.appendChild(opt);
      sel.value = current;
    }
  }

  function togglePanel() {
    ensurePanel();
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) {
      refreshWatchSelect();
      renderVoiceLog();
      markActivePreset();
    }
  }

  function markActivePreset() {
    const preset = get('themePreset');
    document.querySelectorAll('#dp-panel [data-preset]').forEach((b) => {
      b.classList.toggle('dp-preset-active', b.getAttribute('data-preset') === preset);
    });
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
      '<div class="dp-section"><div class="dp-section-title">Watch server</div>' +
      '<select id="dp-watch-guild"></select>' +
      '<div class="dp-note">Pick a server to track its voice activity. Background tracking needs Discord\u2019s internal data; if that is unavailable the log only covers the server you are viewing.</div></div>' +
      '<div class="dp-section"><div class="dp-section-title">Voice log <button id="dp-log-clear">Clear</button></div>' +
      '<div id="dp-log-list" class="dp-log-list"></div>' +
      '<div id="dp-voice-status" class="dp-note"></div></div>' +
      '<div class="dp-section"><div class="dp-section-title">Look</div>' +
      '<div class="dp-presets">' +
      '<button data-preset="neon">Neon</button>' +
      '<button data-preset="glass">Glass</button>' +
      '<button data-preset="midnight">Midnight</button>' +
      '</div>' +
      '<label>Accent <input type="color" id="dp-accent"></label>' +
      '<label>Background image URL <input type="text" id="dp-bgurl" placeholder="https://..."></label>' +
      '<div class="dp-note">The accent color tints the background gradient, so changing it changes the whole look. Paste any image URL for a custom background, or leave it empty for the preset gradient.</div></div>' +
      '<div class="dp-section"><div class="dp-section-title">Settings</div>' +
      '<label><input type="checkbox" id="dp-set-voice"> Voice join/leave log</label>' +
      '<label><input type="checkbox" id="dp-set-theme"> Custom look</label>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('#dp-panel-close').addEventListener('click', togglePanel);
    panel.querySelector('#dp-log-clear').addEventListener('click', () => { saveLog([]); renderVoiceLog(); });

    const watchSel = panel.querySelector('#dp-watch-guild');
    watchSel.addEventListener('change', () => {
      set('watchGuildId', watchSel.value || null);
      voiceState = new Map();
      firstScan = true;
      renderVoiceLog();
    });

    panel.querySelectorAll('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        set('themePreset', b.getAttribute('data-preset'));
        applyTheme();
        markActivePreset();
      });
    });
    const accentInput = panel.querySelector('#dp-accent');
    accentInput.value = get('accent');
    accentInput.addEventListener('input', () => { set('accent', accentInput.value); applyTheme(); });
    const bgInput = panel.querySelector('#dp-bgurl');
    bgInput.value = get('bgUrl');
    bgInput.addEventListener('change', () => { set('bgUrl', bgInput.value.trim()); applyTheme(); });

    const voiceCb = panel.querySelector('#dp-set-voice');
    const themeCb = panel.querySelector('#dp-set-theme');
    voiceCb.checked = get('voiceLog');
    themeCb.checked = get('themeOn');
    voiceCb.addEventListener('change', () => {
      set('voiceLog', voiceCb.checked);
      if (!voiceCb.checked) { voiceState = new Map(); firstScan = true; }
    });
    themeCb.addEventListener('change', () => { set('themeOn', themeCb.checked); applyTheme(); });

    refreshWatchSelect();
    renderVoiceLog();
    markActivePreset();
    return panel;
  }

  /* ---------------- core UI styles (always on) ---------------- */
  const UI_CSS = [
    '#dp-fab { position: fixed; right: 16px; bottom: 16px; z-index: 9999; width: 44px; height: 44px; border-radius: 50%; border: none; background: var(--dp-accent, #7c5cff); color: #fff; font-weight: 700; font-size: 14px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.4); }',
    '#dp-fab:hover { filter: brightness(1.15); }',
    '#dp-panel { position: fixed; right: 16px; bottom: 72px; z-index: 9999; width: 340px; max-height: 70vh; overflow-y: auto; display: none; background: #1e1f22; color: #dbdee1; border: 1px solid #3f4147; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5); font-family: inherit; font-size: 14px; }',
    '.dp-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #3f4147; }',
    '.dp-panel-head button { background: none; border: none; color: #dbdee1; cursor: pointer; font-size: 14px; }',
    '.dp-section { padding: 10px 12px; border-bottom: 1px solid #2b2d31; }',
    '.dp-section-title { font-weight: 700; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }',
    '.dp-section label { display: block; margin: 6px 0; }',
    '.dp-section select, .dp-section input[type="text"] { width: 100%; box-sizing: border-box; background: #2b2d31; color: #dbdee1; border: 1px solid #3f4147; border-radius: 6px; padding: 5px 8px; margin-top: 4px; }',
    '.dp-section input[type="color"] { vertical-align: middle; margin-left: 6px; background: none; border: none; width: 40px; height: 26px; padding: 0; cursor: pointer; }',
    '.dp-presets { display: flex; gap: 6px; margin-bottom: 8px; }',
    '.dp-presets button { flex: 1; background: #2b2d31; color: #dbdee1; border: 1px solid #3f4147; border-radius: 8px; padding: 6px 0; cursor: pointer; font-size: 13px; }',
    '.dp-presets button.dp-preset-active { border-color: var(--dp-accent, #7c5cff); color: #fff; box-shadow: 0 0 8px var(--dp-accent, #7c5cff); }',
    '.dp-log-list { max-height: 220px; overflow-y: auto; }',
    '.dp-log-row { padding: 3px 0; }',
    '.dp-time { color: #949ba4; }',
    '.dp-guild { color: #949ba4; font-size: 12px; }',
    '.dp-join strong { color: #3ba55d; }',
    '.dp-leave strong { color: #ed4245; }',
    '.dp-empty { color: #949ba4; }',
    '.dp-note { color: #949ba4; font-size: 12px; margin-top: 8px; }',
    '#dp-log-clear { background: #2b2d31; color: #dbdee1; border: 1px solid #3f4147; border-radius: 6px; padding: 2px 8px; cursor: pointer; }',
    '[id^="chat-messages-"] { position: relative; }'
  ].join('\n');

  /* ---------------- boot ---------------- */
  function boot() {
    try {
      GM_addStyle(UI_CSS);
      ensurePanel();
      applyTheme();
      setInterval(scanVoice, 2000);
      GM_registerMenuCommand('Discord Plus: open panel', togglePanel);
      GM_registerMenuCommand('Discord Plus: toggle voice log', () => { set('voiceLog', !get('voiceLog')); });
      GM_registerMenuCommand('Discord Plus: toggle custom look', () => { set('themeOn', !get('themeOn')); applyTheme(); });
      log('loaded v2.1.0');
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
