// ==UserScript==
// @name         Discord Plus
// @namespace    https://github.com/domcodes1/discord-plus
// @version      3.0.4
// @description  Discord web extras: voice join/leave log, Live Now voice/stream preview without joining, deleted-message viewer, and a cleaner tabbed panel with a subtle theme engine.
// @author       domcodes1
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @match        https://discordapp.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
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
    deletedLog: true,
    liveNow: true,
    themeOn: true,
    themePreset: 'clean',
    accent: '#5865f2',
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
    let h = String(hex || '#5865f2').replace('#', '');
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
  function currentChannelIdFromUrl() {
    const m = (location.pathname || '').match(/^\/channels\/\d+\/(\d+)/);
    return m ? m[1] : null;
  }
  function currentGuildIdFromUrl() {
    const m = (location.pathname || '').match(/^\/channels\/(\d+)\//);
    return m ? m[1] : null;
  }

  /* ---------------- Discord internal stores ---------------- */
  let wpRequire = null;
  let stores = { voice: null, channel: null, user: null, guild: null, message: null, dispatcher: null, stream: null, speaking: null };
  let lastStoreAttempt = 0;
  // Diagnostics for the req.m factory search (v3.0.3).
  let mSizeCache = 0;
  let mFoundVoiceFactory = false;

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (e) { /* ignore */ }
    return window;
  }
  const WP_CHUNK_NAMES = ['webpackChunkdiscord_app', 'webpackChunkdiscord', 'webpackChunkclient_app', 'webpackChunkdiscord_client'];
  function getChunkArray(pw) {
    if (!pw) return null;
    for (const name of WP_CHUNK_NAMES) {
      if (pw[name] && typeof pw[name].push === 'function') return pw[name];
    }
    // Fallback: any window key starting with webpackChunk, plus Symbol keys.
    try {
      for (const k of Object.keys(pw)) {
        if (k.indexOf('webpackChunk') === 0 && pw[k] && typeof pw[k].push === 'function') return pw[k];
      }
      for (const s of Object.getOwnPropertySymbols(pw)) {
        const v = pw[s];
        if (v && typeof v.push === 'function') return v;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function injectWpRequire() {
    // Tampermonkey's sandbox cannot always reach the page webpack require
    // directly, so inject a plain <script> into page context that grabs it
    // and stores it on window.__dpWpRequire for the userscript to read.
    try {
      const pw = getPageWindow();
      if (pw && pw.__dpWpRequire) return true;
      if (typeof document === 'undefined' || !document.documentElement) return false;
      const s = document.createElement('script');
      s.textContent = '(function(){try{var names=["webpackChunkdiscord_app","webpackChunkdiscord","webpackChunkclient_app","webpackChunkdiscord_client"];for(var i=0;i<names.length;i++){var c=window[names[i]];if(c&&typeof c.push==="function"){c.push([["dp-inject"],{},function(r){window.__dpWpRequire=r;}]);return;}}var keys=Object.keys(window);for(var j=0;j<keys.length;j++){if(keys[j].indexOf("webpackChunk")===0){var c2=window[keys[j]];if(c2&&typeof c2.push==="function"){c2.push([["dp-inject"],{},function(r){window.__dpWpRequire=r;}]);return;}}}}catch(e){}})();';
      document.documentElement.appendChild(s);
      s.remove();
      return !!(pw && pw.__dpWpRequire);
    } catch (e) { return false; }
  }
  function getWpRequire() {
    if (wpRequire) return wpRequire;
    const pw = getPageWindow();
    if (pw && pw.__dpWpRequire) { wpRequire = pw.__dpWpRequire; return wpRequire; }
    const chunk = getChunkArray(pw) || getChunkArray(window);
    if (!chunk || typeof chunk.push !== 'function') return null;
    try {
      chunk.push([['dp' + Math.random().toString(36).slice(2)], {}, (req) => { wpRequire = req; }]);
    } catch (e) { return null; }
    // The injected page-context require is the fallback if the direct push did not run.
    if (!wpRequire && pw && pw.__dpWpRequire) wpRequire = pw.__dpWpRequire;
    return wpRequire;
  }
  function storeMatches(cand, props, anyOf) {
    if (!cand) return false;
    if (typeof cand !== 'object' && typeof cand !== 'function') return false;
    if (anyOf) return props.some((p) => typeof cand[p] === 'function');
    return props.every((p) => typeof cand[p] === 'function');
  }
  // v3.0.4 store probe: small summary of what the req.m voice factory
  // search actually found, shown in the Diagnostics line. Only summary
  // fields are stored, never full source or large objects.
  let storeProbe = { factoryId: null, reqResultType: '', reqResultKeys: [], nestedMatch: false, threw: false, found: false };
  function isVoiceProps(props) {
    return props && props.indexOf('getVoiceStatesForChannel') !== -1;
  }
  // v3.0.4: expanded candidate list for a module export. Existing
  // candidates first, so working paths are unchanged, then deeper ones:
  // exp.default.Z, exp.Z.default, exp.prototype, and one level of nested
  // object/function values of exp, exp.default and exp.Z (max 25 keys
  // each, try/catch guarded, no recursion beyond one level).
  function expandedCandidates(exp) {
    const out = [];
    const push = (c) => { if (c && out.indexOf(c) === -1) out.push(c); };
    push(exp);
    if (exp) {
      push(exp.default);
      push(exp.Z);
      try { if (exp.default) push(exp.default.Z); } catch (e) { /* ignore */ }
      try { if (exp.Z) push(exp.Z.default); } catch (e) { /* ignore */ }
      try { if (typeof exp === 'function' && exp.prototype) push(exp.prototype); } catch (e) { /* ignore */ }
      const bases = [exp, exp.default, exp.Z];
      for (const base of bases) {
        if (!base || (typeof base !== 'object' && typeof base !== 'function')) continue;
        try {
          const keys = Object.keys(base).slice(0, 25);
          for (const k of keys) {
            let v;
            try { v = base[k]; } catch (e) { continue; }
            if (v && (typeof v === 'object' || typeof v === 'function')) push(v);
          }
        } catch (e) { /* ignore */ }
      }
    }
    return out;
  }
  function findStore(props, anyOf) {
    const req = getWpRequire();
    if (!req) return null;
    const voice = isVoiceProps(props);
    // First: the loaded module cache, req.c (existing path).
    if (req.c) {
      const cache = req.c;
      for (const id in cache) {
        const mod = cache[id];
        if (!mod || !mod.exports) continue;
        const exp = mod.exports;
        for (const cand of expandedCandidates(exp)) {
          if (storeMatches(cand, props, anyOf)) {
            if (voice) { storeProbe.found = true; }
            return cand;
          }
        }
      }
    }
    // Second (v3.0.3): the module factories, req.m. A store that lives
    // in .m but has not been loaded into .c yet cannot be found by the
    // cache search alone. Check the factory source for the wanted
    // method names, then instantiate it with req(id) and check exports.
    try {
      const factories = req.m || {};
      const ids = Object.keys(factories);
      mSizeCache = ids.length;
      for (const id of ids) {
        const factory = factories[id];
        if (typeof factory !== 'function') continue;
        let src = '';
        try { src = Function.prototype.toString.call(factory); } catch (e) { continue; }
        const wants = anyOf ? props.some((p) => src.indexOf(p) !== -1) : props.every((p) => src.indexOf(p) !== -1);
        if (!wants) continue;
        if (voice) mFoundVoiceFactory = true;
        let mod;
        try { mod = req(id); } catch (e) {
          if (voice) { storeProbe.factoryId = id; storeProbe.threw = true; }
          continue;
        }
        if (!mod) continue;
        const exp = mod.exports || mod;
        if (voice) {
          storeProbe.factoryId = id;
          storeProbe.threw = false;
          try { storeProbe.reqResultType = typeof exp; } catch (e) { storeProbe.reqResultType = ''; }
          try { storeProbe.reqResultKeys = Object.keys(exp).slice(0, 12).map(String); } catch (e) { storeProbe.reqResultKeys = []; }
        }
        const candidates = expandedCandidates(exp);
        for (const cand of candidates) {
          if (storeMatches(cand, props, anyOf)) {
            if (voice) { storeProbe.found = true; storeProbe.nestedMatch = candidates.indexOf(cand) > 2; }
            return cand;
          }
        }
        if (voice) {
          // No direct candidate matched: check whether any one-level
          // nested value carries the wanted method (probe only).
          try {
            storeProbe.nestedMatch = candidates.some((c) => c && props.some((p) => typeof c[p] === 'function'));
          } catch (e) { storeProbe.nestedMatch = false; }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function ensureStores() {
    const now = Date.now();
    if (now - lastStoreAttempt < 5000) return !!(stores.voice && stores.channel && stores.user);
    lastStoreAttempt = now;
    if (!stores.voice) stores.voice = findStore(['getVoiceStatesForChannel', 'getAllVoiceStates'], true);
    if (!stores.channel) stores.channel = findStore(['getChannel', 'getDMChannelFromUserId'], true);
    if (!stores.user) stores.user = findStore(['getUser', 'getCurrentUser'], true);
    if (!stores.guild) stores.guild = findStore(['getGuild', 'getGuilds'], true);
    if (!stores.message) stores.message = findStore(['getMessage', 'getMessages'], true);
    if (!stores.dispatcher) stores.dispatcher = findStore(['subscribe', 'dispatch'], false);
    if (!stores.stream) stores.stream = findStore(['getAllApplicationStreams', 'getStreamForUser'], true);
    if (!stores.speaking) stores.speaking = findStore(['isSpeaking'], true);
    const ok = !!(stores.voice && stores.channel && stores.user);
    if (ok) log('stores found, voice tracking on');
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
    return 'Server';
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
    // Primary: Discord's server rail items carry data-list-item-id like
    // "guildsnav___828370043867496531" and an aria-label with the server name.
    document.querySelectorAll('[data-list-item-id*="guildsnav"]').forEach((el) => {
      const raw = el.getAttribute('data-list-item-id') || '';
      const parts = raw.split('___');
      const id = parts.length ? parts[parts.length - 1] : '';
      if (!/^\d{10,}$/.test(id)) return;
      let label = (el.getAttribute('aria-label') || '').trim();
      label = label.replace(/,\s*\d+ unread.*$/i, '').replace(/,\s*muted$/i, '').trim();
      if (!label || out.some((g) => g.id === id)) return;
      out.push({ id, name: label });
    });
    // Fallback: any aria-label in the server rail.
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
  function listGuilds() {
    const merged = [];
    const push = (g) => {
      if (!g || !g.name) return;
      if (g.id && merged.some((x) => x.id === g.id)) return;
      if (!g.id && merged.some((x) => x.name === g.name)) return;
      merged.push(g);
    };
    listGuildsFromStores().forEach(push);
    listGuildsFromRail().forEach(push);
    // Always include the server the user is currently in, even if the
    // stores and the rail both missed it (e.g. it is in a folder).
    const curId = currentGuildIdFromUrl();
    const curName = activeGuildName();
    if (curId && curName) push({ id: curId, name: curName });
    return merged;
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
  let trackingMode = 'dom';
  // Grace period: a user must be missing for 3 consecutive scans
  // (about 6 seconds) before a leave is logged. This stops duplicate
  // joins and false leave/join pairs from transient empty DOM scans.
  let missingCounts = new Map();

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
      missingCounts = new Map();
      return;
    }
    // Empty scan: the sidebar may not have rendered yet, or the user just
    // switched views. Do NOT clear state or log mass leaves; just skip it.
    if (now.size === 0) return;
    const next = new Map(voiceState);
    now.forEach((v, k) => {
      if (!voiceState.has(k)) addVoiceEvent('join', v.guild, v.channel, v.user);
      if (missingCounts.has(k)) missingCounts.delete(k);
      next.set(k, v);
    });
    voiceState.forEach((v, k) => {
      if (now.has(k)) return;
      const count = (missingCounts.get(k) || 0) + 1;
      missingCounts.set(k, count);
      if (count >= 3) {
        addVoiceEvent('leave', v.guild, v.channel, v.user);
        missingCounts.delete(k);
        next.delete(k);
      }
    });
    voiceState = next;
  }

  function scanVoiceStores() {
    if (!ensureStores()) return false;
    const now = new Map();
    let used = false;
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

  function cleanAriaChannelName(label) {
    // Live label example: "📌 compy wompy (voice channel), unread, cute fat boy, XX, Command, and 3 others, Private Channel (locked)"
    // "(voice channel)" is in the MIDDLE, not at the end, so a trailing
    // replace never strips it. Cut at " (voice channel)" and at ", unread".
    let s = String(label || '');
    const vc = s.indexOf(' (voice channel)');
    if (vc !== -1) s = s.slice(0, vc);
    const unread = s.indexOf(', unread');
    if (unread !== -1) s = s.slice(0, unread);
    return s.trim() || null;
  }
  function findChannelInfo(row) {
    let el = row.parentElement;
    while (el && el !== document.body) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('containerDefault') !== -1) {
        // Stable id, if the container or its link carries one.
        let id = null;
        const link = el.querySelector('a[aria-label]');
        const idAttrs = [];
        if (el.getAttribute) { idAttrs.push(el.getAttribute('data-list-item-id'), el.getAttribute('id')); }
        if (link && link.getAttribute) { idAttrs.push(link.getAttribute('data-list-item-id'), link.getAttribute('id')); }
        for (const a of idAttrs) {
          const m = String(a || '').match(/(\d{17,20})/g);
          if (m && m.length) { id = m[m.length - 1]; break; }
        }
        // Name: prefer the clean name element inside the channel link.
        // The link only holds the channel header, never the voice users.
        let name = null;
        if (link) {
          const nameEl = link.querySelector('[class*="name"]');
          if (nameEl && nameEl.textContent.trim()) name = nameEl.textContent.trim();
        }
        if (!name) {
          // Fallback: first name-ish element in the container that is
          // not inside a voice user row.
          const candidates = el.querySelectorAll('[class*="name"]');
          for (const c of candidates) {
            if (c.closest && c.closest('[class*="voiceUser"]')) continue;
            if (c.textContent && c.textContent.trim()) { name = c.textContent.trim(); break; }
          }
        }
        // Last fallback: the aria-label, cut at " (voice channel)" and ", unread".
        if (!name && link) name = cleanAriaChannelName(link.getAttribute('aria-label') || '');
        return { name: name || null, id: id || null };
      }
      el = el.parentElement;
    }
    return { name: null, id: null };
  }
  function findChannelName(row) {
    return findChannelInfo(row).name;
  }

  function scanVoiceDOM() {
    const currentGuild = currentGuildIdFromUrl();
    const currentName = activeGuildName() || guildName(currentGuild);
    if (watchKey() && !watchMatches(currentGuild, currentName)) {
      // Watching a different server: skip this scan, do not clear state
      // or log false leaves for the watched server.
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
      const info = findChannelInfo(row);
      const channel = info.name || 'voice';
      // Stable key: channel id when available, else the clean name.
      // Never use the aria-label occupant list / unread state in the key.
      const chanKey = info.id || channel;
      const gid = currentGuild || 'unknown';
      now.set(gid + '|' + chanKey + '|' + user, { guild: currentName, guildId: gid, channel, user });
    });
    trackingMode = 'dom';
    diffVoice(now);
  }

  function scanVoice() {
    if (!get('voiceLog')) return;
    if (scanVoiceStores()) return;
    scanVoiceDOM();
  }

  /* ---------------- Live Now: who is in voice / speaking / streaming, without joining ---------------- */
  let liveCache = [];
  let liveUpdatedAt = 0;
  // v3.0.4 cumulative Live cache: DOM scans only see voice channels that
  // are currently rendered (scrolled into view), so a wholesale replace
  // drops channels that simply scrolled out of view. Merge instead: a
  // channel seen in this scan replaces its own user list, channels not
  // seen are kept for up to 60s, then pruned.
  let liveMerged = new Map();

  // v3.0.4: the LIVE pill is a separate element on the voice row, and it
  // may live outside the [class*="voiceUser"] element itself (a sibling,
  // or in a wrapper around the row). Collect a wider scope for a row:
  // the row, its siblings, and ancestors up to the channel container.
  // Careful: an ancestor that contains several voiceUser rows also
  // contains OTHER users' LIVE pills, so ancestor text is only trusted
  // when the ancestor holds exactly this one voiceUser row.
  function liveRowScope(row) {
    const els = [row];
    if (row.nextElementSibling) els.push(row.nextElementSibling);
    if (row.previousElementSibling) els.push(row.previousElementSibling);
    let el = row.parentElement;
    while (el && el !== document.body) {
      els.push(el);
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('containerDefault') !== -1 || cls.indexOf('voiceChannel') !== -1) break;
      el = el.parentElement;
    }
    return els;
  }
  function scopeVoiceUserCount(el) {
    try { return el.querySelectorAll ? el.querySelectorAll('[class*="voiceUser"]').length : 0; } catch (e) { return 0; }
  }
  // Trust rule for a scope element: if it wraps this row, trust it only
  // when it holds exactly one voiceUser row (this one), so another
  // user's LIVE pill cannot leak in. If it does not wrap this row (a
  // sibling), trust it only when it holds no voiceUser row at all, so a
  // neighbouring user's row is never read as this user's.
  function scopeElementTrusted(el, row) {
    try {
      // An element that IS a voiceUser row is another user's row, never
      // this user's (row itself is already skipped by callers).
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('voiceUser') !== -1) return false;
      if (el.contains && el.contains(row)) return scopeVoiceUserCount(el) === 1;
      return scopeVoiceUserCount(el) === 0;
    } catch (e) { return false; }
  }
  function scopeHasLive(row) {
    // Row itself (v3.0.3 check, kept).
    if ((row.textContent && row.textContent.indexOf('LIVE') !== -1) || row.querySelector('[class*="live"], [class*="Live"], [aria-label*="LIVE"], [aria-label*="live"]')) return true;
    const scope = liveRowScope(row);
    for (const el of scope) {
      if (el === row) continue;
      if (!scopeElementTrusted(el, row)) continue;
      try {
        if (el.querySelector && el.querySelector('[class*="live"], [class*="Live"], [aria-label*="LIVE"], [aria-label*="live"]')) return true;
        if (el.textContent && el.textContent.indexOf('LIVE') !== -1) return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }
  function scopeIsSpeaking(row) {
    if (!!row.querySelector('[class*="avatarSpeaking"], [class*="speaking"]')) return true;
    try {
      const avatar = row.querySelector('[class*="avatar"]');
      const style = avatar ? (avatar.getAttribute('style') || '') : '';
      if (style.indexOf('3ba55d') !== -1 || style.indexOf('59, 165, 93') !== -1 || style.indexOf('59,165,93') !== -1) return true;
    } catch (e) { /* ignore */ }
    if (row.textContent && row.textContent.indexOf('Speaking') !== -1) return true;
    const scope = liveRowScope(row);
    for (const el of scope) {
      if (el === row) continue;
      if (!scopeElementTrusted(el, row)) continue;
      try {
        if (el.querySelector && el.querySelector('[class*="avatarSpeaking"], [class*="speaking"]')) return true;
        if (el.textContent && el.textContent.indexOf('Speaking') !== -1) return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }
  function speakingFromDOM() {
    const out = new Map();
    document.querySelectorAll('[class*="voiceUser"]').forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      const name = nameEl ? nameEl.textContent.trim() : '';
      if (!name) return;
      out.set(name, scopeIsSpeaking(row));
    });
    return out;
  }
  function streamFromDOM() {
    // LIVE is a separate red pill on the right of the voiceUser row,
    // not part of the button name, so check the row itself (v3.0.3)
    // plus the wider scope around it (v3.0.4): siblings and wrappers.
    const out = new Map();
    document.querySelectorAll('[class*="voiceUser"]').forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      const name = nameEl ? nameEl.textContent.trim() : '';
      if (!name) return;
      out.set(name, scopeHasLive(row));
    });
    return out;
  }
  function streamOwners() {
    const out = new Set();
    try {
      if (stores.stream && typeof stores.stream.getAllApplicationStreams === 'function') {
        const all = stores.stream.getAllApplicationStreams();
        const list = all instanceof Map ? Array.from(all.values()) : Object.values(all || {});
        list.forEach((s) => { if (s && s.ownerId) out.add(String(s.ownerId)); });
      }
    } catch (e) { /* ignore */ }
    return out;
  }
  function scanLive() {
    if (!get('liveNow')) { liveCache = []; liveMerged = new Map(); return; }
    // Do NOT return early when stores fail: fall through to the DOM
    // sidebar scan below, so Live Now works in DOM mode too.
    ensureStores();
    const speakingDom = speakingFromDOM();
    const streamingDom = streamFromDOM();
    const streams = streamOwners();
    const byChannel = new Map();
    const addUser = (guild, guildId, channelId, channelName, userId, state) => {
      if (!watchMatches(guildId, guild)) return;
      const key = channelId;
      if (!byChannel.has(key)) byChannel.set(key, { channel: channelName, guild, users: [] });
      const name = resolveUserName(userId);
      let speaking = false;
      try {
        if (stores.speaking && typeof stores.speaking.isSpeaking === 'function') speaking = !!stores.speaking.isSpeaking(userId);
      } catch (e) { /* ignore */ }
      if (!speaking) speaking = speakingDom.get(name) || false;
      const streaming = !!(state && (state.selfStream || state.streaming)) || streams.has(String(userId)) || streamingDom.get(name) || false;
      const muted = !!(state && (state.selfMute || state.mute));
      byChannel.get(key).users.push({ user: name, userId: String(userId), speaking, streaming, muted });
    };
    let used = false;
    if (stores.voice && typeof stores.voice.getAllVoiceStates === 'function') {
      try {
        const all = stores.voice.getAllVoiceStates();
        if (all) {
          const entries = all instanceof Map ? Array.from(all.entries()) : Object.entries(all);
          for (const [channelId, users] of entries) {
            const map = users instanceof Map ? users : new Map(Object.entries(users || {}));
            if (!map.size) continue;
            let ch = null;
            try { ch = stores.channel.getChannel(channelId); } catch (e) { /* ignore */ }
            if (!ch) continue;
            const guildId = ch.guild_id || null;
            const guild = resolveGuildName(guildId);
            map.forEach((state, userId) => addUser(guild, guildId, channelId, ch.name || 'voice', userId, state));
          }
          used = true;
        }
      } catch (e) { /* ignore */ }
    }
    if (!used) {
      const sidebar = document.querySelector('[class*="sidebar"]');
      const scope = sidebar || document;
      scope.querySelectorAll('[class*="voiceUser"]').forEach((row) => {
        const nameEl = row.querySelector('[class*="username"]');
        const user = nameEl ? nameEl.textContent.trim() : '';
        if (!user) return;
        const info = findChannelInfo(row);
        const channel = info.name || 'voice';
        const gid = currentGuildIdFromUrl();
        const guild = activeGuildName() || guildName(gid);
        if (!watchMatches(gid, guild)) return;
        const key = info.id || channel;
        if (!byChannel.has(key)) byChannel.set(key, { channel, guild, users: [] });
        byChannel.get(key).users.push({ user, userId: '', speaking: speakingDom.get(user) || false, streaming: streamingDom.get(user) || false, muted: false });
      });
    }
    // v3.0.4 cumulative merge: channels seen in this scan replace their
    // own user list (so a channel that emptied drops its users), channels
    // not seen are kept for up to 60s (they may just be scrolled out of
    // view / virtualized), then pruned. Stale users in an unseen channel
    // live at most 60s; they are not kept forever.
    const nowMs = Date.now();
    const seenKeys = new Set();
    byChannel.forEach((ch, key) => {
      const mergeKey = (ch.guild || '') + '|' + key;
      const users = new Map();
      ch.users.forEach((u) => users.set(u.userId || u.user, u));
      liveMerged.set(mergeKey, { channel: ch.channel, guild: ch.guild, users, lastSeen: nowMs });
      seenKeys.add(mergeKey);
    });
    liveMerged.forEach((entry, key) => {
      if (!seenKeys.has(key) && nowMs - entry.lastSeen > 60000) liveMerged.delete(key);
    });
    liveCache = Array.from(liveMerged.values()).map((e) => ({ channel: e.channel, guild: e.guild, users: Array.from(e.users.values()) })).sort((a, b) => a.channel.localeCompare(b.channel));
    liveUpdatedAt = Date.now();
    renderLive();
  }
  function watchStreamForUser(userName) {
    // Best effort: open that person's voice row popout, then click Watch Stream.
    const rows = Array.from(document.querySelectorAll('[class*="voiceUser"]'));
    const row = rows.find((r) => {
      const n = r.querySelector('[class*="username"]');
      return n && n.textContent.trim() === userName;
    });
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const watch = btns.find((b) => /watch stream/i.test(b.textContent || '') || /watch stream/i.test(b.getAttribute('aria-label') || ''));
      if (watch) watch.click();
    }, 350);
    return true;
  }

  /* ---------------- Deleted messages ---------------- */
  // Only messages Discord already showed you while this tab was open can be
  // recovered. If a message was deleted before you opened the channel, or
  // while Discord was closed, there is nothing cached to show.
  const DELETED_KEY = 'dp_deleted_log_v1';
  const MAX_DELETED = 100;
  const msgCache = new Map();
  let dispatcherSubscribed = false;

  function loadDeleted() {
    try { return JSON.parse(GM_getValue(DELETED_KEY, '[]')); } catch (e) { return []; }
  }
  function saveDeleted(entries) {
    GM_setValue(DELETED_KEY, JSON.stringify(entries.slice(-MAX_DELETED)));
  }
  function cacheMessage(m) {
    if (!m || !m.id) return;
    const id = String(m.id);
    if (msgCache.has(id)) return;
    let author = '';
    try {
      if (m.author) author = m.author.globalName || m.author.username || String(m.author.id || '');
      else if (m.authorId) author = resolveUserName(String(m.authorId));
    } catch (e) { /* ignore */ }
    const content = typeof m.content === 'string' ? m.content : '';
    const hasAttachment = !!(m.attachments && (m.attachments.length || m.attachments.size));
    const hasEmbed = !!(m.embeds && (m.embeds.length || m.embeds.size));
    if (!content && !hasAttachment && !hasEmbed) return;
    msgCache.set(id, {
      id,
      channelId: String(m.channel_id || m.channelId || currentChannelIdFromUrl() || ''),
      author: author || 'Unknown',
      content,
      t: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      attachment: hasAttachment
    });
    if (msgCache.size > 2000) {
      const first = msgCache.keys().next().value;
      msgCache.delete(first);
    }
  }
  function pollMessageStore() {
    if (!get('deletedLog')) return;
    if (!ensureStores() || !stores.message) return;
    const channelId = currentChannelIdFromUrl();
    if (!channelId) return;
    try {
      if (typeof stores.message.getMessages === 'function') {
        const msgs = stores.message.getMessages(channelId);
        const list = msgs && typeof msgs.toArray === 'function' ? msgs.toArray() : (msgs instanceof Map ? Array.from(msgs.values()) : (msgs && typeof msgs.getArray === 'function' ? msgs.getArray() : Object.values(msgs || {})));
        list.forEach(cacheMessage);
      }
    } catch (e) { /* ignore */ }
  }
  // Backup cache: read messages straight from the DOM, so a fast delete
  // (sent and deleted in under 3 seconds) is still caught even if the
  // store poll has not run yet.
  function scanMessagesDOM() {
    if (!get('deletedLog')) return;
    const channelId = currentChannelIdFromUrl();
    if (!channelId) return;
    try {
      document.querySelectorAll('[class*="messageContent_"]').forEach((contentEl) => {
        let node = contentEl;
        let msgId = null;
        for (let i = 0; i < 6 && node; i++) {
          const idAttr = node.getAttribute && (node.getAttribute('id') || node.getAttribute('data-list-item-id') || '');
          const m = String(idAttr).match(/(\d{17,20})/g);
          if (m && m.length) { msgId = m[m.length - 1]; break; }
          node = node.parentElement;
        }
        if (!msgId || msgCache.has(msgId)) return;
        let author = 'Unknown';
        const root = contentEl.closest('[class*="message_"]') || contentEl.parentElement;
        if (root) {
          const header = root.querySelector('[class*="username_"], [class*="headerText_"]');
          if (header && header.textContent.trim()) author = header.textContent.trim();
        }
        const content = contentEl.textContent || '';
        if (!content.trim()) return;
        msgCache.set(msgId, { id: msgId, channelId, author, content, t: Date.now(), attachment: false });
      });
    } catch (e) { /* ignore */ }
  }
  function dpDiagnostics() {
    const pw = getPageWindow();
    let chunkExists = false;
    try {
      chunkExists = !!(pw && (pw.webpackChunkdiscord_app || getChunkArray(pw)));
    } catch (e) { chunkExists = false; }
    let cacheSize = 0;
    try {
      const req = wpRequire || (pw && pw.__dpWpRequire);
      if (req && req.c) cacheSize = Object.keys(req.c).length;
    } catch (e) { cacheSize = 0; }
    return {
      chunkExists,
      wpFound: !!(wpRequire || (pw && pw.__dpWpRequire)),
      cacheSize,
      mSize: mSizeCache,
      mFound: mFoundVoiceFactory,
      voiceStore: !!stores.voice,
      channelStore: !!stores.channel,
      userStore: !!stores.user,
      messageStore: !!stores.message,
      dispatcher: !!stores.dispatcher,
      dispatcherSubscribed,
      streamStore: !!stores.stream,
      cachedMessages: msgCache.size,
      deletedCaught: loadDeleted().length,
      liveChannels: liveCache.length,
      trackingMode,
      probe: storeProbe
    };
  }
  function renderDiagnostics() {
    const el = document.getElementById('dp-diag');
    if (!el) return;
    const d = dpDiagnostics();
    const p = d.probe || {};
    const probeText = ' / probe ' + (p.factoryId || 'none') + ' ' + (p.reqResultType || '?') + ' keys:' + (p.reqResultKeys && p.reqResultKeys.length ? p.reqResultKeys.join(',') : 'none') + ' nested:' + (p.nestedMatch ? 'yes' : 'no') + (p.threw ? ' threw:yes' : '');
    el.textContent = 'Diag: chunk ' + (d.chunkExists ? 'yes' : 'no') + ' / wp ' + (d.wpFound ? 'yes' : 'no') + ' / cache ' + d.cacheSize + ' / m ' + d.mSize + ' / mFound ' + (d.mFound ? 'yes' : 'no') + ' / voice ' + (d.voiceStore ? 'yes' : 'no') + ' / msg ' + (d.messageStore ? 'yes' : 'no') + ' / dispatcher ' + (d.dispatcher ? 'yes' : 'no') + ' / subscribed ' + (d.dispatcherSubscribed ? 'yes' : 'no') + ' / stream ' + (d.streamStore ? 'yes' : 'no') + ' / cached msgs ' + d.cachedMessages + ' / deleted caught ' + d.deletedCaught + ' / live channels ' + d.liveChannels + ' / mode ' + d.trackingMode + probeText;
  }
  // In-script background diagnostic (v3.0.3): DevTools cannot be opened
  // in Dominic's browser, so this button reports, inside the panel,
  // whether appMount exists, what its computed background is, and
  // whether the saved image URL actually loads. v3.0.4 also runs the
  // GM_xhr fetch test (status, blob size, data URL length) and tests
  // whether an Image() with that data URL loads, since direct external
  // loads are blocked in Discord.
  function testBackground() {
    const out = document.getElementById('dp-bg-diag');
    const bgUrl = (get('bgUrl') || '').trim();
    if (!bgUrl) {
      if (out) out.textContent = 'Background test: no background URL saved. Paste a URL above first.';
      return;
    }
    let appMount = null;
    try { appMount = document.querySelector('[class*="appMount_"]'); } catch (e) { appMount = null; }
    const appCls = appMount ? String(appMount.className || '').slice(0, 80) : '';
    let appBgImg = 'n/a', appBgColor = 'n/a', bodyBgImg = 'n/a', bodyBgColor = 'n/a';
    try {
      if (appMount) { const cs = getComputedStyle(appMount); appBgImg = cs.backgroundImage; appBgColor = cs.backgroundColor; }
    } catch (e) { appBgImg = 'error'; }
    try {
      const bs = getComputedStyle(document.body);
      bodyBgImg = bs.backgroundImage;
      bodyBgColor = bs.backgroundColor;
    } catch (e) { bodyBgImg = 'error'; }
    const base = 'Background test: appMount ' + (appMount ? 'found (' + appCls + ')' : 'NOT FOUND') + ' / appMount bg ' + appBgImg + ' / ' + appBgColor + ' / body bg ' + bodyBgImg + ' / ' + bodyBgColor + ' / ';
    const state = { plain: 'loading image...', xhr: 'GM_xhr: not started', dataImg: '' };
    const render = () => {
      if (out) out.textContent = base + state.plain + ' / ' + state.xhr + (state.dataImg ? ' / ' + state.dataImg : '') + ' / url ' + bgUrl;
    };
    render();
    // Plain Image() test (v3.0.3, kept).
    let done = false;
    const img = new Image();
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      state.plain = 'image TIMEOUT after 5s (did not load, may be blocked or slow)';
      render();
    }, 5000);
    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.plain = 'image LOADED ' + img.naturalWidth + 'x' + img.naturalHeight;
      render();
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.plain = 'image FAILED to load (onerror)';
      render();
    };
    try { img.src = bgUrl; } catch (e) {
      clearTimeout(timer);
      done = true;
      state.plain = 'image error starting load';
      render();
    }
    // GM_xhr fetch test (v3.0.4), then test Image() with the data URL.
    if (typeof GM_xmlhttpRequest !== 'function') {
      state.xhr = 'GM_xhr: unavailable (no grant)';
      render();
      return;
    }
    state.xhr = 'GM_xhr: fetching...';
    render();
    loadBackgroundAsDataUrl(bgUrl, (err, dataUrl, blobSize, status) => {
      if (err || !dataUrl) {
        state.xhr = 'GM_xhr: FAILED ' + err;
        render();
        return;
      }
      state.xhr = 'GM_xhr: OK status ' + status + ', blob ' + (blobSize || 0) + ' bytes, data URL ' + dataUrl.length + ' chars' + (dataUrl.length >= BG_DATA_MAX ? ' (over 2 MB store limit, session-only)' : ' (cached)');
      state.dataImg = 'data-URL image: loading...';
      render();
      let dDone = false;
      const dImg = new Image();
      const dTimer = setTimeout(() => {
        if (dDone) return;
        dDone = true;
        state.dataImg = 'data-URL image: TIMEOUT after 5s';
        render();
      }, 5000);
      dImg.onload = () => {
        if (dDone) return;
        dDone = true;
        clearTimeout(dTimer);
        state.dataImg = 'data-URL image: LOADED ' + dImg.naturalWidth + 'x' + dImg.naturalHeight;
        render();
      };
      dImg.onerror = () => {
        if (dDone) return;
        dDone = true;
        clearTimeout(dTimer);
        state.dataImg = 'data-URL image: FAILED to load (onerror)';
        render();
      };
      try { dImg.src = dataUrl; } catch (e) {
        clearTimeout(dTimer);
        dDone = true;
        state.dataImg = 'data-URL image: error starting load';
        render();
      }
    });
  }
  function onMessageDelete(channelId, messageId) {
    if (!get('deletedLog')) return;
    const cached = msgCache.get(String(messageId));
    if (!cached) return;
    let channelName = '';
    try {
      const ch = stores.channel && stores.channel.getChannel(channelId);
      if (ch && ch.name) channelName = ch.name;
    } catch (e) { /* ignore */ }
    const entry = { t: Date.now(), msgT: cached.t, channel: channelName, channelId: String(channelId), author: cached.author, content: cached.content, attachment: cached.attachment };
    const entries = loadDeleted();
    if (entries.some((x) => x.msgT === entry.msgT && x.author === entry.author && x.content === entry.content)) return;
    entries.push(entry);
    saveDeleted(entries);
    renderDeleted();
    insertDeletedGhost(entry);
  }
  // DOM fallback for deleted messages: watch the chat area for a single
  // message node being removed. Bulk removals (many nodes at once) are
  // scrolling / channel switches, not deletes, so they are ignored.
  let deletedObserver = null;
  function extractMsgIdFromNode(node) {
    if (!node || typeof node.getAttribute !== 'function') return null;
    const idAttr = node.getAttribute('id') || node.getAttribute('data-list-item-id') || '';
    const m = String(idAttr).match(/(\d{17,20})/g);
    if (m && m.length) return m[m.length - 1];
    // The removed node may be a wrapper; check its descendants.
    try {
      const inner = node.querySelector && node.querySelector('[id*="chat-messages-"], [data-list-item-id]');
      if (inner) {
        const innerAttr = inner.getAttribute('id') || inner.getAttribute('data-list-item-id') || '';
        const im = String(innerAttr).match(/(\d{17,20})/g);
        if (im && im.length) return im[im.length - 1];
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function setupDeletedObserver() {
    if (deletedObserver) return true;
    if (!get('deletedLog')) return false;
    const target = document.querySelector('[class*="messagesWrapper_"]') || document.querySelector('[class*="chatContent_"]') || document.body;
    if (!target || typeof MutationObserver === 'undefined') return false;
    try {
      deletedObserver = new MutationObserver((mutations) => {
        for (const mut of mutations) {
          if (!mut.removedNodes || !mut.removedNodes.length) continue;
          if (mut.removedNodes.length > 3) continue; // bulk removal, ignore
          mut.removedNodes.forEach((node) => {
            const msgId = extractMsgIdFromNode(node);
            if (!msgId || !msgCache.has(msgId)) return;
            const channelId = (msgCache.get(msgId) && msgCache.get(msgId).channelId) || currentChannelIdFromUrl();
            setTimeout(() => {
              // If the node came back (re-render / scroll), it was not a delete.
              try {
                if (document.querySelector('[id*="' + msgId + '"], [data-list-item-id*="' + msgId + '"]')) return;
              } catch (e) { /* ignore */ }
              if (!msgCache.has(msgId)) return;
              onMessageDelete(channelId, msgId);
            }, 2000);
          });
        }
      });
      deletedObserver.observe(target, { childList: true, subtree: true });
      log('deleted-message DOM observer on');
      return true;
    } catch (e) { deletedObserver = null; return false; }
  }
  function subscribeDispatcher() {
    if (dispatcherSubscribed) return;
    if (!ensureStores() || !stores.dispatcher || typeof stores.dispatcher.subscribe !== 'function') return;
    try {
      stores.dispatcher.subscribe('MESSAGE_DELETE', (e) => {
        if (e && e.id) onMessageDelete(e.channelId, e.id);
      });
      stores.dispatcher.subscribe('MESSAGE_DELETE_BULK', (e) => {
        if (e && Array.isArray(e.ids)) e.ids.forEach((id) => onMessageDelete(e.channelId, id));
      });
      dispatcherSubscribed = true;
      log('deleted-message tracking on');
    } catch (e) { /* ignore */ }
  }
  function insertDeletedGhost(entry) {
    try {
      const channelId = currentChannelIdFromUrl();
      if (!channelId || String(channelId) !== String(entry.channelId)) return;
      const scroller = document.querySelector('[class*="messagesWrapper_"] [class*="scroller_"], [class*="scrollerContent_"]');
      if (!scroller) return;
      if (scroller.querySelector('[data-dp-deleted="' + entry.msgT + '"]')) return;
      const div = document.createElement('div');
      div.className = 'dp-deleted-ghost';
      div.setAttribute('data-dp-deleted', String(entry.msgT));
      div.innerHTML = '<span class="dp-deleted-badge">Deleted</span> <strong>' + escapeHtml(entry.author) + '</strong> <span class="dp-deleted-time">' + fmtTime(entry.msgT) + '</span><div class="dp-deleted-text">' + escapeHtml(entry.content || (entry.attachment ? '[attachment]' : '[no text]')) + '</div>';
      scroller.appendChild(div);
      // Do not scroll the user: a deleted message should not yank their view.
    } catch (e) { /* ignore */ }
  }

  /* ---------------- theme engine (cleaner, subtler by default) ---------------- */
  let themeStyleEl = null;

  // v3.0.4 background via GM_xmlhttpRequest: v3.0.3 proved the CSS is
  // correct (appMount bg is set to the URL, transparent) but a plain
  // Image() / CSS url() load of an external image FAILS in Discord
  // (onerror for both the tiger URL and picsum). GM_xmlhttpRequest runs
  // outside the page CSP, so fetch the image as a blob, turn it into a
  // data URL, and use that as the background instead.
  const BG_DATA_KEY = 'dp_bg_dataurl_v1';
  const BG_DATA_SRC_KEY = 'dp_bg_dataurl_src_v1';
  const BG_DATA_MAX = 2000000; // do not store data URLs over ~2 MB
  let bgFetchInFlight = null; // URL currently being fetched, or null
  let bgFetched = {}; // URLs already fetched this session (success or fail), so a re-apply after a fetch never refetches the same URL
  let bgSessionDataUrl = null; // data URL for this session only (used when over the 2 MB store limit)
  let bgSessionDataSrc = '';

  function getBackgroundDataUrl() {
    try {
      const bgUrl = (get('bgUrl') || '').trim();
      if (!bgUrl) return null;
      if (bgSessionDataUrl && bgSessionDataSrc === bgUrl) return bgSessionDataUrl;
      const src = GM_getValue(BG_DATA_SRC_KEY, '');
      if (!src || src !== bgUrl) return null;
      const data = GM_getValue(BG_DATA_KEY, '');
      return data && data.indexOf('data:') === 0 ? data : null;
    } catch (e) { return null; }
  }
  function loadBackgroundAsDataUrl(bgUrl, cb) {
    if (typeof GM_xmlhttpRequest !== 'function') { cb('GM_xmlhttpRequest unavailable (no grant)'); return; }
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url: bgUrl,
        responseType: 'blob',
        timeout: 15000,
        onload: (resp) => {
          try {
            const blob = resp && resp.response;
            const status = resp && resp.status;
            if (!blob) { cb('GM_xhr: no blob in response (status ' + status + ')'); return; }
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const dataUrl = String(reader.result || '');
                if (dataUrl.indexOf('data:') !== 0) { cb('GM_xhr: FileReader did not return a data URL'); return; }
                cb(null, dataUrl, blob.size || 0, status);
              } catch (e) { cb('GM_xhr: FileReader result error ' + (e && e.message)); }
            };
            reader.onerror = () => cb('GM_xhr: FileReader error');
            reader.readAsDataURL(blob);
          } catch (e) { cb('GM_xhr: onload error ' + (e && e.message)); }
        },
        onerror: (resp) => cb('GM_xhr: request error (status ' + (resp && resp.status) + ')'),
        ontimeout: () => cb('GM_xhr: request timed out after 15s')
      });
    } catch (e) { cb('GM_xhr: could not start request ' + (e && e.message)); }
  }
  // Kick off a background fetch when a bgUrl is set but no matching
  // cached data URL exists yet. Non-blocking: the theme applies at once
  // with the raw URL as fallback, then re-applies with the data URL
  // when the fetch succeeds.
  function maybeFetchBackground() {
    const bgUrl = (get('bgUrl') || '').trim();
    if (!bgUrl) return;
    if (getBackgroundDataUrl()) return; // already cached for this URL
    if (bgFetchInFlight === bgUrl) return; // already fetching this URL
    if (bgFetched[bgUrl]) return; // already fetched this session (e.g. too large to store, session-only use)
    bgFetchInFlight = bgUrl;
    loadBackgroundAsDataUrl(bgUrl, (err, dataUrl, blobSize) => {
      bgFetchInFlight = null;
      bgFetched[bgUrl] = true;
      if (err || !dataUrl) {
        log('background GM_xhr failed:', err);
        return;
      }
      // Only store under 2 MB; larger images still work for this session
      // via the in-memory data URL.
      bgSessionDataUrl = dataUrl;
      bgSessionDataSrc = bgUrl;
      try {
        if (dataUrl.length < BG_DATA_MAX) {
          GM_setValue(BG_DATA_KEY, dataUrl);
          GM_setValue(BG_DATA_SRC_KEY, bgUrl);
        }
      } catch (e) { /* storage full, session-only use */ }
      applyTheme();
      const diag = document.getElementById('dp-bg-diag');
      if (diag) diag.textContent = 'Background loaded via GM_xhr (data URL, ' + dataUrl.length + ' chars, blob ' + (blobSize || 0) + ' bytes) and applied.' + (dataUrl.length >= BG_DATA_MAX ? ' Too large to cache, session-only.' : '');
    });
  }

  function buildThemeCss() {
    const preset = get('themePreset');
    const accent = get('accent') || '#5865f2';
    const accentDark = shade(accent, -25);
    const accentLight = shade(accent, 30);
    const accentDeep = shade(accent, -70);
    const bgUrl = (get('bgUrl') || '').trim();
    const css = [];
    css.push('[aria-label="Send a gift"] { display: none !important; }');
    css.push('a[href="/shop"] { display: none !important; }');
    css.push('[aria-label="Shop"] { display: none !important; }');
    css.push(':root { --brand-500: ' + accent + ' !important; --brand-600: ' + accentDark + ' !important; --brand-400: ' + accentLight + ' !important; --dp-accent: ' + accent + ' !important; }');
    if (bgUrl) {
      // Background image wins over every preset. Use the background
      // shorthand (not just background-image) on html, body and every
      // Discord app root, and make Discord's own background layers
      // transparent so the image is not hidden behind a solid/gradient.
      // v3.0.4: prefer the GM_xhr-fetched data URL when one is cached
      // for this exact bgUrl (direct external loads are blocked in
      // Discord); the raw URL stays as fallback until the fetch lands.
      const dataUrl = getBackgroundDataUrl();
      const effectiveUrl = dataUrl || bgUrl;
      const safeUrl = effectiveUrl.replace(/"/g, '').replace(/'/g, '');
      const bgDecl = 'background: url("' + safeUrl + '") center / cover no-repeat fixed !important; background-size: cover !important; background-position: center center !important; background-attachment: fixed !important;';
      css.push(':root { --background-primary: transparent !important; --background-secondary: transparent !important; --background-tertiary: transparent !important; --background-floating: transparent !important; --background-mobile-primary: transparent !important; --background-mobile-secondary: transparent !important; }');
      css.push('html, body, [class*="appMount_"], [class*="app_"] { ' + bgDecl + ' }');
      css.push('[class*="appMount_"], [class*="app_"], [class*="bg_"], [class*="background_"] { background-color: transparent !important; }');
      css.push('[class*="sidebar_"], [class*="chat_"], [class*="members_"], [class*="messagesWrapper_"], [class*="container_"] { background-color: transparent !important; }');
      css.push('[class*="chat_"] [class*="container_"], [class*="chat_"] { background-color: transparent !important; }');
      css.push('[class*="sidebar_"], [class*="chat_"], [class*="members_"], [class*="messagesWrapper_"] { background-image: none !important; }');
      css.push('[class*="listItem_"] [class*="icon_"], [class*="listItem_"] img { border-radius: 10px !important; }');
    } else if (preset === 'clean') {
      // Clean: solid dark, no loud gradient, no glow. Accent only for small highlights.
      css.push('[class*="appMount_"] { background: #111214 !important; }');
      css.push('[class*="sidebar_"], [class*="chat_"], [class*="members_"], [class*="messagesWrapper_"] { background: transparent !important; }');
      css.push('[class*="listItem_"] [class*="icon_"], [class*="listItem_"] img { border-radius: 10px !important; }');
    } else {
      let gradient;
      if (preset === 'glass') {
        gradient = 'linear-gradient(135deg, ' + accentDeep + ' 0%, ' + shade(accent, -10) + ' 45%, #0e3a4a 100%)';
      } else if (preset === 'midnight') {
        gradient = 'linear-gradient(180deg, #050507 0%, ' + accentDeep + ' 100%)';
      } else {
        gradient = 'linear-gradient(135deg, ' + accentDeep + ' 0%, ' + accent + ' 50%, #0a1a3a 100%)';
      }
      css.push('[class*="appMount_"] { background: ' + gradient + ' !important; }');
      css.push('[class*="sidebar_"], [class*="chat_"], [class*="members_"], [class*="messagesWrapper_"] { background: rgba(8, 8, 18, 0.35) !important; backdrop-filter: blur(10px); }');
      css.push('[class*="listItem_"] [class*="icon_"], [class*="listItem_"] img { border-radius: 12px !important; box-shadow: 0 0 6px ' + accent + '44 !important; }');
    }
    css.push('::-webkit-scrollbar { width: 10px !important; height: 10px !important; }');
    css.push('::-webkit-scrollbar-thumb { background: ' + accent + ' !important; border-radius: 8px !important; border: 2px solid transparent !important; background-clip: content-box !important; }');
    css.push('::-webkit-scrollbar-track { background: transparent !important; }');
    if (preset === 'midnight') {
      css.push(':root { --background-primary: #0a0a10 !important; --background-secondary: #101018 !important; --background-tertiary: #15151f !important; }');
    }
    return css.join('\n');
  }

  function applyTheme() {
    if (themeStyleEl) { themeStyleEl.remove(); themeStyleEl = null; }
    if (get('themeOn')) themeStyleEl = GM_addStyle(buildThemeCss());
    // v3.0.4: fetch the background as a data URL in the background when
    // no cached one exists for the current bgUrl. Guarded inside
    // maybeFetchBackground so a successful fetch does not re-trigger.
    maybeFetchBackground();
  }

  /* ---------------- UI: cleaner tabbed panel ---------------- */
  let panel = null;
  let panelOpen = false;
  let activeTab = 'live';

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
        status.textContent = watched ? 'Watching ' + watched + ' - switch to that server to log it.' : 'Only logs the server you are viewing right now.';
      }
    }
  }

  function renderLive() {
    const list = document.getElementById('dp-live-list');
    if (!list) return;
    if (!liveCache.length) {
      list.innerHTML = '<div class="dp-empty">Nobody in voice right now' + (watchKey() ? ' in the watched server' : '') + '. Pick a server above to watch a specific one.</div>';
      return;
    }
    list.innerHTML = liveCache.map((ch) => {
      const users = ch.users.map((u) => {
        const badges = [];
        if (u.streaming) badges.push('<span class="dp-badge-live">LIVE</span>');
        if (u.speaking) badges.push('<span class="dp-badge-speaking">speaking</span>');
        if (u.muted) badges.push('<span class="dp-badge-muted">muted</span>');
        const watchBtn = u.streaming ? ' <button class="dp-watch-btn" data-user="' + escapeHtml(u.user) + '">Watch</button>' : '';
        return '<div class="dp-live-user' + (u.speaking ? ' dp-speaking' : '') + '"><span class="dp-dot' + (u.speaking ? ' dp-dot-speaking' : '') + '"></span> <strong>' + escapeHtml(u.user) + '</strong> ' + badges.join(' ') + watchBtn + '</div>';
      }).join('');
      return '<div class="dp-live-channel"><div class="dp-live-channel-name">#' + escapeHtml(ch.channel) + ' <span class="dp-guild">' + escapeHtml(ch.guild || '') + '</span></div>' + users + '</div>';
    }).join('');
    list.querySelectorAll('.dp-watch-btn').forEach((b) => {
      b.addEventListener('click', () => watchStreamForUser(b.getAttribute('data-user')));
    });
    const meta = document.getElementById('dp-live-meta');
    if (meta && liveUpdatedAt) meta.textContent = 'Updated ' + fmtTime(liveUpdatedAt) + ' - no need to join to see this.';
  }

  function renderDeleted() {
    const list = document.getElementById('dp-deleted-list');
    if (!list) return;
    const entries = loadDeleted().slice().reverse();
    if (!entries.length) {
      list.innerHTML = '<div class="dp-empty">No deleted messages caught yet. Keep Discord open and this only catches messages you already saw.</div>';
    } else {
      list.innerHTML = entries.map((e) => {
        return '<div class="dp-deleted-row"><div class="dp-deleted-head"><strong>' + escapeHtml(e.author) + '</strong> <span class="dp-time">' + fmtTime(e.msgT || e.t) + '</span>' + (e.channel ? ' <span class="dp-guild">#' + escapeHtml(e.channel) + '</span>' : '') + ' <span class="dp-deleted-badge">Deleted</span></div><div class="dp-deleted-text">' + escapeHtml(e.content || (e.attachment ? '[attachment]' : '[no text]')) + '</div></div>';
      }).join('');
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
    if (current && sel.value !== current) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current.indexOf('name:') === 0 ? current.slice(5) : current;
      sel.appendChild(opt);
      sel.value = current;
    }
  }

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('#dp-panel [data-tab]').forEach((b) => {
      b.classList.toggle('dp-tab-active', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('#dp-panel .dp-tab-page').forEach((p) => {
      p.style.display = p.getAttribute('data-page') === tab ? 'block' : 'none';
    });
    if (tab === 'live') { refreshWatchSelect(); renderLive(); }
    if (tab === 'log') renderVoiceLog();
    if (tab === 'deleted') renderDeleted();
    if (tab === 'look') { markActivePreset(); renderDiagnostics(); }
  }

  function togglePanel() {
    ensurePanel();
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) setTab(activeTab);
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
      '<div class="dp-panel-head"><strong>Discord Plus</strong><span class="dp-version">v3.0.4</span><button id="dp-panel-close" title="Close">X</button></div>' +
      '<div class="dp-tabs">' +
      '<button data-tab="live">Live</button>' +
      '<button data-tab="log">Voice log</button>' +
      '<button data-tab="deleted">Deleted</button>' +
      '<button data-tab="look">Look</button>' +
      '</div>' +
      '<div class="dp-tab-page" data-page="live">' +
      '<div class="dp-section"><div class="dp-section-title">Watch server</div>' +
      '<select id="dp-watch-guild"></select>' +
      '<div class="dp-note">Live Now and the voice log follow this server, even while you are in DMs or another server.</div></div>' +
      '<div class="dp-section"><div class="dp-section-title">Live now</div>' +
      '<div id="dp-live-list" class="dp-live-list"></div>' +
      '<div id="dp-live-meta" class="dp-note"></div></div>' +
      '</div>' +
      '<div class="dp-tab-page" data-page="log" style="display:none">' +
      '<div class="dp-section"><div class="dp-section-title">Voice log <button id="dp-log-clear">Clear</button></div>' +
      '<div id="dp-log-list" class="dp-log-list"></div>' +
      '<div id="dp-voice-status" class="dp-note"></div></div>' +
      '</div>' +
      '<div class="dp-tab-page" data-page="deleted" style="display:none">' +
      '<div class="dp-section"><div class="dp-section-title">Deleted messages <button id="dp-deleted-clear">Clear</button></div>' +
      '<div class="dp-note">Only messages you already saw while this tab was open. Deleted before you opened the channel, or while Discord was closed, cannot be recovered.</div>' +
      '<div id="dp-deleted-list" class="dp-deleted-list"></div></div>' +
      '</div>' +
      '<div class="dp-tab-page" data-page="look" style="display:none">' +
      '<div class="dp-section"><div class="dp-section-title">Look</div>' +
      '<div class="dp-presets">' +
      '<button data-preset="clean">Clean</button>' +
      '<button data-preset="neon">Neon</button>' +
      '<button data-preset="glass">Glass</button>' +
      '<button data-preset="midnight">Midnight</button>' +
      '</div>' +
      '<label>Accent <input type="color" id="dp-accent"> <input type="text" id="dp-accent-hex" placeholder="#5865f2" maxlength="7" spellcheck="false"></label>' +
      '<label>Background image URL <input type="text" id="dp-bgurl" placeholder="https://..."></label>' +
      '<button id="dp-bg-test">Test background</button>' +
      '<div id="dp-bg-diag" class="dp-note">Background test not run yet.</div>' +
      '<div class="dp-note">Clean is the new default: solid dark, no glow. The accent only tints small highlights.</div></div>' +
      '<div class="dp-section"><div class="dp-section-title">Diagnostics</div>' +
      '<div id="dp-diag" class="dp-note">Diag: loading...</div>' +
      '<div class="dp-note">If a feature shows no, that store was not found, and that feature is the one to fix.</div></div>' +
      '<div class="dp-section"><div class="dp-section-title">Settings</div>' +
      '<label><input type="checkbox" id="dp-set-voice"> Voice join/leave log</label>' +
      '<label><input type="checkbox" id="dp-set-deleted"> Deleted messages</label>' +
      '<label><input type="checkbox" id="dp-set-live"> Live Now preview</label>' +
      '<label><input type="checkbox" id="dp-set-theme"> Custom look</label>' +
      '</div></div>';
    document.body.appendChild(panel);

    panel.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => setTab(b.getAttribute('data-tab')));
    });
    panel.querySelector('#dp-panel-close').addEventListener('click', togglePanel);
    panel.querySelector('#dp-log-clear').addEventListener('click', () => { saveLog([]); renderVoiceLog(); });
    panel.querySelector('#dp-deleted-clear').addEventListener('click', () => { saveDeleted([]); renderDeleted(); });

    const watchSel = panel.querySelector('#dp-watch-guild');
    watchSel.addEventListener('change', () => {
      set('watchGuildId', watchSel.value || null);
      voiceState = new Map();
      firstScan = true;
      missingCounts = new Map();
      liveCache = [];
      liveMerged = new Map();
      scanVoice();
      scanLive();
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
    const accentHex = panel.querySelector('#dp-accent-hex');
    accentInput.value = get('accent');
    if (accentHex) {
      accentHex.value = get('accent');
      const applyHex = () => {
        let v = (accentHex.value || '').trim();
        if (!v.startsWith('#')) v = '#' + v;
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
          v = v.toLowerCase();
          set('accent', v);
          accentInput.value = v;
          applyTheme();
          accentHex.style.borderColor = '';
        } else if (/^#[0-9a-fA-F]{3}$/.test(v)) {
          const expanded = '#' + v.slice(1).split('').map((c) => c + c).join('').toLowerCase();
          set('accent', expanded);
          accentInput.value = expanded;
          accentHex.value = expanded;
          applyTheme();
          accentHex.style.borderColor = '';
        } else {
          accentHex.style.borderColor = '#ed4245';
        }
      };
      accentHex.addEventListener('change', applyHex);
      accentHex.addEventListener('input', () => { accentHex.style.borderColor = ''; });
    }
    accentInput.addEventListener('input', () => { set('accent', accentInput.value); if (accentHex) accentHex.value = accentInput.value; applyTheme(); });
    const bgInput = panel.querySelector('#dp-bgurl');
    bgInput.value = get('bgUrl');
    bgInput.addEventListener('change', () => { set('bgUrl', bgInput.value.trim()); applyTheme(); });
    const bgTestBtn = panel.querySelector('#dp-bg-test');
    if (bgTestBtn) bgTestBtn.addEventListener('click', testBackground);

    const voiceCb = panel.querySelector('#dp-set-voice');
    const deletedCb = panel.querySelector('#dp-set-deleted');
    const liveCb = panel.querySelector('#dp-set-live');
    const themeCb = panel.querySelector('#dp-set-theme');
    voiceCb.checked = get('voiceLog');
    deletedCb.checked = get('deletedLog');
    liveCb.checked = get('liveNow');
    themeCb.checked = get('themeOn');
    voiceCb.addEventListener('change', () => {
      set('voiceLog', voiceCb.checked);
      if (!voiceCb.checked) { voiceState = new Map(); firstScan = true; missingCounts = new Map(); }
    });
    deletedCb.addEventListener('change', () => { set('deletedLog', deletedCb.checked); });
    liveCb.addEventListener('change', () => { set('liveNow', liveCb.checked); if (!liveCb.checked) { liveCache = []; liveMerged = new Map(); } scanLive(); });
    themeCb.addEventListener('change', () => { set('themeOn', themeCb.checked); applyTheme(); });

    refreshWatchSelect();
    renderVoiceLog();
    renderLive();
    renderDeleted();
    markActivePreset();
    return panel;
  }

  /* ---------------- core UI styles (always on, cleaner) ---------------- */
  const UI_CSS = [
    '#dp-fab { position: fixed; right: 16px; bottom: 16px; z-index: 9999; width: 40px; height: 40px; border-radius: 10px; border: 1px solid #232428; background: #1e1f22; color: #dbdee1; font-weight: 700; font-size: 13px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.4); }',
    '#dp-fab:hover { border-color: var(--dp-accent, #5865f2); color: #fff; }',
    '#dp-panel { position: fixed; right: 16px; bottom: 66px; z-index: 9999; width: 360px; max-height: 72vh; overflow-y: auto; display: none; background: #111214; color: #dbdee1; border: 1px solid #232428; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5); font-family: inherit; font-size: 14px; }',
    '.dp-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid #232428; }',
    '.dp-panel-head button { background: none; border: none; color: #b5bac1; cursor: pointer; font-size: 13px; }',
    '.dp-version { color: #949ba4; font-size: 12px; margin-left: auto; margin-right: 8px; }',
    '.dp-tabs { display: flex; gap: 4px; padding: 8px 10px 0; }',
    '.dp-tabs button { flex: 1; background: transparent; color: #b5bac1; border: none; border-bottom: 2px solid transparent; padding: 8px 0; cursor: pointer; font-size: 13px; }',
    '.dp-tabs button.dp-tab-active { color: #fff; border-bottom-color: var(--dp-accent, #5865f2); }',
    '.dp-section { padding: 12px 14px; border-bottom: 1px solid #232428; }',
    '.dp-section-title { font-weight: 700; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }',
    '.dp-section label { display: block; margin: 8px 0; }',
    '.dp-section select, .dp-section input[type="text"] { width: 100%; box-sizing: border-box; background: #1e1f22; color: #dbdee1; border: 1px solid #3f4147; border-radius: 6px; padding: 6px 8px; margin-top: 4px; }',
    '.dp-section input[type="color"] { vertical-align: middle; margin-left: 6px; background: none; border: none; width: 40px; height: 26px; padding: 0; cursor: pointer; }',
    '#dp-accent-hex { width: 90px !important; display: inline-block; margin-left: 6px; font-family: monospace; }',
    '.dp-presets { display: flex; gap: 6px; margin-bottom: 8px; }',
    '.dp-presets button { flex: 1; background: #1e1f22; color: #dbdee1; border: 1px solid #3f4147; border-radius: 8px; padding: 6px 0; cursor: pointer; font-size: 13px; }',
    '.dp-presets button.dp-preset-active { border-color: var(--dp-accent, #5865f2); color: #fff; }',
    '.dp-log-list, .dp-deleted-list, .dp-live-list { max-height: 260px; overflow-y: auto; }',
    '.dp-log-row { padding: 3px 0; }',
    '.dp-time { color: #949ba4; }',
    '.dp-guild { color: #949ba4; font-size: 12px; }',
    '.dp-join strong { color: #3ba55d; }',
    '.dp-leave strong { color: #ed4245; }',
    '.dp-empty { color: #949ba4; }',
    '.dp-note { color: #949ba4; font-size: 12px; margin-top: 8px; }',
    '#dp-log-clear, #dp-deleted-clear { background: #1e1f22; color: #dbdee1; border: 1px solid #3f4147; border-radius: 6px; padding: 2px 8px; cursor: pointer; }',
    '#dp-bg-test { background: #1e1f22; color: #dbdee1; border: 1px solid #3f4147; border-radius: 6px; padding: 4px 10px; cursor: pointer; margin-top: 6px; }',
    '.dp-live-channel { margin-bottom: 10px; }',
    '.dp-live-channel-name { font-weight: 700; margin-bottom: 4px; }',
    '.dp-live-user { padding: 4px 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
    '.dp-dot { width: 8px; height: 8px; border-radius: 50%; background: #3f4147; flex-shrink: 0; }',
    '.dp-dot-speaking { background: #3ba55d; box-shadow: 0 0 6px #3ba55d; }',
    '.dp-badge-live { background: #ed4245; color: #fff; font-size: 11px; font-weight: 700; border-radius: 4px; padding: 1px 5px; }',
    '.dp-badge-speaking { color: #3ba55d; font-size: 12px; }',
    '.dp-badge-muted { color: #949ba4; font-size: 12px; }',
    '.dp-watch-btn { background: var(--dp-accent, #5865f2); color: #fff; border: none; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px; }',
    '.dp-deleted-row { padding: 8px 0; border-bottom: 1px solid #232428; }',
    '.dp-deleted-head { margin-bottom: 2px; }',
    '.dp-deleted-badge { background: #ed4245; color: #fff; font-size: 11px; font-weight: 700; border-radius: 4px; padding: 1px 5px; }',
    '.dp-deleted-text { color: #dbdee1; opacity: 0.75; word-break: break-word; }',
    '.dp-deleted-ghost { background: rgba(237, 66, 69, 0.08); border-left: 3px solid #ed4245; border-radius: 6px; padding: 8px 10px; margin: 6px 16px; color: #dbdee1; font-size: 14px; }',
    '.dp-deleted-ghost .dp-deleted-text { margin-top: 2px; }',
    '.dp-deleted-ghost .dp-deleted-time { color: #949ba4; font-size: 12px; }',
    '[id^="chat-messages-"] { position: relative; }'
  ].join('\n');

  /* ---------------- boot ---------------- */
  function boot() {
    try {
      // v3 migration: old default was Neon, switch existing installs to Clean once.
      if (!GM_getValue('dp_v3_migrated', false)) {
        if (get('themePreset') === 'neon') set('themePreset', 'clean');
        set('accent', '#5865f2');
        GM_setValue('dp_v3_migrated', true);
      }
      GM_addStyle(UI_CSS);
      ensurePanel();
      applyTheme();
      injectWpRequire();
      ensureStores();
      subscribeDispatcher();
      setupDeletedObserver();
      setInterval(scanVoice, 2000);
      setInterval(scanLive, 2000);
      setInterval(pollMessageStore, 3000);
      setInterval(scanMessagesDOM, 2000);
      setInterval(subscribeDispatcher, 10000);
      setInterval(renderDiagnostics, 3000);
      // Retry the page-context injection every 10s until stores are found.
      setInterval(() => {
        if (!stores.voice || !stores.message || !stores.dispatcher) {
          injectWpRequire();
          ensureStores();
          subscribeDispatcher();
        }
        if (!deletedObserver) setupDeletedObserver();
      }, 10000);
      renderDiagnostics();
      GM_registerMenuCommand('Discord Plus: open panel', togglePanel);
      GM_registerMenuCommand('Discord Plus: toggle voice log', () => { set('voiceLog', !get('voiceLog')); });
      GM_registerMenuCommand('Discord Plus: toggle deleted messages', () => { set('deletedLog', !get('deletedLog')); });
      GM_registerMenuCommand('Discord Plus: toggle custom look', () => { set('themeOn', !get('themeOn')); applyTheme(); });
      log('loaded v3.0.4');
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
