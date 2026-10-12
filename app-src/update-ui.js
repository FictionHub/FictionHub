/* ===== In-app auto-update window (renderer) =====
 *
 * Talks to the main-process updater (updater.js) through the preload bridge
 * (window.fictionhub.updater) and renders two things:
 *   1. the update prompt modal (#updateModal): current version → latest
 *      version, release notes, download progress, and the install buttons;
 *   2. the Settings → Updates section (#updStatus et al).
 *
 * A check runs ~10s after launch and every 6h after that, but a download only
 * ever starts after the user confirms it, and the install only happens when
 * they pick "Restart to update" (or on next quit). Safe to load in a plain
 * browser (no Electron bridge): everything degrades to a note in Settings and
 * no modal ever appears.
 */

const upd = {
  bridge: (typeof window !== "undefined" && window.fictionhub) ? window.fictionhub.updater : null,
  // idle|checking|available|downloading|downloaded|installing|current|error|dev|unsupported
  state: "idle",
  info: null,       // { version, releaseName, releaseDate, notes }
  progress: null,   // { percent, bytesPerSecond, transferred, total }
  error: "",
  errorStep: "check", // which step failed (check|download) — drives "Try again"
  manual: false,    // latest check was started from the UI (keep the modal open)
  pending: false,   // update found in the background → open the window when idle
  dismissedFor: "", // version the user closed ("Later"/Esc) this session
  curVersion: "",
  latest: "",
};

function updEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function updBytes(n) {
  n = +n || 0;
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + " " + units[i];
}

function updDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function updLinkify(text) {
  return String(text).replace(/https?:\/\/[^\s<)"']+/g, (url) => {
    const trail = /[.,;:!?]+$/.exec(url);
    const clean = trail ? url.slice(0, -trail[0].length) : url;
    return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>` + (trail ? trail[0] : "");
  });
}

// **bold** → <strong> (release notes are markdown-ish), then linkify URLs.
function updFmt(s) {
  return updLinkify(String(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"));
}

// Release notes arrive as plain text (commit subjects + a compare link).
// Everything is escaped first and only bullets/paragraphs are produced, so a
// hostile commit message cannot run script inside the app.
function updNoteBody(text) {
  if (!text || !String(text).trim()) return "";
  const lines = updEsc(String(text).replace(/\r\n?/g, "\n")).split("\n");
  let html = "", list = false;
  const closeList = () => { if (list) { html += "</ul>"; list = false; } };
  for (const raw of lines) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
    if (bullet) {
      if (!list) { html += "<ul>"; list = true; }
      html += `<li>${updFmt(bullet[1])}</li>`;
    } else if (!raw.trim()) {
      closeList();
    } else {
      closeList();
      html += `<p>${updFmt(raw.trim())}</p>`;
    }
  }
  closeList();
  return html;
}

// notes is a string (one release) or [{ version, note }] (fullChangelog mode).
function updNotesHtml(notes) {
  if (!notes) return "";
  if (Array.isArray(notes)) {
    return notes
      .filter(n => n && (n.note || n.version))
      .map(n => `<div class="upd-note">${n.version ? `<div class="upd-note-ver">v${updEsc(String(n.version).replace(/^v/, ""))}</div>` : ""}${updNoteBody(n.note)}</div>`)
      .join("");
  }
  return updNoteBody(notes);
}

function updModalEl() { return document.getElementById("updateModal"); }
function updModalVisible() { const el = updModalEl(); return !!el && !el.classList.contains("hidden"); }

function updIsSkipped(v) {
  try { return !!v && localStorage.getItem("fh_update_skipped") === v; } catch { return false; }
}

function updSetBadge(on) {
  const btn = document.getElementById("settingsBtn");
  if (btn) btn.classList.toggle("upd-badge", !!on);
}

function updOpen() {
  const el = updModalEl();
  if (!el) return;
  el.classList.remove("hidden");
  document.body.classList.add("upd-open");
  updRenderModal();
}

function updClose() {
  const el = updModalEl();
  if (!el) return;
  el.classList.add("hidden");
  document.body.classList.remove("upd-open");
  // Closing the window means "not now" for this version until the app restarts.
  if (upd.state === "available" || upd.state === "downloading" || upd.state === "downloaded") {
    upd.dismissedFor = upd.latest || "";
  }
}

function updRefresh() {
  if (updModalVisible()) updRenderModal();
  renderUpdateSection();
}

/* ---------- The update window ---------- */
function updIcon(kind) {
  if (kind === "spin") return `<div class="upd-icon spin" aria-hidden="true"></div>`;
  const cls = { ok: " ok", err: " err", neutral: " neutral" }[kind] || "";
  const glyph = kind === "err" ? "!" : kind === "neutral" ? "⚙" : kind === "ok" ? "✓" : "⬆";
  return `<div class="upd-icon${cls}" aria-hidden="true">${glyph}</div>`;
}

function updChips() {
  const cur = upd.curVersion ? "v" + updEsc(upd.curVersion) : "";
  const next = upd.latest ? "v" + updEsc(upd.latest) : "";
  return `<div class="upd-vers">
      <span class="ver-chip">${cur}</span>
      ${next && next !== cur ? `<span class="upd-arrow">→</span><span class="ver-chip ver-chip-new">${next}</span>` : ""}
    </div>`;
}

function updNotesCard() {
  let body = updNotesHtml(upd.info ? upd.info.notes : "");
  if (!body) {
    body = `<p class="upd-notes-empty">The full list of changes lives on the <a href="https://github.com/FictionHub/FictionHub/releases" target="_blank" rel="noopener">FictionHub releases page</a>.</p>`;
  }
  return `<div class="upd-notes-head">What's changed</div><div class="upd-notes">${body}</div>`;
}

function updRenderModal() {
  const box = document.getElementById("updModalInner");
  if (!box || !updModalVisible()) return;

  const closeBtn = `<button class="close" onclick="updClose()" title="Close">✕</button>`;
  const sub = upd.info && upd.info.releaseName ? updEsc(upd.info.releaseName) : "";
  const rel = upd.info && upd.info.releaseDate ? updDate(upd.info.releaseDate) : "";
  const hero = (icon, title, text) =>
    `<div class="upd-hero">${icon}<h2 id="updTitle">${title}</h2>${text ? `<p class="upd-sub">${text}</p>` : ""}</div>`;
  const actions = (...btns) => `<div class="upd-actions">${btns.join("")}</div>`;
  let html;

  switch (upd.state) {
    case "checking":
      html = hero(updIcon("spin"), "Checking for updates", "Looking for the latest version of FictionHub…")
        + actions(`<button class="btn btn-ghost" onclick="updClose()">Close</button>`);
      break;

    case "available":
      html = closeBtn
        + hero(updIcon("up"), "Update available", sub || "A new version of FictionHub is ready to install.")
        + `<div class="upd-body">${updChips()}${rel ? `<p class="upd-date">Released ${rel}</p>` : ""}${updNotesCard()}</div>`
        + actions(
            `<button class="upd-link" onclick="updSkip()">Skip this version</button>`,
            `<button class="btn btn-ghost" onclick="updLater()">Remind me later</button>`,
            `<button class="btn btn-play" onclick="updDownload()">Update now</button>`);
      break;

    case "downloading": {
      const p = upd.progress;
      const pct = p && p.percent ? Math.round(p.percent) : 0;
      const fill = p && p.percent
        ? `<div class="upd-progress-fill" style="width:${Math.max(2, pct)}%"></div>`
        : `<div class="upd-progress-fill indeterminate"></div>`;
      const meta = p
        ? `<div class="upd-prog-meta"><span>${pct}% · ${updBytes(p.transferred)} of ${updBytes(p.total)}</span><span>${updBytes(p.bytesPerSecond)}/s</span></div>`
        : `<div class="upd-prog-meta"><span>Starting download…</span><span></span></div>`;
      html = closeBtn
        + hero(updIcon("spin"), "Downloading update", upd.latest ? `Version v${updEsc(upd.latest)} is on its way.` : "The update is on its way.")
        + `<div class="upd-body">${updChips()}<div class="upd-progress">${fill}</div>${meta}</div>`
        + actions(`<button class="btn btn-ghost" onclick="updClose()">Hide</button>`);
      break;
    }

    case "downloaded":
      html = closeBtn
        + hero(updIcon("ok"), "Ready to install", `FictionHub v${updEsc(upd.latest)} has been downloaded. Restart to finish updating.`)
        + `<div class="upd-body">${updChips()}${updNotesCard()}</div>`
        + actions(
            `<button class="upd-link" onclick="updInstallOnQuit()">Install the next time I quit</button>`,
            `<button class="btn btn-play" onclick="updInstall()">Restart to update</button>`);
      break;

    case "installing":
      html = hero(updIcon("spin"), "Restarting FictionHub", "Finishing the update — the installer will take it from here.");
      break;

    case "current":
      html = closeBtn
        + hero(updIcon("ok"), "You're up to date", upd.curVersion ? `FictionHub v${updEsc(upd.curVersion)} is the latest version.` : "You have the latest version of FictionHub.")
        + actions(`<button class="btn btn-play" onclick="updClose()">Done</button>`);
      break;

    case "error":
      html = closeBtn
        + hero(updIcon("err"),
            upd.errorStep === "download" ? "Download failed" : "Couldn't check for updates",
            updEsc(upd.error) || "Something went wrong. Please try again.")
        + actions(
            `<button class="btn btn-ghost" onclick="updClose()">Close</button>`,
            `<button class="btn btn-play" onclick="${upd.errorStep === "download" ? "updDownload()" : "updCheck(true)"}">Try again</button>`);
      break;

    case "dev":
      html = closeBtn
        + hero(updIcon("neutral"), "Development build", "You're running FictionHub from source — updates are only checked in the installed app.")
        + actions(`<button class="btn btn-play" onclick="updClose()">OK</button>`);
      break;

    default: // unsupported / idle
      html = closeBtn
        + hero(updIcon("neutral"), "Updates", "Updates are only available in the FictionHub desktop app.")
        + actions(`<button class="btn btn-play" onclick="updClose()">OK</button>`);
  }
  box.innerHTML = html;
}

/* ---------- User actions (wired to the buttons via onclick) ---------- */
function updCheck(manual = true) {
  upd.manual = !!manual;
  // Already have something to show? Just (re)open the window instead of
  // running another network round-trip first.
  if (manual && ["available", "downloading", "downloaded"].indexOf(upd.state) !== -1) { updOpen(); return; }
  if (!upd.bridge) { upd.state = "unsupported"; if (manual) updOpen(); else renderUpdateSection(); return; }
  upd.state = "checking";
  upd.error = "";
  if (manual) updOpen(); else updRefresh();
  upd.bridge.check()
    .then(res => {
      if (res && res.ok === false) updFail("check", res.error);
      else if (res && res.dev) updOnEvent({ type: "dev" });
    })
    .catch(e => updFail("check", (e && e.message) || String(e)));
}

function updFail(step, message) {
  upd.error = message || "Unknown error";
  upd.errorStep = step;
  if (upd.state === "downloaded" || upd.state === "installing") return; // never clobber a finished download
  upd.state = "error";
  if (upd.manual && !updModalVisible()) updOpen(); else updRefresh();
}

function updDownload() {
  if (!upd.bridge || upd.state === "downloading") return;
  upd.state = "downloading";
  upd.progress = null;
  upd.manual = true;
  updRefresh();
  upd.bridge.download()
    .then(res => { if (res && res.ok === false) updFail("download", res.error); })
    .catch(e => updFail("download", (e && e.message) || String(e)));
}

function updInstall() {
  if (!upd.bridge) return;
  upd.state = "installing";
  updRefresh();
  upd.bridge.install();
  // If the quit somehow doesn't happen, restore the button instead of leaving
  // a dead "Restarting…" screen up forever.
  setTimeout(() => { if (upd.state === "installing") { upd.state = "downloaded"; updRefresh(); } }, 5000);
}

function updInstallOnQuit() {
  if (upd.bridge) upd.bridge.defer();
  updClose();
  renderUpdateSection();
}

function updLater() { updClose(); }

function updSkip() {
  if (upd.latest) {
    try {
      localStorage.setItem("fh_update_skipped", upd.latest);
      if (typeof scheduleBackup === "function") scheduleBackup();
    } catch {}
  }
  updSetBadge(false);
  upd.pending = false;
  updClose();
  renderUpdateSection();
}

/* ---------- Events pushed by the main process ---------- */
function updOnEvent(p) {
  if (!p) return;
  switch (p.type) {
    case "checking":
      if (upd.state !== "downloaded" && upd.state !== "installing") upd.state = "checking";
      break;

    case "available":
      // Already holding an installer? Keep showing it — the next launch will
      // pick up any newer release after this one installs.
      if (upd.state === "downloaded" || upd.state === "installing") break;
      upd.info = p.info || upd.info;
      upd.latest = (upd.info && upd.info.version) || upd.latest || "";
      if (upd.state !== "downloading") upd.state = "available";
      updSetBadge(!updIsSkipped(upd.latest));
      if (updIsSkipped(upd.latest)) upd.pending = false;
      else if (upd.manual) { upd.pending = false; updOpen(); }
      else if (upd.dismissedFor !== upd.latest) { upd.pending = true; updTryAutoOpen(); }
      break;

    case "not-available":
      upd.info = null; upd.latest = ""; upd.progress = null;
      upd.state = "current"; upd.pending = false;
      updSetBadge(false);
      if (upd.manual) updOpen();
      break;

    case "progress":
      upd.state = "downloading";
      upd.progress = p.progress || upd.progress;
      break;

    case "downloaded":
      upd.info = p.info || upd.info;
      upd.latest = (p.info && p.info.version) || upd.latest || "";
      upd.state = "downloaded";
      upd.progress = null;
      updSetBadge(!updIsSkipped(upd.latest));
      if (upd.dismissedFor !== upd.latest) { upd.pending = true; updTryAutoOpen(); }
      break;

    case "error":
      updFail(upd.state === "downloading" ? "download" : "check", p.message);
      break;

    case "dev":
      upd.state = "dev";
      break;
  }
  updRefresh();
}

// The window only auto-opens when the app is otherwise idle — never on top of
// the profile picker, the player, or the manga reader.
function updIdleForPrompt() {
  const shown = id => { const el = document.getElementById(id); return !!el && !el.classList.contains("hidden"); };
  return !shown("profileScreen") && !shown("profileModal") && !shown("watchView") && !shown("mangaView");
}

function updTryAutoOpen() {
  if (!upd.pending || updModalVisible()) return;
  if (upd.dismissedFor && upd.dismissedFor === upd.latest) { upd.pending = false; return; }
  if (updIsSkipped(upd.latest)) { upd.pending = false; updSetBadge(false); return; }
  if (!updIdleForPrompt()) return;
  upd.pending = false;
  upd.manual = false;
  updOpen();
}

/* ---------- Settings → Updates section ---------- */
function renderUpdateSection() {
  const status = document.getElementById("updStatus");
  if (!status) return;

  const cur = document.getElementById("updCurChip");
  if (cur) cur.textContent = upd.curVersion ? "v" + upd.curVersion : "…";

  const hasLatest = !!upd.latest &&
    ["available", "downloading", "downloaded", "installing", "error"].indexOf(upd.state) !== -1;
  const latestChip = document.getElementById("updLatestChip");
  const arrow = document.getElementById("updArrow");
  if (latestChip) {
    latestChip.textContent = upd.latest ? "v" + upd.latest : "";
    latestChip.classList.toggle("hidden", !hasLatest);
  }
  if (arrow) arrow.classList.toggle("hidden", !hasLatest);

  const btn = document.getElementById("updCheckBtn");
  if (btn) {
    btn.disabled = upd.state === "checking";
    btn.textContent =
      upd.state === "checking" ? "Checking…" :
      (upd.state === "available" || upd.state === "downloaded") ? "View update" :
      upd.state === "downloading" ? "View download" :
      "Check for updates";
  }

  let msg = "FictionHub checks for updates automatically when the app starts. You can also check manually.";
  switch (upd.state) {
    case "checking": msg = "Checking for updates…"; break;
    case "current": msg = upd.curVersion ? `You're up to date — v${upd.curVersion} is the latest version.` : "You're up to date."; break;
    case "available": msg = `v${upd.latest} is available${upd.curVersion ? " (you have v" + upd.curVersion + ")" : ""}. Open the update window to see what changed.`; break;
    case "downloading": msg = upd.progress && upd.progress.percent ? `Downloading v${upd.latest}… ${Math.round(upd.progress.percent)}%` : `Downloading v${upd.latest}…`; break;
    case "downloaded": msg = `v${upd.latest} is downloaded and ready — restart FictionHub to finish installing, or install automatically the next time you quit.`; break;
    case "installing": msg = "Restarting to install the update…"; break;
    case "error": msg = `${upd.errorStep === "download" ? "Download failed" : "Couldn't check for updates"}: ${upd.error}`; break;
    case "dev": msg = "You're running a development build — updates are only available in the installed app."; break;
    case "unsupported": msg = "Updates are only available in the FictionHub desktop app."; break;
  }
  if (hasLatest && updIsSkipped(upd.latest)) msg += " (You skipped this version — you can still update whenever you like.)";
  status.textContent = msg;
}

/* ---------- Boot ---------- */
(function initUpdateUI() {
  if (upd.bridge) {
    upd.bridge.onEvent(updOnEvent);
    upd.bridge.getVersion().then(v => { upd.curVersion = v || ""; renderUpdateSection(); }).catch(() => {});
    // Catch up on anything that happened before a page reload.
    upd.bridge.getState().then(s => {
      if (s && s.last && s.last.type !== "error") updOnEvent(s.last);
    }).catch(() => {});

    setTimeout(() => updCheck(false), 10000);               // first automatic check
    setInterval(() => updCheck(false), 6 * 60 * 60 * 1000); // then every 6 hours
  } else {
    upd.state = "unsupported";
  }

  setInterval(updTryAutoOpen, 15000); // background find while busy → ask when idle

  // Esc closes the window; swallow the keystroke so the app's own shortcut
  // (Esc = back to browse) doesn't fire behind it. Capture on window runs
  // before the document-level listener in app.js.
  window.addEventListener("keydown", (e) => {
    if (!updModalVisible()) return;
    e.stopPropagation();
    if (e.key === "Escape") updClose();
  }, true);

  // Clicking the dark backdrop closes the window (a download keeps running).
  const modal = updModalEl();
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) updClose(); });

  renderUpdateSection();
})();
