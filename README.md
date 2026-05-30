# Safari Feed Guard

This repository publishes a single Safari/Tampermonkey userscript.

## Install

Open this link in Safari with Tampermonkey enabled:

**[Install / update userscript](https://raw.githubusercontent.com/char1eslu/safari-feed-guard/main/safari-feed-guard.user.js)**

Tampermonkey should detect the `.user.js` file and show an install or update page.

## Updates

The userscript includes its own Tampermonkey update metadata.

After editing the script, bump the `@version` value near the top of the file. Tampermonkey can then pick up the new version through its normal update check.

## Language

The UI supports Simplified Chinese and English. By default it follows the browser language, and it can be changed in the SFG settings panel.

## Files

- `safari-feed-guard.user.js` - the installable userscript
- `LICENSE` - license notice
