# Discord Plus

A Tampermonkey userscript for Discord web.

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
