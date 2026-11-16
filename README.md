# Discord Plus

A Tampermonkey userscript for Discord web with two features in one script:

1. **Voice join/leave log for a server you pick** — open the purple "DP" button bottom-right, choose a server under "Watch server", and the log records who joined or left voice, and when. It reads Discord's own voice data, so it keeps tracking that server even while you are looking at another server or your DMs. If Discord's internal data is not available, it falls back to logging the server you are viewing. The panel shows which mode it is in.
2. **Custom look (theme engine)** — three presets (Neon, Glass, Midnight), an accent color picker, and a custom background image URL. It also hides the Nitro gift button and the Shop tab, rounds the server icons with a glow on hover, and restyles the scrollbar.

## Install

1. Install Tampermonkey from the Chrome Web Store.
2. Open the raw script link: https://raw.githubusercontent.com/domcodes1/discord-plus/main/discord-plus.user.js
3. Tampermonkey will offer to install it. Click **Install**.
4. Reload Discord. A purple "DP" button appears bottom-right.

Tampermonkey checks the GitHub link for updates automatically, so fixes land without reinstalling. To force an update, open Tampermonkey's dashboard, find Discord Plus, and click "Check for userscript updates".

## Notes

- The voice log only records while the Discord tab is open. It cannot see activity from when Discord was closed.
- Background tracking of a chosen server reads Discord's internal voice state data. Discord changes its internals often, so if that breaks, the log falls back to the server you are viewing and the panel says so.
- All settings live in the DP panel (bottom-right button) and in Tampermonkey's menu commands.
