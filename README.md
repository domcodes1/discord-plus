# Discord Plus

A Tampermonkey userscript for Discord web with three features in one script:

1. **Voice join/leave log** — see who joined or left voice, and when. A purple "DP" button appears bottom-right in Discord; click it to see the log.
2. **Inline translate** — hover any message and click the globe button to translate it (auto-detects language, translates to English by default, switchable to Italian in the panel).
3. **Custom look** — hides the Nitro gift button and the Shop tab, sets a purple accent color, and tightens the channel list spacing. Edit the `CUSTOM_CSS` section in the script to change it.

## Install

1. Install Tampermonkey from the Chrome Web Store.
2. Open the raw script link: https://raw.githubusercontent.com/domcodes1/discord-plus/main/discord-plus.user.js
3. Tampermonkey will offer to install it. Click **Install**.
4. Reload Discord. A purple "DP" button appears bottom-right.

Tampermonkey checks the GitHub link for updates automatically, so fixes land without reinstalling.

## Notes

- The voice log only records while the Discord tab is open, for the server you are viewing. It cannot see activity from when Discord was closed.
- Translate uses Google Translate's free endpoint. It can be slow or rate-limited at times.
- Discord changes its internal class names often. If a feature stops working, the selectors in the script may need an update.
- All settings live in the DP panel (bottom-right button) and in Tampermonkey's menu commands.
