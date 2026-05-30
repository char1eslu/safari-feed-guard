# Make X Great Again Safari Userscript

Safari/Tampermonkey userscript port of [foru17/make-x-great-again](https://github.com/foru17/make-x-great-again).

It keeps the consumer-side MXGA features in a single `.user.js` file:

- scan X/Twitter pages for suspicious spam and porn-bot accounts
- show inline labels and a floating MXGA control panel
- query the public MXGA list and local whitelist cache
- run edge AI classification through `x.zuoluo.tv`
- GitHub Device Flow login for report/confirm actions
- paced real X block queue using the current X login session

## Install

Open this link in Safari with Tampermonkey enabled:

**[Install / update mxga-safari.user.js](https://raw.githubusercontent.com/char1eslu/make-x-great-again/main/mxga-safari.user.js)**

Tampermonkey should detect the userscript and show an install or update page.

## Updates

The script metadata points Tampermonkey at this raw file:

```text
https://raw.githubusercontent.com/char1eslu/make-x-great-again/main/mxga-safari.user.js
```

After editing `mxga-safari.user.js` on GitHub, bump the `@version` value near the top of the file. Tampermonkey can then pick up the new version through its normal update check.

## Notes

- This is a Safari userscript distribution branch, not the upstream Chrome extension source tree.
- The original upstream project is AGPL-3.0-only. Keep the license notice intact when modifying or redistributing the script.
- X changes its DOM and internal GraphQL payloads often, so scanning behavior may need occasional maintenance.

