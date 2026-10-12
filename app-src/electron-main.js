/**
 * FictionHub desktop app (Electron).
 * Starts the local server (proxy + static files) in-process, then shows the
 * site in its own window. Everything stays on 127.0.0.1 — nothing is exposed.
 */
const path = require("path");
const { app, BrowserWindow, shell, session, ipcMain } = require("electron");

// Point the server's localStorage backup at userData (survives reinstalls,
// unlike the app's install directory which gets replaced on every install).
process.env.FH_DATA_DIR = app.getPath("userData");

require("./server.js"); // boots the local server on 127.0.0.1:8787

// In-app auto-update manager (electron-updater → GitHub Releases built by CI).
const updater = require("./updater.js");

const URL = "http://localhost:8787";

// Ad/redirect networks commonly injected by free streaming embeds. Blocking
// these at the network level stops popup ads, banner/video ads, and in-page
// ad redirects without touching the actual video sources.
const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|googletagmanager\.com|googletagservices\.com|adsterra\.com|adsterratech\.com|propellerads\.com|propu\.sh|popads\.net|poptm\.com|popmyads\.com|popcash\.net|popunder\.net|exoclick\.com|exosrv\.com|realsrv\.com|magsrv\.com|juicyads\.com|adcash\.com|hilltopads\.net|mgid\.com|taboola\.com|outbrain\.com|revcontent\.com|clickadu\.com|clickadilla\.com|adskeeper\.co\.uk|smartyads\.com|bidvertiser\.com|adnxs\.com|adsrvr\.org|criteo\.com|onclickads\.net|onclckmax\.com|onclicka\.net|otieu\.com|highperformanceformat\.com|displayvertising\.com|adprotek\.com|trafficjunky\.net|trafficfactory\.biz|cdn\.embedads\.net|fpyf8\.com|btloader\.com|vidoomy\.com|primis\.tech|aaxads\.com|aaxdetect\.com|adsco\.re|z5x\.net|tsyndicate\.com|ezmob\.com|yllix\.com|trafficstars\.com|a-ads\.com|smartadserver\.com|media\.net|amazon-adsystem\.com|moatads\.com|scorecardresearch\.com|quantserve\.com|zedo\.com|openx\.net|pubmatic\.com|rubiconproject\.com|luckyorange\.com|histats\.com|adform\.net|adnium\.com|clickagy\.com|ad6media\.fr|teads\.tv|gptads\.io|cloudfront-ads\.net|monetizemore\.com|monetag\.com|ad-maven\.com|admaven\.com|galaksion\.com|pushground\.com|richpush\.co|richads\.com|adservme\.com|adsyndication\.app|partners\.house|hyperhive\.app|kontextua\.com|adpushup\.com|stripchat\.com|chaturbate\.com|tsyndicate\.app|popunderjs\.com|bemobtrk\.com|bttrack\.com|cpmrevenuegate\.com|toponad\.com|adavewq\.com|prpops\.com|pushwhy\.com|boostsaa\.com|onlcdn\.com)$/i;

// In-page ad/redirect scripts that streaming embeds load from their own
// domain (so a hostname blocklist alone can't catch them) — matched against
// the full request URL.
const AD_PATH_PATTERNS = [
  /\/(pop|popunder|popup|banner|interstitial)[-_./]/i,
  /\b(popunder|pop-under|pop_under)\b/i,
  /\b(adblock|antiadblock|anti-adblock)\b/i,
  /\/ads?\/(loader|tag|script|init)/i,
];

// Registrable domain (last two labels) — good enough for the .com/.net/.to/
// .pro/.cc/.win/.xyz/.skin/.co providers we use, no public-suffix-list needed.
function regDomain(host) {
  const parts = host.split(".");
  return parts.slice(-2).join(".");
}

// Set by the renderer (via preload) right before it points the player
// <iframe> at a new provider. Lets will-frame-navigate tell "the embed
// navigated itself away to an ad/landing page" (block) apart from "we
// switched servers / the embed redirected within its own site" (allow).
let expectedEmbedHost = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "FictionHub",
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // open external links (e.g. the TMDB key link) in the real browser, not the app.
  // Popups from player iframes (ad windows) are just blocked, not opened.
  win.webContents.setWindowOpenHandler(({ url, frame }) => {
    if (url.startsWith(URL)) return { action: "allow" };
    if (frame === win.webContents.mainFrame) shell.openExternal(url);
    return { action: "deny" };
  });

  // The most disruptive "ad" pattern on free embeds: the whole player
  // <iframe> gets hijacked (on click, or after a delay) into navigating to
  // an unrelated ad/landing page. Block any top-level navigation of that
  // frame to a different site than the one the renderer asked for.
  win.webContents.on("will-frame-navigate", (event) => {
    const frame = event.frame;
    if (!frame || frame.parent !== win.webContents.mainFrame) return; // only the player iframe
    if (!expectedEmbedHost) return;
    let to;
    try { to = new URL(event.url); } catch { return; }
    if (regDomain(to.hostname) !== regDomain(expectedEmbedHost)) event.preventDefault();
  });

  const load = () => win.loadURL(URL);
  load();
  // retry once if the server wasn't quite ready on first paint — only for the
  // main app shell, not for player iframes (which fail/redirect normally)
  const onFailLoad = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || !validatedURL.startsWith(URL)) return;
    win.webContents.off("did-fail-load", onFailLoad);
    setTimeout(load, 400);
  };
  win.webContents.on("did-fail-load", onFailLoad);
}

ipcMain.on("set-embed-host", (event, host) => {
  expectedEmbedHost = typeof host === "string" ? host : null;
});

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let host;
    try { host = new URL(details.url).hostname; } catch { return callback({}); }
    callback({ cancel: AD_HOSTS.test(host) || AD_PATH_PATTERNS.some(p => p.test(details.url)) });
  });

  createWindow();

  // --- In-app auto-update -------------------------------------------------
  // updater.js pushes `update:event` messages into the window; the renderer
  // UI (update-ui.js) drives everything. Nothing is ever downloaded or
  // installed without the user confirming it in the update window. Results
  // are kept to plain values — structured-clone can't send electron-updater's
  // UpdateCheckResult (it carries a CancellationToken) over IPC.
  updater.init(() => BrowserWindow.getAllWindows()[0] || null);
  ipcMain.handle("update:version", () => updater.getVersion());
  ipcMain.handle("update:state", () => updater.getState());
  ipcMain.handle("update:check", async () => {
    try {
      const result = await updater.checkForUpdates();
      return result && result.dev ? { dev: true } : { ok: true };
    } catch (e) {
      return { ok: false, error: (e && (e.message || e.code)) || String(e) };
    }
  });
  ipcMain.handle("update:download", async () => {
    try {
      await updater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && (e.message || e.code)) || String(e) };
    }
  });
  ipcMain.handle("update:install", () => { updater.installUpdate(); return { ok: true }; });
  ipcMain.handle("update:defer", () => ({ ok: updater.deferInstall() }));
});

app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
