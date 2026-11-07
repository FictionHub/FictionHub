/* ===== Offline player — our own hls.js player for downloaded titles =====
   Streaming uses Vyla's player (vyla-player/, in the #playerFrame iframe).
   This one only plays downloads: the local HLS playlist + segments the
   server wrote under VIDEO_DIR (/__video/playlist/<key>). Because WE hold
   the video element, Continue Watching gets exact currentTime/duration and
   resume seeks back to the saved position. */

let nativeHls = null;          // hls.js instance
let nativeActive = false;      // is the native player currently shown
let nativeProgressTimer = null;

const nEl = (id) => document.getElementById(id);

// Play a downloaded title straight from disk: the local m3u8 + segments (and
// any AES-128 keys) we stored under VIDEO_DIR, served by the local server on
// this same origin — no embed, no upstream, no internet needed.
function nativePlayLocal(playlistUrl) {
  nativeTeardown(false);
  nativeActive = true;
  // stop the streaming player, or it keeps playing behind the download
  const frame = nEl("playerFrame");
  frame.src = "";
  frame.classList.add("hidden");
  if (typeof vylaWatchTimer !== "undefined") clearInterval(vylaWatchTimer);
  const stage = nEl("nativeStage");
  stage.classList.remove("hidden");
  if (typeof setFailoverNotice === "function") setFailoverNotice("");
  nEl("nativeNotice").textContent = "Preparing download…";
  nEl("nativeNotice").classList.remove("hidden");

  const video = nEl("nativeVideo");
  try {
    if (window.Hls && Hls.isSupported()) {
      nativeHls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
      nativeHls.loadSource(playlistUrl);
      nativeHls.attachMedia(video);
      nativeHls.on(Hls.Events.ERROR, (_e, data) => {
        console.log("[native download] hls error:", data.type + "/" + data.details, "fatal=" + data.fatal);
        if (data.fatal) {
          nEl("nativeNotice").textContent = "Couldn't play this download — try downloading it again.";
          nEl("nativeNotice").classList.remove("hidden");
        }
      });
      nativeHls.on(Hls.Events.MANIFEST_PARSED, () => {
        nativeFillQuality();
        nativeMaybeResume();
        nEl("nativeNotice").classList.add("hidden");
        video.play().catch(() => {});
      });
    } else {
      video.src = playlistUrl;
      video.addEventListener("loadedmetadata", () => { nEl("nativeNotice").classList.add("hidden"); video.play().catch(() => {}); }, { once: true });
    }
  } catch (e) {
    nEl("nativeNotice").textContent = "Player error: " + e.message;
    nEl("nativeNotice").classList.remove("hidden");
    return;
  }
  nativeBindControls();
}

function nativeMaybeResume() {
  const w = store.watching[activeMedia.type + ":" + activeMedia.id];
  const sameEp = w && (activeMedia.type !== "tv" || (w.season == activeMedia.season && w.episode == activeMedia.episode));
  const secs = sameEp ? Math.floor(w.currentTime || 0) : 0;
  const video = nEl("nativeVideo");
  if (secs > 5 && secs < (video.duration || Infinity) - 30) video.currentTime = secs;
}

function nativeTeardown(hideStage = true) {
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
