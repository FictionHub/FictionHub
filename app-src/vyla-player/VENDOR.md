# Vyla Media Player (vendored)

FictionHub's streaming player. Copied from
https://gitlab.com/vyla-entertainment/player at commit
`82a03cfb6cd801495ee1ccd1a2f69e9b5032cbc2` (2026-11-07). Licence:
CC BY-NC 4.0 — see `LICENSE`.

Only the browser files are copied. The player's `server.js` (Express) is not
used: its `/api/sources`, `/api/stream`, `/api/subtitles`, `/api/downloads`
and `/api/proxy` routes are implemented in `app-src/server.js` on top of the
same `@vyla-entertainment/sdk`, with the proxy restricted to hosts the SDK
returned.

The app opens it in an iframe at `/vyla-player/index.html?id=<tmdb>&season=&episode=`.

## Local changes (re-apply when updating)

- `index.html`: `/src/main.js` → `src/main.js` (the player lives under
  `/vyla-player/`, not at the site root); `hls.js@latest` pinned to `1.7.4`.
- `src/main.js`, `src/core/player.js`: `/src/blocked-ids.json` →
  `src/blocked-ids.json` (same reason).
- `src/config.js`: `baseURL` comes from the host page's
  `FH_NATIVE_SERVER_URL` (Android's embedded server origin), else `''`.
