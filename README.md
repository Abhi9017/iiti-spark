# IITI Spark — Flat GitHub Upload

This version has no `frontend/`, `backend-apps-script/`, or `.github/` folders.
All files are placed directly in the repository root.

## Website files

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `logo.svg`
- `.nojekyll`

## Google Apps Script database files

- `Code.gs`
- `Config.gs`
- `appsscript.json`

The `.gs` files are not executed by GitHub Pages. Copy them into a standalone Google Apps Script project to create and operate the Google Sheets database.

## GitHub Pages

Upload all files to the repository root, then choose:

`Settings → Pages → Deploy from a branch → main → /(root) → Save`

Before real login works, complete `DATABASE_SETUP.md` and edit `config.js`.

## Security notice

This prototype stores data in Google Sheets/Drive. Chats are not end-to-end encrypted. Do not claim that they are. Obtain institutional approval and legal/privacy review before a campus launch.
