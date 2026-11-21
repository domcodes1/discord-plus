# Discord Plus

A Tampermonkey userscript for Discord web.

## v3.0.3 fixes (Nov 19, 2026, local only, not yet pushed)

- **Voice log duplicates, smoking gun fixed:** `findChannelName()` used the aria-label and only stripped a trailing "(voice channel)", but the live label is "📌 compy wompy (voice channel), unread, cute fat boy, XX, Command, and 3 others, Private Channel (locked)" - "(voice channel)" is in the middle, so the key contained the occupant list and unread state, which change on every join/leave. Now the clean channel name element inside the channel link is preferred, the aria-label fallback cuts at " (voice channel)" and ", unread", and the log key uses the channel id when available, else the clean name.
- **Store discovery, req.m search:** `findStore()` searched only req.c (102 loaded modules). It now also searches req.m module factories: if a factory's source mentions the wanted method names, it is instantiated with req(id) and its exports checked. Diagnostics now show mSize (factory count) and mFound (a getVoiceStatesForChannel factory was found).
- **Live DOM streaming:** LIVE is a separate red pill on the voiceUser row, not part of the button name, and streaming was never detected in DOM mode. Now `streamFromDOM()` checks row text for "LIVE" and for a [class*="live"] element, and the DOM branch of `scanLive()` (and the store path) uses it. Speaking check kept, plus a green avatar style / "Speaking" text check alongside the existing class check.
- **Background image, in-script test:** added a "Test background" button in the Look tab (no DevTools needed). It reports whether appMount was found and its class, getComputedStyle backgroundImage/backgroundColor for appMount and body, and whether the saved image URL loads (Image onload with naturalWidth x naturalHeight, onerror, or 5s timeout), in the dp-bg-diag field. Also, when a bgUrl is set, Discord's CSS variables --background-primary/secondary/tertiary/floating/mobile-primary/mobile-secondary are now overridden to transparent, plus [class*="chat_"] [class*="container_"] background-color transparent. Existing background rules kept. No GM_xmlhttpRequest grant added, plain Image() test only.

## v3.0.2 fixes (Nov 19, 2026, local only, not yet pushed)

- **Store discovery fixed:** `findStore` now accepts function exports as well as objects, tries multiple webpack chunk names (and Symbol keys), and injects a page-context `<script>` that stores the webpack require on `window.__dpWpRequire`, retried every 10s until stores are found. Diagnostics now also show chunk / wp / cache size.
- **Live Now DOM fallback:** `scanLive()` no longer returns early when stores fail, it now falls back to the DOM sidebar scan, so Live Now shows people in voice even in DOM mode.
- **Watch server dropdown fixed:** the server rail is now parsed from `[data-list-item-id*="guildsnav"]` (guild id after the last `___`), and the current server from the URL is always added as an option, so VALORANT LFG appears when you are in that server.
- **Background image fixed:** the image URL is now applied with the background shorthand to `html`, `body`, `[class*="appMount_"]` and `[class*="app_"]` (cover, center, fixed), and Discord's background layers are made transparent when an image is set, for all presets including Clean and Midnight.
- **Voice log duplicates fixed:** a leave is only logged after a user has been missing for 3 consecutive scans (about 6 seconds). Empty scans and watched-server mismatches no longer clear state or log false leaves. `firstScan` only resets at boot or when the watch server changes.
- **Deleted messages DOM fallback:** a `MutationObserver` on the chat area watches for a single message node being removed, waits 2 seconds, checks it was not re-added, then calls the existing delete logic. Bulk removals (scrolling / channel switch) are ignored. The dispatcher subscription remains the primary path when it works.
- **Diagnostics:** fixed the missing slash, now reads "dispatcher no / subscribed no", plus new chunk / wp / cache fields.
- **Accent picker:** a hex text input (`#rrggbb`) now sits next to the colour picker in the Look tab, validated and synced with the colour input.

## v3.0 features

1. **Live Now** — see who is in voice, who is actually speaking, and who is streaming, without joining the call. Pick a server under Watch server and the Live tab follows it even while you are in DMs or another server. Streaming users get a LIVE badge and a Watch button, which opens Discord's own Watch Stream view.
2. **Deleted messages** — messages you already saw while the tab was open are cached, and when one is deleted it shows up in the Deleted tab with author, time, channel, and content, plus a ghost copy in chat when possible. Only messages seen while Discord was open can be recovered. Messages deleted before you opened the channel, or while Discord was closed, cannot be recovered.
3. **Voice join/leave log** — open the DP button bottom-right, choose a server under Watch server, and the log records who joined or left voice, and when. It reads Discord's own voice data, so it keeps tracking that server even while you are looking at another server or your DMs. If Discord's internal data is not available, it falls back to logging the server you are viewing.
4. **Cleaner look** — the panel is now tabbed (Live / Voice log / Deleted / Look), slimmer, and uses solid Discord-dark colors by default. New default preset is Clean, with Neon, Glass, and Midnight still available, plus an accent color picker and custom background image URL. It also hides the Nitro gift button and the Shop tab.

## Install

1. Install Tampermonkey from the Chrome Web Store.
2. Open the raw script link: https://raw.githubusercontent.com/domcodes1/discord-plus/main/discord-plus.user.js
3. Tampermonkey will offer to install it. Click **Install**.
4. Reload Discord. A DP button appears bottom-right.

Tampermonkey checks the GitHub link for updates automatically, so fixes land without reinstalling. To force an update, open Tampermonkey's dashboard, find Discord Plus, and click **Check for userscript updates**.

## Notes

- The voice log and Live Now only record while the Discord tab is open. They cannot see activity from when Discord was closed.
- Deleted messages only work for messages Discord already showed you while the script was running.
- Background tracking of a chosen server reads Discord's internal voice state data. Discord changes its internals often, so if that breaks, the log falls back to the server you are viewing and the panel says so.
- All settings live in the DP panel (bottom-right button) and in Tampermonkey's menu commands.
