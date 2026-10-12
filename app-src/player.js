/* ===== Native player — our own hls.js player for resolved streams =====
   Replaces the embed <iframe> when a "Native" server tab is active. The
   stream comes from the main-process resolver (hidden window harvesting an
   upstream m3u8) and is played through the local proxy (server.js
   /__stream/*), so no CORS/hotlink problems. Because WE hold the video
   element, Continue Watching gets exact currentTime/duration for native
   playback — and resume seeks back to the saved position. */

let nativeHls = null;          // hls.js instance
let nativeActive = false;      // is the native player currently shown
let nativeProgressTimer = null;
let nativeResolveToken = 0;    // guards against overlapping resolves (fast server/episode switching)

const nEl = (id) => document.getElementById(id);

async function nativeOpen() {
  nativeTeardown(false); // bumps the token, invalidating any prior resolve
  const token = ++nativeResolveToken;
  nativeActive = true;

  nEl("playerFrame").classList.add("hidden");
  const stage = nEl("nativeStage");
  stage.classList.remove("hidden");
  nEl("nativeNotice").textContent = "Resolving stream…";
  nEl("nativeNotice").classList.remove("hidden");

  const { type, id, season, episode } = activeMedia;
  let resolved = null;
  try {
      const r = await fetch(`/__stream/resolve?kind=${type}&id=${id}&season=${season}&episode=${episode}`);
    if (r.ok) resolved = await r.json();
  } catch (e) {
    resolved = null;
  }
  if (token !== nativeResolveToken) return; // user switched away mid-resolve

  if (!resolved) {
    nativeFail("Couldn't resolve a stream on this server — switching…");
    return;
  }

  const url = `/__stream/m3u8?u=${encodeURIComponent(resolved.m3u8)}&r=${encodeURIComponent(resolved.referer || "")}`;
  const video = nEl("nativeVideo");
  try {
    if (window.Hls && Hls.isSupported()) {
      nativeHls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
      nativeHls.loadSource(url);
      nativeHls.attachMedia(video);
      nativeHls.on(Hls.Events.ERROR, (_e, data) => {
        console.log("[native] hls error:", data.type + "/" + data.details, "fatal=" + data.fatal, data.response ? (data.response.code + " " + (data.response.url || "").slice(0, 80)) : "");
        if (data.fatal) nativeFail("Playback error (" + data.type + ") — switching servers…");
      });
      nativeHls.on(Hls.Events.MANIFEST_LOADING, () => console.log("[native] manifest loading"));
      nativeHls.on(Hls.Events.MANIFEST_LOADED, () => console.log("[native] manifest loaded"));
      nativeHls.on(Hls.Events.MEDIA_ATTACHED, () => console.log("[native] media attached"));
      nativeHls.on(Hls.Events.MANIFEST_PARSED, () => {
        nativeFillQuality();
        nativeMaybeResume();
        armFailover(); // count the 14s no-playback window from manifest, not resolve
        video.play().catch(() => {});
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener("loadedmetadata", () => { armFailover(); nativeMaybeResume(); video.play().catch(() => {}); }, { once: true });
    } else {
      nativeFail("This browser can't play HLS — switching servers…");
      return;
    }
  } catch (e) {
    nativeFail("Player error: " + e.message);
    return;
  }

  nEl("nativeNotice").classList.add("hidden");
}

function nativeFail(msg) {
  if (!nativeActive) return;
  if (sourceIndex < SOURCES.length - 1) {
    setFailoverNotice(msg);
    switchSource(sourceIndex + 1);
  } else {
    setFailoverNotice("No source found on any server for this title.");
    nEl("nativeNotice").textContent = msg;
    nEl("nativeNotice").classList.remove("hidden");
  }
}

// Seek to the saved position when resuming the same movie/episode — the
// cross-server resume the embed providers could only sometimes do.
function nativeMaybeResume() {
  const w = store.watching[activeMedia.type + ":" + activeMedia.id];
  const sameEp = w && (activeMedia.type !== "tv" || (w.season == activeMedia.season && w.episode == activeMedia.episode));
  const secs = sameEp ? Math.floor(w.currentTime || 0) : 0;
  const video = nEl("nativeVideo");
  if (secs > 5 && secs < (video.duration || Infinity) - 30) video.currentTime = secs;
}

function nativeTeardown(hideStage = true) {
  nativeResolveToken++;
  clearTimeout(nativeProgressTimer);
  if (nativeHls) { try { nativeHls.destroy(); } catch {} nativeHls = null; }
  const video = nEl("nativeVideo");
  if (video) { try { video.pause(); video.removeAttribute("src"); video.load(); } catch {} }
  if (hideStage) {
    const stage = nEl("nativeStage");
    if (stage) stage.classList.add("hidden");
    const frame = nEl("playerFrame");
    if (frame) frame.classList.remove("hidden");
  }
  nativeActive = false;
}

// Close/cleanup used by app.js when leaving the watch view or switching to
// an embed server. Saves the final position synchronously first.
function nativeClose() {
  if (!nativeActive) return;
  nativeSaveProgress(true);
  nativeTeardown(true);
}

/* ---------- progress → Continue Watching (exact, unlike embeds) ---------- */
function nativeSaveProgress(final = false) {
  if (!activeMedia || !activeMedia.title) return;
  const video = nEl("nativeVideo");
  if (!video || !video.duration || !isFinite(video.duration)) return;
  const key = activeMedia.type + ":" + activeMedia.id;
  const w = store.watching;
  w[key] = {
    id: activeMedia.id,
    type: activeMedia.type,
    title: activeMedia.title,
    poster: activeMedia.poster,
    rating: activeMedia.rating,
    season: activeMedia.season,
    episode: activeMedia.episode,
    progress: (video.currentTime / video.duration) * 100,
    currentTime: video.currentTime,
    duration: video.duration,
    updated: Date.now(),
  };
  store.watching = w;
  if (!final) nativeProgressTimer = setTimeout(() => nativeSaveProgress(), 5000);
}

/* ---------- controls ---------- */
function nativeTogglePlay() {
  const v = nEl("nativeVideo");
  if (!v) return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
}
function nativeSeekBy(delta) {
  const v = nEl("nativeVideo");
  if (v && isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + delta));
}
function nativeToggleMute() {
  const v = nEl("nativeVideo");
  if (v) { v.muted = !v.muted; nEl("nativeMuteBtn").textContent = v.muted ? "🔇" : "🔊"; }
}
function nativeToggleFullscreen() {
  const stage = nEl("nativeStage");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else stage.requestFullscreen().catch(() => {});
}
function nativeFillQuality() {
  const sel = nEl("nativeQuality");
  if (!sel || !nativeHls) return;
  const levels = nativeHls.levels || [];
  sel.innerHTML = `<option value="-1">Auto</option>` +
    levels.map((l, i) => `<option value="${i}">${l.height ? l.height + "p" : "Level " + (i + 1)}</option>`).join("");
}
function nativeSetQuality(v) {
  if (nativeHls) nativeHls.currentLevel = +v; // -1 = auto
}

function fmtTime(s) {
  if (!isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}

function nativeBindControls() {
  const video = nEl("nativeVideo");
  if (!video || video.dataset.bound) return;
  video.dataset.bound = "1";

  video.addEventListener("playing", () => {
    playbackStarted = true;
    clearTimeout(failoverTimer);
    setFailoverNotice("");
    nEl("nativeNotice").classList.add("hidden");
    nEl("nativePlayBtn").textContent = "⏸";
    clearTimeout(nativeProgressTimer);
    nativeProgressTimer = setTimeout(() => nativeSaveProgress(), 5000);
  });
  video.addEventListener("pause", () => {
    nEl("nativePlayBtn").textContent = "▶";
    nativeSaveProgress(true);
  });
  video.addEventListener("timeupdate", () => {
    const bar = nEl("nativeSeek");
    if (isFinite(video.duration)) {
      if (!bar.dataset.dragging) bar.value = (video.currentTime / video.duration) * 1000;
      nEl("nativeTime").textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    }
  });
  video.addEventListener("waiting", () => {
    nEl("nativeNotice").textContent = "Buffering…";
    nEl("nativeNotice").classList.remove("hidden");
  });

  const bar = nEl("nativeSeek");
  bar.addEventListener("input", () => { bar.dataset.dragging = "1"; });
  bar.addEventListener("change", () => {
    if (isFinite(video.duration)) video.currentTime = (bar.value / 1000) * video.duration;
    delete bar.dataset.dragging;
  });

  const vol = nEl("nativeVolume");
  vol.addEventListener("input", () => { video.volume = +vol.value; video.muted = false; nEl("nativeMuteBtn").textContent = "🔊"; });

  // click video to toggle, double-click fullscreen
  video.addEventListener("click", nativeTogglePlay);
  video.addEventListener("dblclick", nativeToggleFullscreen);
}

// Dev helper: attach the player UI to an arbitrary HLS URL (no resolver) —
// used for testing the player in a plain browser.
function nativeDevPlay(url) {
  nativeTeardown(false);
  nativeActive = true;
  nEl("playerFrame").classList.add("hidden");
  nEl("nativeStage").classList.remove("hidden");
  nativeBindControls();
  const video = nEl("nativeVideo");
  if (window.Hls && Hls.isSupported()) {
    nativeHls = new Hls({});
    nativeHls.loadSource(url);
    nativeHls.attachMedia(video);
    nativeHls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
  } else { video.src = url; video.play().catch(() => {}); }
}

nativeBindControls();
