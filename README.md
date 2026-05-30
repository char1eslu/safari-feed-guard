# Safari Userscript Distribution

This repository publishes a single Safari/Tampermonkey userscript.

## Install

Open this link in Safari with Tampermonkey enabled:

**[Install / update userscript](https://raw.githubusercontent.com/char1eslu/make-x-great-again/main/mxga-safari.user.js)**

Tampermonkey should detect the `.user.js` file and show an install or update page.

## Updates

The userscript includes its own Tampermonkey update metadata.

After editing the script, bump the `@version` value near the top of the file. Tampermonkey can then pick up the new version through its normal update check.

## Files

- `mxga-safari.user.js` - the installable userscript
- `LICENSE` - license notice
