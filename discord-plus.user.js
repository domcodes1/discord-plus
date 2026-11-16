// ==UserScript==
// @name         Discord Plus
// @namespace    https://github.com/domcodes1/discord-plus
// @version      2.0.0
// @description  Discord web extras: voice join/leave log for a server you pick (tracked in the background), and a full custom theme engine.
// @author       domcodes1
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @match        https://discordapp.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
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
  const watchGuildId = () => get('watchGuildId') || null;

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

  /* ---------------- guild list (for the server picker) ---------------- */
  function listGuilds() {
    const out = [];
    document.querySelectorAll('a[href^="/channels/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/^\/channels\/(\d+)\//);
      if (!m) return;
      const id = m[1];
      if (out.some((g) => g.id === id)) return;
      let label = a.getAttribute('aria-label') || '';
      label = label.replace(/,\s*\d+ unread.*$/i, '').replace(/,\s*muted$/i, '').trim();
      out.push({ id, name: label || id });
    });
    return out;
  }
  function guildName(id) {
    if (!id) return 'DM';
    const g = listGuilds().find((x) => x.id === id);
    return g ? g.name : 'Server';
  }
  function currentGuildIdFromUrl() {
    const m = (location.pathname || '').match(/^\/channels\/(\d+)\//);
    return m ? m[1] : null;
  }

  /* ---------------- Discord internal stores (background voice data) ---------------- */
  let wpRequire = null;
  let stores = { voice: null, channel: null, user: null, guild: null };
  let lastStoreAttempt = 0;

  function getWpRequire() {
    if (wpRequire) return wpRequire;
    const chunk = window.webpackChunkdiscord_app;
    if (!chunk || typeof chunk.push !== 'function') return null;
    try {
      chunk.push([['dp' + Math.random().toString(36).slice(2)], {}, (req) => { wpRequire = req; }]);
    } catch (e) { return null; }
    return wpRequire;
  }
  function findStore(props) {
    const req = getWpRequire();
    if (!req || !req.c) return null;
    const cache = req.c;
    for (const id in cache) {
      const mod = cache[id];
      if (!mod || !mod.exports) continue;
      const candidates = [mod.exports, mod.exports.default, mod.exports.Z];
      for (const cand of candidates) {
        if (cand && typeof cand === 'object' && props.every((p) => typeof cand[p] === 'function')) {
          return cand;
        }
      }
    }
    return null;
  }
  function ensureStores() {
    if (stores.voice && stores.channel && stores.user) return true;
    const now = Date.now();
    if (now - lastStoreAttempt < 10000) return false;
    lastStoreAttempt = now;
    if (!stores.voice) stores.voice = findStore(['getVoiceStatesForChannel', 'getAllVoiceStates', 'getVoiceStateForUser']);
    if (!stores.channel) stores.channel = findStore(['getChannel', 'getDMChannelFromUserId']);
    if (!stores.user) stores.user = findStore(['getUser', 'getCurrentUser']);
    if (!stores.guild) stores.guild = findStore(['getGuild', 'getGuilds']);
    const ok = !!(stores.voice && stores.channel && stores.user);
    if (ok) log('background voice tracking on (Discord stores found)');
    return ok;
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
    let all;
    try { all = stores.voice.getAllVoiceStates(); } catch (e) { return false; }
    if (!all) return false;
    const now = new Map();
    const chanEntries = all instanceof Map ? Array.from(all.entries()) : Object.entries(all);
    for (const [channelId, users] of chanEntries) {
      const userIds = users instanceof Map ? Array.from(users.keys()) : Object.keys(users || {});
      if (!userIds.length) continue;
      let ch = null;
      try { ch = stores.channel.getChannel(channelId); } catch (e) { /* ignore */ }
      if (!ch) continue;
      const guildId = ch.guild_id || null;
      if (watchGuildId() && guildId !== watchGuildId()) continue;
      let guildName = 'DM';
      if (guildId) {
        try {
          const g = stores.guild ? stores.guild.getGuild(guildId) : null;
          guildName = (g && g.name) || guildName(guildId);
        } catch (e) { guildName = guildName(guildId); }
      }
      const channelName = ch.name || 'voice';
      for (const userId of userIds) {
        let user = userId;
        try {
          const u = stores.user.getUser(userId);
          if (u) user = u.globalName || u.username || userId;
        } catch (e) { /* ignore */ }
        now.set((guildId || 'dm') + '|' + channelId + '|' + userId, { guild: guildName, guildId, channel: channelName, user });
      }
    }
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
    if (watchGuildId() && currentGuild && currentGuild !== watchGuildId()) {
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
      now.set(gid + '|' + channel + '|' + user, { guild: guildName(gid), guildId: gid, channel, user });
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
  const GRADIENTS = {
    neon: 'linear-gradient(135deg, #0b0b1a 0%, #1a0b2e 55%, #0b1a2e 100%)',
    glass: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    midnight: 'linear-gradient(180deg, #050507 0%, #0a0a12 100%)'
  };

  function buildThemeCss() {
    const preset = get('themePreset');
    const accent = get('accent') || '#7c5cff';
    const accentDark = shade(accent, -25);
    const accentLight = shade(accent, 30);
    const bgUrl = (get('bgUrl') || '').trim();
    const css = [];
    // declutter
    css.push('[aria-label="Send a gift"] { display: none !important; }');
    css.push('a[href="/shop"] { display: none !important; }');
    css.push('[aria-label="Shop"] { display: none !important; }');
    // accent + dp accent variable for the panel button
    css.push(':root { --brand-500: ' + accent + ' !important; --brand-600: ' + accentDark + ' !important; --brand-400: ' + accentLight + ' !important; --dp-accent: ' + accent + ' !important; }');
    // app background
    if (bgUrl) {
      css.push('[class*="appMount_"] { background-image: url("' + bgUrl.replace(/"/g, '') + '") !important; background-size: cover !important; background-position: center !important; }');
    } else {
      css.push('[class*="appMount_"] { background: ' + (GRADIENTS[preset] || GRADIENTS.neon) + ' !important; }');
    }
    if (preset === 'glass' && !bgUrl) {
      css.push('[class*="appMount_"] { background-size: 300% 300% !important; animation: dpGrad 25s ease infinite !important; }');
      css.push('@keyframes dpGrad { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }');
    }
    // glass columns so the background shows through, dark enough to read
    css.push('[class*="sidebar_"], [class*="chat_"], [class*="members_"], [class*="messagesWrapper_"] { background: rgba(8, 8, 18, 0.55) !important; backdrop-filter: blur(10px); }');
    // server icons: rounded with a glow on hover
    css.push('[class*="listItem_"] [class*="icon_"], [class*="listItem_"] img { border-radius: 14px !important; transition: transform .15s ease, box-shadow .15s ease !important; }');
    css.push('[class*="listItem_"]:hover [class*="icon_"], [class*="listItem_"]:hover img { transform: scale(1.07); box-shadow: 0 0 14px ' + accent + ' !important; }');
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
      const watched = watchGuildId() ? guildName(watchGuildId()) : null;
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
    const current = watchGuildId();
    sel.innerHTML = '<option value="">All servers</option>' + guilds.map((g) => '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</option>').join('');
    sel.value = current || '';
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
      '<div class="dp-note">Voice activity is logged for this server, even while you are looking at another server or your DMs.</div></div>' +
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
      '<div class="dp-note">Paste any image URL for a custom background. Leave it empty for the preset gradient.</div></div>' +
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
      log('loaded v2.0.0');
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
