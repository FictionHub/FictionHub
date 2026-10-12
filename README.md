# FictionHub

A local, self-contained desktop app for movies, TV, anime, and **manga**.

FictionHub runs a small local server (on `127.0.0.1`) that serves the UI **and**
fetches the media sources — everything happens on your own machine. Manga sources
(MangaDex, WeebCentral, MangaKatana) are fetched through the app's **own built-in
local proxy**, so **no external CORS proxy or configuration is needed**.

This repository tracks **only the source code and build config**:

```
app-src/          the app (Electron renderer + the local server.js)
.github/          CI: rebuilds the Windows installer on every commit
package.json      build tooling (electron-builder)
```

The repository root also happens to be a working/runtime Electron folder, which
is why `.gitignore` is a strict allowlist — only the files above are tracked.

## Building the installer

```bash
npm install            # installs electron-builder
cd app-src && npm install && cd ..
npm run build          # produces app-src/dist/FictionHub Setup <version>.exe
```

## CI

Every push runs the [`Build FictionHub Installer`](.github/workflows/build.yml)
GitHub Action, which builds the Windows (NSIS) installer and uploads it as a
downloadable artifact on the workflow run.

## Auto-updates

The desktop app checks GitHub Releases ~10 seconds after launch (and every 6
hours after that) and opens an **in-app window** showing the current version,
the latest version, and the changes — nothing is downloaded until the user
confirms, and nothing is installed until they choose *Restart to update* (or
until they quit, if they pick *Install the next time I quit*). Settings →
Updates has the same information plus a manual *Check for updates* button.

Wiring: `app-src/updater.js` (main process, electron-updater) ↔
`app-src/preload.js` (`window.fictionhub.updater`) ↔ `app-src/update-ui.js`
(renderer UI). Because electron-updater only compares *versions*, CI stamps a
strictly increasing version (`major.minor.(patch + run number)`) into every
build and publishes the installer/`latest.yml`/blockmap under exactly the file
name the updater requests.
