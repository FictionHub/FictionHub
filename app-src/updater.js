/**
 * Auto-update manager (main process).
 *
 * Uses electron-updater against the GitHub Releases published by our CI
 * workflow. The flow is *user-driven*: we never auto-download — the renderer
 * asks the user first, we stream progress back, and we install only when they
 * confirm "Restart to update". This matches the in-app modal UX and avoids
 * surprise restarts.
 *
 * Everything is a graceful no-op when running unpacked (dev / `electron .` or
 * `node server.js`), so the app can still be developed and run locally without
 * a published release to point at.
 */
// Renderer protocol (exposed via preload.js as window.fictionhub.updater):
//   invoke update:version  -> current app version string
//   invoke update:state    -> { version, packaged, last } catch-up snapshot
//   invoke update:check    -> run a check (the events below carry the result)
//   invoke update:download -> start downloading the available update
//   invoke update:install  -> quit and install a downloaded update
//   invoke update:defer    -> install a downloaded update on next quit
//   event  update:event    -> { type: checking | available | not-available |
//                               progress | downloaded | error | dev }
const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

let getWindow = () => null;

// Last event pushed to the renderer, kept so a window that (re)loads can
// catch up via update:state instead of waiting for the next check to finish.
let lastEvent = null;

function send(payload) {
  lastEvent = payload;
  const win = typeof getWindow === "function" ? getWindow() : null;
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send("update:event", payload);
  }
}

// GitHub release notes arrive as a string or an array of { note, version }.
function normalizeNotes(notes) {
  if (!notes) return "";
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    // fullChangelog mode: one entry per skipped release — keep the {version}
    // pairing so the renderer can group the changelog by version.
    return notes
      .map(n => ({
        version: (n && n.version) || "",
        note: (typeof n === "string" ? n : (n && n.note)) || "",
      }))
      .filter(n => n.note || n.version);
  }
  return String(notes);
}

function normalizeInfo(info) {
  if (!info) return null;
  return {
    version: info.version || "",
    releaseName: info.releaseName || "",
    releaseDate: info.releaseDate || "",
    notes: normalizeNotes(info.releaseNotes),
  };
}

function configure() {
  autoUpdater.autoDownload = false;         // renderer decides when to download
  autoUpdater.autoInstallOnAppQuit = false;  // install only via explicit restart
  autoUpdater.allowPrerelease = false;
  // Also collect the notes of *every* release between the running version and
  // the newest one (array of { version, note }) so the in-app update window
  // can show the whole changelog even when the user skipped several builds.
  autoUpdater.fullChangelog = true;

  autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
  autoUpdater.on("update-available", info => send({ type: "available", info: normalizeInfo(info) }));
  autoUpdater.on("update-not-available", info => send({ type: "not-available", version: (info && info.version) || "" }));
  autoUpdater.on("error", err => send({ type: "error", message: (err && (err.message || err.code)) || String(err) }));
  autoUpdater.on("download-progress", p => send({
    type: "progress",
    progress: {
      percent: p.percent || 0,
      bytesPerSecond: p.bytesPerSecond || 0,
      transferred: p.transferred || 0,
      total: p.total || 0,
    },
  }));
  autoUpdater.on("update-downloaded", info => send({ type: "downloaded", info: normalizeInfo(info) }));
}

function init(windowGetter) {
  if (typeof windowGetter === "function") getWindow = windowGetter;
  configure();
}

function getVersion() {
  return app.getVersion();
}

async function checkForUpdates() {
  if (!app.isPackaged) { send({ type: "dev" }); return { dev: true }; }
  return autoUpdater.checkForUpdates();
}

async function downloadUpdate() {
  if (!app.isPackaged) throw new Error("Updates are only available in the installed app.");
  return autoUpdater.downloadUpdate();
}

function installUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
}

// "Install the next time I quit" — the update is already downloaded, so let
// the normal quit path finish the install instead of forcing a restart now.
function deferInstall() {
  if (!app.isPackaged) return false;
  autoUpdater.autoInstallOnAppQuit = true;
  return true;
}

// Snapshot for a renderer that just (re)loaded: the running version plus the
// last event we pushed, so the UI can restore mid-flow state (e.g. after a
// page reload) instead of waiting for the next scheduled check.
function getState() {
  return { version: getVersion(), packaged: app.isPackaged, last: lastEvent };
}

module.exports = { init, getVersion, getState, checkForUpdates, downloadUpdate, installUpdate, deferInstall };
