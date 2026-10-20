/* ===== Universal Player: plays any source type (embed iframe, HLS, direct) with full controls ===== */

let universalPlayer = {
  container: null,
  video: null,
  hls: null,
  currentSource: null,
  currentMedia: null,
  isEmbed: false,
  embedFrame: null,
  embedHost: null,
  qualityLevels: [],
  currentQuality: -1,
  subtitles: [],
  currentSubtitle: -1,
  playbackRate: 1,
  isFullscreen: false,
  isPiP: false,
  resumePosition: 0,
  duration: 0,
  progressTimer: null,
  lastProgressSave: 0,
  callbacks: {
    onPlaybackStart: null,
    onPlaybackEnd: null,
    onError: null,
    onTimeUpdate: null,
    onQualityChange: null,
    onSubtitleChange: null,
    onFullscreenChange: null,
  },
  settings: {
    autoplay: true,
    defaultQuality: "auto",
    defaultSubtitle: "off",
    volume: 1,
    skipIntro: false,
    nextEpisodeAuto: true,
  },
};
let controlsHideTimer = null;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("fh_player_settings") || "{}");
    universalPlayer.settings = { ...universalPlayer.settings, ...saved };
  } catch {}
}

function saveSettings() {
  try {
    localStorage.setItem("fh_player_settings", JSON.stringify(universalPlayer.settings));
  } catch {}
}

function createPlayerUI() {
  const container = document.getElementById("universalPlayerContainer");
  if (!container) {
    console.error("[universal-player] Container #universalPlayerContainer not found");
    return;
  }
  universalPlayer.container = container;

  container.innerHTML = `
    <div class="up-stage" id="upStage">
      <video id="upVideo" playsinline 
        controls
        x-webkit-airplay="allow" 
        disablepictureinpicture="false"
        controlslist="nodownload nofullscreen noremoteplayback"></video>
      <iframe id="upEmbedFrame" class="hidden" allowfullscreen 
        allow="autoplay; encrypted-media; fullscreen; picture-in-page">
      </iframe>
      <div id="upOverlay" class="up-overlay hidden">
        <div class="up-spinner"></div>
        <div id="upOverlayText" class="up-overlay-text">Loading...</div>
        <div id="upOverlayProgress" class="up-overlay-progress hidden">
          <div class="up-progress-bar"><div class="up-progress-fill"></div></div>
        </div>
      </div>
      <div id="upControls" class="up-controls hidden">
        <div class="up-controls-row up-progress-row">
          <span id="upCurrentTime" class="up-time">0:00</span>
          <input type="range" id="upSeek" class="up-seek" min="0" max="1000" value="0" step="1" aria-label="Seek">
          <span id="upDuration" class="up-time">0:00</span>
        </div>
        <div class="up-controls-row up-main-row">
          <button id="upPlayPause" class="up-btn" aria-label="Play/Pause" title="Play/Pause (Space)">⏯</button>
          <button id="upRewind" class="up-btn" aria-label="Rewind 10s" title="Rewind 10s (←)">⏪</button>
          <button id="upForward" class="up-btn" aria-label="Forward 10s" title="Forward 10s (→)">⏩</button>
          <button id="upPrevEp" class="up-btn" aria-label="Previous Episode" title="Previous Episode (Shift+←)">⏮</button>
          <button id="upNextEp" class="up-btn" aria-label="Next Episode" title="Next Episode (Shift+→)">⏭</button>
          <div class="up-spacer"></div>
          <div class="up-volume-group">
            <button id="upMute" class="up-btn" aria-label="Mute" title="Mute (M)">🔊</button>
            <input type="range" id="upVolume" class="up-volume-slider" min="0" max="1" step="0.05" value="1" aria-label="Volume">
          </div>
          <div class="up-quality-group">
            <select id="upQuality" class="up-select" aria-label="Quality" title="Quality"></select>
          </div>
          <div class="up-subtitle-group">
            <select id="upSubtitle" class="up-select" aria-label="Subtitles" title="Subtitles"></select>
          </div>
          <div class="up-speed-group">
            <select id="upSpeed" class="up-select" aria-label="Playback Speed" title="Playback Speed">
              <option value="0.5">0.5×</option>
              <option value="0.75">0.75×</option>
              <option value="1" selected>1×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </div>
          <button id="upPiP" class="up-btn" aria-label="Picture-in-Picture" title="Picture-in-Picture (Alt+P)">🖼</button>
          <button id="upFullscreen" class="up-btn" aria-label="Fullscreen" title="Fullscreen (F)">⛶</button>
        </div>
      </div>
      <div id="upSourceIndicator" class="up-source-indicator hidden">
        <span id="upSourceName"></span>
        <span id="upSourceStatus" class="up-source-status"></span>
        <button id="upNextSource" class="up-btn up-btn-sm" title="Try Next Source">⏭</button>
      </div>
      <div id="upSubtitleTracks" class="hidden"></div>
    </div>
  `;

  universalPlayer.video = document.getElementById("upVideo");
  universalPlayer.embedFrame = document.getElementById("upEmbedFrame");
  bindControlEvents();
}

function bindEvents() {
  const v = universalPlayer.video;
  v.addEventListener("loadedmetadata", onLoadedMetadata);
  v.addEventListener("timeupdate", onTimeUpdate);
  v.addEventListener("playing", onPlaying);
  v.addEventListener("pause", onPause);
  v.addEventListener("ended", onEnded);
  v.addEventListener("waiting", onWaiting);
  v.addEventListener("canplay", onCanPlay);
  v.addEventListener("error", onVideoError);
  v.addEventListener("durationchange", onDurationChange);
  v.addEventListener("ratechange", onRateChange);
  v.addEventListener("volumechange", onVolumeChange);
  v.addEventListener("enterpictureinpicture", () => { universalPlayer.isPiP = true; });
  v.addEventListener("leavepictureinpicture", () => { universalPlayer.isPiP = false; });

  universalPlayer.embedFrame.addEventListener("load", onEmbedLoad);

  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("message", onEmbedMessage);

  // Populate subtitle menu on init in case HLS tracks are already available
  // (e.g., if manifest was parsed before UI was ready)
  populateSubtitleMenu();
  populateQualityMenu();

  const stage = document.getElementById("upStage");
  if (stage) {
    const reveal = () => {
      setControlsVisible(true);
      scheduleControlsHide();
    };
    stage.addEventListener("pointermove", reveal);
    stage.addEventListener("pointerdown", reveal);
    stage.addEventListener("touchstart", reveal, { passive: true });
    stage.addEventListener("mouseleave", () => scheduleControlsHide(500));
  }
  v.addEventListener("playing", () => scheduleControlsHide(1800));
  v.addEventListener("pause", () => setControlsVisible(true));
}

function setControlsVisible(visible) {
  const controls = document.getElementById("upControls");
  const stage = document.getElementById("upStage");
  if (!controls || !stage) return;
  controls.classList.toggle("idle", !visible);
  stage.classList.toggle("controls-idle", !visible);
}

function scheduleControlsHide(delay = 2200) {
  clearTimeout(controlsHideTimer);
  if (!universalPlayer.video || universalPlayer.video.paused || universalPlayer.isEmbed) {
    setControlsVisible(true);
    return;
  }
  controlsHideTimer = setTimeout(() => setControlsVisible(false), delay);
}

function bindControlEvents() {
  const ids = [
    "upPlayPause", "upRewind", "upForward", "upPrevEp", "upNextEp",
    "upMute", "upVolume", "upQuality", "upSubtitle", "upSpeed",
    "upPiP", "upFullscreen", "upNextSource", "upSeek"
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => handleControlClick(id));
    if (el && el.tagName === "SELECT") el.addEventListener("change", () => handleControlChange(id));
    if (el && el.tagName === "INPUT") el.addEventListener("input", () => handleControlInput(id));
  }
}

window.initUniversalPlayer = function initUniversalPlayer(callbacks = {}) {
  universalPlayer.callbacks = { ...universalPlayer.callbacks, ...callbacks };
  loadSettings();
  createPlayerUI();
  bindEvents();
  return universalPlayer;
};

async function loadSource(source, media, options = {}) {
  stopCurrentSource();
  universalPlayer.currentSource = source;
  universalPlayer.currentMedia = media;
  universalPlayer.isEmbed = !source.api?.native && !options.forceNative;
  
  showOverlay("Loading " + (source.api?.name || "Source") + "...");
  clearProgressTimer();
  universalPlayer.playbackStarted = false;
  universalPlayer.resumePosition = options.resumePosition || 0;

  updateSourceIndicator(source.api?.name || "Unknown", "connecting...");

  if (universalPlayer.isEmbed) {
    await loadEmbed(source, media);
  } else {
    await loadNative(source, media);
  }
}

async function loadEmbed(source, media) {
  universalPlayer.video.classList.add("hidden");
  universalPlayer.embedFrame.classList.remove("hidden");
  document.getElementById("upControls")?.classList.add("hidden");
  setControlsVisible(true);
  
  const url = source.url;
  if (!url) throw new Error("No URL for embed source");
  
  try {
    universalPlayer.embedHost = new URL(url).hostname;
    window.fictionhub?.setEmbedHost?.(universalPlayer.embedHost);
  } catch {}

  // Video providers are intentionally not part of the manga proxy allowlist.
  // Load the provider directly in the iframe; Electron's frame-navigation
  // guard and request blocker still protect the top-level app from redirects.
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Embed load timeout")), 20000);
    universalPlayer.embedFrame.onload = () => {
      clearTimeout(timeout);
      setTimeout(() => {
        hideOverlay();
        universalPlayer.callbacks.onPlaybackStart?.(source);
        startProgressTracking();
        resolve();
      }, 1500);
    };
    universalPlayer.embedFrame.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Embed iframe error"));
    };
    // Register the handlers before navigation. Cached/local responses can
    // complete synchronously enough to otherwise miss the load event and
    // leave the player black until the timeout fires.
    universalPlayer.embedFrame.src = url;
  });
}

async function loadNative(source, media) {
  universalPlayer.embedFrame.classList.add("hidden");
  universalPlayer.video.classList.remove("hidden");
  document.getElementById("upControls")?.classList.remove("hidden");
  setControlsVisible(true);
  
  if (!source.api?.native) {
    universalPlayer.isEmbed = true;
    return loadEmbed(source, media);
  }

  // Notify outside the try/catch on purpose. A throwing callback (e.g. a bug
  // in the app's onPlaybackStart handler) must not be mistaken for a failed
  // stream — that used to discard a perfectly good HLS session and swap in a
  // different source, leaving the user staring at a black screen.
  const notifyStarted = (src) => {
    try {
      universalPlayer.callbacks.onPlaybackStart?.(src);
    } catch (e) {
      console.error("[universal-player] onPlaybackStart callback failed:", e);
    }
  };

  try {
    // Offline downloads provide their own same-origin HLS playlist. Do not
    // resolve them through the remote Atlantic stream endpoint.
    if (source.url && (source.key === "local" || source.url.startsWith("/__video/"))) {
      await playHLS(source.url);
      hideOverlay();
      notifyStarted(source);
      startProgressTracking();
      return;
    }
    const { type, id, season, episode } = media;
    const res = await fetch(`/__stream/resolve?kind=${type}&id=${id}&season=${season}&episode=${episode}`);
    if (!res.ok) throw new Error("Resolve failed: " + res.status);
    const resolved = await res.json();
    if (!resolved?.m3u8) throw new Error("No stream URL resolved");

    const m3u8Url = `/__stream/m3u8?u=${encodeURIComponent(resolved.m3u8)}&r=${encodeURIComponent(resolved.referer || "")}`;
    await playHLS(m3u8Url);
    hideOverlay();
    notifyStarted(source);
    startProgressTracking();
  } catch (e) {
    console.error("[universal-player] Native load failed:", e);
    if (source.key === "local" || source.url?.startsWith("/__video/")) throw e;
    if (source.api?.native) {
      // The native HLS resolver can be temporarily unavailable. Keep the
      // player useful by falling back to the provider's own embed instead of
      // leaving a black native stage with no URL to load.
      const { type, id, season, episode } = media;
      const url = type === "tv"
        ? `https://atlantic.st/embed/tv/${id}/${season || 1}/${episode || 1}`
        : `https://atlantic.st/embed/movie/${id}`;
      universalPlayer.isEmbed = true;
      return loadEmbed({ key: "native-embed-fallback", api: { name: "Atlantic", native: false }, url }, media);
    }
    universalPlayer.isEmbed = true;
    return loadEmbed(source, media);
  }
}

function stopCurrentSource() {
  clearProgressTimer();
  clearTimeout(controlsHideTimer);
  setControlsVisible(true);
  if (universalPlayer.hls) {
    try { universalPlayer.hls.destroy(); } catch {}
    universalPlayer.hls = null;
  }
  if (universalPlayer.video) {
    try { universalPlayer.video.pause(); } catch {}
    universalPlayer.video.removeAttribute("src");
    universalPlayer.video.load();
  }
  if (universalPlayer.embedFrame) universalPlayer.embedFrame.src = "about:blank";
}

async function playHLS(m3u8Url) {
  if (universalPlayer.hls) {
    try { universalPlayer.hls.destroy(); } catch {}
    universalPlayer.hls = null;
  }
  universalPlayer.video.src = "";
  universalPlayer.video.load();

  if (window.Hls && Hls.isSupported()) {
    universalPlayer.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
      manifestLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 500,
    });
    
    universalPlayer.hls.on(Hls.Events.MANIFEST_PARSED, (e, data) => {
      universalPlayer.qualityLevels = universalPlayer.hls.levels.map((l, i) => ({
        index: i,
        height: l.height,
        bitrate: l.bitrate,
        label: l.height ? `${l.height}p` : `Level ${i+1}`,
      }));
      populateQualityMenu();
      if (universalPlayer.settings.defaultQuality === "auto") {
        universalPlayer.hls.currentLevel = -1;
      } else {
        const idx = universalPlayer.qualityLevels.findIndex(q => q.label === universalPlayer.settings.defaultQuality);
        if (idx >= 0) universalPlayer.hls.currentLevel = idx;
      }
      if (universalPlayer.resumePosition > 5) {
        universalPlayer.video.currentTime = universalPlayer.resumePosition;
      }
      if (universalPlayer.settings.autoplay) universalPlayer.video.play().catch(() => {});
    });

    universalPlayer.hls.on(Hls.Events.LEVEL_SWITCHED, (e, data) => {
      universalPlayer.currentQuality = data.level;
      updateQualityDisplay();
    });

    universalPlayer.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      populateSubtitleMenu();
    });

    universalPlayer.hls.on(Hls.Events.SUBTITLE_TRACK_SWITCHED, (e, data) => {
      universalPlayer.currentSubtitle = data.id;
      updateSubtitleDisplay();
    });

    universalPlayer.hls.on(Hls.Events.ERROR, (e, data) => {
      console.warn("[universal-player] HLS error:", data.type, data.details, data.fatal);
      if (data.fatal) {
        showOverlay("Stream unavailable, trying next source...");
        universalPlayer.callbacks.onError?.(data);
      }
    });

    universalPlayer.hls.loadSource(m3u8Url);
    universalPlayer.hls.attachMedia(universalPlayer.video);
  } else if (universalPlayer.video.canPlayType("application/vnd.apple.mpegurl")) {
    universalPlayer.video.src = m3u8Url;
    universalPlayer.video.addEventListener("loadedmetadata", () => {
      if (universalPlayer.resumePosition > 5) universalPlayer.video.currentTime = universalPlayer.resumePosition;
      if (universalPlayer.settings.autoplay) universalPlayer.video.play().catch(() => {});
    }, { once: true });
  } else {
    throw new Error("HLS not supported");
  }
}

function onEmbedMessage(e) {
  if (!universalPlayer.isEmbed) return;
  const data = e.data;
  if (!data || typeof data !== "object") return;
  
  if (data.type === "MEDIA_DATA" && data.data) {
    const entry = data.data[universalPlayer.currentMedia?.id] || Object.values(data.data)[0];
    if (entry?.progress) {
      reportProgress(entry.progress.watched, entry.progress.duration);
    }
  } else if (data.type === "PLAYER_EVENT" && data.event === "timeupdate") {
    reportProgress(data.currentTime, data.duration);
  } else if (data.currentTime !== undefined && data.duration !== undefined) {
    reportProgress(data.currentTime, data.duration);
  }
  
  if (data.qualities) {
    universalPlayer.qualityLevels = data.qualities;
    populateQualityMenu();
  }
  if (data.subtitles) {
    universalPlayer.subtitles = data.subtitles;
    populateSubtitleMenu();
  }
}

function onEmbedLoad() {
  try {
    const doc = universalPlayer.embedFrame.contentDocument || universalPlayer.embedFrame.contentWindow.document;
    if (doc && !doc.getElementById("fh-embed-helper")) {
      const script = doc.createElement("script");
      script.id = "fh-embed-helper";
      script.textContent = `
        (function() {
          const checkVideo = () => {
            const videos = document.querySelectorAll('video');
            videos.forEach(v => {
              if (v.dataset.fhHooked) return;
              v.dataset.fhHooked = 'true';
              v.addEventListener('timeupdate', () => {
                window.parent.postMessage({ 
                  type: 'FH_PROGRESS', 
                  currentTime: v.currentTime, 
                  duration: v.duration 
                }, '*');
              });
              v.addEventListener('playing', () => window.parent.postMessage({ type: 'FH_PLAYING' }, '*'));
            });
          };
          checkVideo();
          new MutationObserver(checkVideo).observe(document.body, { childList: true, subtree: true });
        })();
      `;
      doc.head.appendChild(script);
    }
  } catch {}
}

function handleControlClick(id) {
  const v = universalPlayer.video;
  switch (id) {
    case "upPlayPause": togglePlay(); break;
    case "upRewind": seekRelative(-10); break;
    case "upForward": seekRelative(10); break;
    case "upPrevEp": universalPlayer.callbacks.onPrevEpisode?.(); break;
    case "upNextEp": universalPlayer.callbacks.onNextEpisode?.(); break;
    case "upMute": toggleMute(); break;
    case "upPiP": togglePiP(); break;
    case "upFullscreen": toggleFullscreen(); break;
    case "upNextSource": universalPlayer.callbacks.onNextSource?.(); break;
  }
}

function handleControlChange(id) {
  const el = document.getElementById(id);
  const val = el.value;
  switch (id) {
    case "upQuality": setQuality(parseInt(val)); break;
    case "upSubtitle": setSubtitle(parseInt(val)); break;
    case "upSpeed": setPlaybackRate(parseFloat(val)); break;
  }
}

function handleControlInput(id) {
  const el = document.getElementById(id);
  if (id === "upVolume") setVolume(parseFloat(el.value));
  else if (id === "upSeek") {
    if (universalPlayer.duration) {
      universalPlayer.video.currentTime = (el.value / 1000) * universalPlayer.duration;
    }
  }
}

function togglePlay() {
  if (universalPlayer.isEmbed) {
    universalPlayer.embedFrame.contentWindow?.postMessage({ command: "playpause" }, "*");
    return;
  }
  if (universalPlayer.video.paused) universalPlayer.video.play().catch(() => {});
  else universalPlayer.video.pause();
}

function seekRelative(seconds) {
  if (universalPlayer.isEmbed) {
    universalPlayer.embedFrame.contentWindow?.postMessage({ command: "seek", offset: seconds }, "*");
    return;
  }
  universalPlayer.video.currentTime = Math.max(0, Math.min(universalPlayer.duration, universalPlayer.video.currentTime + seconds));
}

function setVolume(vol) {
  universalPlayer.settings.volume = vol;
  saveSettings();
  if (universalPlayer.isEmbed) {
    universalPlayer.embedFrame.contentWindow?.postMessage({ command: "volume", volume: vol }, "*");
    return;
  }
  universalPlayer.video.volume = vol;
  universalPlayer.video.muted = vol === 0;
  updateMuteButton();
}

function toggleMute() {
  setVolume(universalPlayer.video.muted ? universalPlayer.settings.volume : 0);
}

function setPlaybackRate(rate) {
  universalPlayer.playbackRate = rate;
  if (universalPlayer.isEmbed) {
    universalPlayer.embedFrame.contentWindow?.postMessage({ command: "rate", rate }, "*");
    return;
  }
  universalPlayer.video.playbackRate = rate;
}

function setQuality(index) {
  if (universalPlayer.hls) {
    universalPlayer.hls.currentLevel = index;
  } else if (universalPlayer.isEmbed) {
    universalPlayer.embedFrame.contentWindow?.postMessage({ command: "quality", index }, "*");
  }
  universalPlayer.currentQuality = index;
  universalPlayer.settings.defaultQuality = index === -1 ? "auto" : universalPlayer.qualityLevels[index]?.label || "auto";
  saveSettings();
  updateQualityDisplay();
  universalPlayer.callbacks.onQualityChange?.(index);
}

function setSubtitle(index) {
  if (universalPlayer.hls) {
    universalPlayer.hls.currentTrack = index;
  } else if (universalPlayer.isEmbed) {
    universalPlayer.embedFrame.contentWindow?.postMessage({ command: "subtitle", index }, "*");
  }
  universalPlayer.currentSubtitle = index;
  universalPlayer.settings.defaultSubtitle = index === -1 ? "off" : universalPlayer.subtitles[index]?.label || "off";
  saveSettings();
  updateSubtitleDisplay();
  universalPlayer.callbacks.onSubtitleChange?.(index);
}

function togglePiP() {
  if (universalPlayer.isEmbed) return;
  if (universalPlayer.isPiP) {
    document.exitPictureInPicture().catch(() => {});
  } else {
    universalPlayer.video.requestPictureInPicture().catch(() => {});
  }
}

function toggleFullscreen() {
  const stage = universalPlayer.container.querySelector("#upStage");
  if (universalPlayer.isFullscreen) {
    document.exitFullscreen().catch(() => {});
  } else {
    stage.requestFullscreen().catch(() => {});
  }
}

function onLoadedMetadata() {
  universalPlayer.duration = universalPlayer.video.duration;
  updateTimeDisplay();
  document.getElementById("upSeek").max = 1000;
}

function onDurationChange() {
  universalPlayer.duration = universalPlayer.video.duration;
  updateTimeDisplay();
}

function onTimeUpdate() {
  if (!universalPlayer.duration) return;
  const v = universalPlayer.video;
  const seek = document.getElementById("upSeek");
  if (!seek.dataset.dragging) {
    seek.value = (v.currentTime / universalPlayer.duration) * 1000;
  }
  updateTimeDisplay();
  universalPlayer.callbacks.onTimeUpdate?.(v.currentTime, universalPlayer.duration);
  
  if (Date.now() - universalPlayer.lastProgressSave > 5000) {
    saveProgress();
  }
}

function onPlaying() {
  universalPlayer.playbackStarted = true;
  document.getElementById("upPlayPause").textContent = "⏸";
  hideOverlay();
  startProgressTracking();
}

function onPause() {
  document.getElementById("upPlayPause").textContent = "▶";
  saveProgress();
}

function onEnded() {
  document.getElementById("upPlayPause").textContent = "▶";
  saveProgress(true);
  universalPlayer.callbacks.onPlaybackEnd?.();
  if (universalPlayer.settings.nextEpisodeAuto) {
    setTimeout(() => universalPlayer.callbacks.onNextEpisode?.(), 3000);
  }
}

function onWaiting() {
  showOverlay("Buffering...", false);
}

function onCanPlay() {
  hideOverlay();
}

function onRateChange() {
  document.getElementById("upSpeed").value = universalPlayer.video.playbackRate;
}

function onVolumeChange() {
  universalPlayer.settings.volume = universalPlayer.video.volume;
  saveSettings();
  updateMuteButton();
  document.getElementById("upVolume").value = universalPlayer.video.volume;
}

function onVideoError(e) {
  console.error("[universal-player] Video error:", universalPlayer.video.error);
  showOverlay("Playback error: " + (universalPlayer.video.error?.message || "Unknown"));
  universalPlayer.callbacks.onError?.(universalPlayer.video.error);
}

function onFullscreenChange() {
  universalPlayer.isFullscreen = !!document.fullscreenElement;
  document.getElementById("upFullscreen").textContent = universalPlayer.isFullscreen ? "⛶" : "⛶";
  universalPlayer.callbacks.onFullscreenChange?.(universalPlayer.isFullscreen);
}

function onKeyDown(e) {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  if (e.target.closest("#upControls")) return;
  
  const v = universalPlayer.video;
  switch (e.key) {
    case " ": e.preventDefault(); togglePlay(); break;
    case "ArrowLeft": e.preventDefault(); seekRelative(e.shiftKey ? -60 : -10); break;
    case "ArrowRight": e.preventDefault(); seekRelative(e.shiftKey ? 60 : 10); break;
    case "ArrowUp": e.preventDefault(); setVolume(Math.min(1, v.volume + 0.1)); break;
    case "ArrowDown": e.preventDefault(); setVolume(Math.max(0, v.volume - 0.1)); break;
    case "m": toggleMute(); break;
    case "f": toggleFullscreen(); break;
    case "p": if (e.altKey) togglePiP(); break;
    case "n": if (e.shiftKey) universalPlayer.callbacks.onNextEpisode?.(); break;
    case "b": if (e.shiftKey) universalPlayer.callbacks.onPrevEpisode?.(); break;
    case ">": case ".": setPlaybackRate(Math.min(2, universalPlayer.playbackRate + 0.25)); break;
    case "<": case ",": setPlaybackRate(Math.max(0.5, universalPlayer.playbackRate - 0.25)); break;
    case "0": v.currentTime = 0; break;
    case "1": case "2": case "3": case "4": case "5": case "6": case "7": case "8": case "9":
      v.currentTime = (parseInt(e.key) / 10) * universalPlayer.duration; break;
  }
}

function startProgressTracking() {
  clearProgressTimer();
  universalPlayer.progressTimer = setInterval(saveProgress, 5000);
}

function clearProgressTimer() {
  if (universalPlayer.progressTimer) clearInterval(universalPlayer.progressTimer);
  universalPlayer.progressTimer = null;
}

function saveProgress(final = false) {
  if (!universalPlayer.currentMedia) return;
  const v = universalPlayer.video;
  const currentTime = v.currentTime || 0;
  const duration = universalPlayer.duration || v.duration || 0;
  
  if (!final && (currentTime < 5 || currentTime > duration - 30)) return;
  
  universalPlayer.lastProgressSave = Date.now();
  const key = universalPlayer.currentMedia.type + ":" + universalPlayer.currentMedia.id;
  const watching = JSON.parse(localStorage.getItem("fh_watching") || "{}");
  watching[key] = {
    id: universalPlayer.currentMedia.id,
    type: universalPlayer.currentMedia.type,
    title: universalPlayer.currentMedia.title,
    poster: universalPlayer.currentMedia.poster,
    rating: universalPlayer.currentMedia.rating,
    season: universalPlayer.currentMedia.season,
    episode: universalPlayer.currentMedia.episode,
    progress: duration > 0 ? (currentTime / duration) * 100 : 0,
    currentTime,
    duration,
    updated: Date.now(),
    source: universalPlayer.currentSource?.key,
  };
  localStorage.setItem("fh_watching", JSON.stringify(watching));
}

function reportProgress(currentTime, duration) {
  if (universalPlayer.isEmbed) {
    universalPlayer.duration = duration;
    universalPlayer.video.currentTime = currentTime;
    updateTimeDisplay();
  }
}

function populateQualityMenu() {
  const sel = document.getElementById("upQuality");
  const levels = universalPlayer.qualityLevels;
  sel.innerHTML = '<option value="-1">Auto</option>' + 
    levels.map((l, i) => `<option value="${i}">${l.label || `Level ${i+1}`}</option>`).join("");
  if (universalPlayer.settings.defaultQuality !== "auto") {
    const idx = levels.findIndex(l => l.label === universalPlayer.settings.defaultQuality);
    if (idx >= 0) { sel.value = idx; universalPlayer.currentQuality = idx; }
  }
}

function populateSubtitleMenu() {
  const sel = document.getElementById("upSubtitle");
  if (!sel) return;
  const tracks = universalPlayer.subtitles.length ? universalPlayer.subtitles : 
                 (universalPlayer.hls?.subtitleTracks || []);
  // Sanitize track labels to avoid weird characters in the dropdown
  const sanitize = (s) => String(s).replace(/[^\u0020-\u007E\u00A0-\uFFFF]/g, '').trim() || `Track`;
  sel.innerHTML = '<option value="-1">Off</option>' + 
    tracks.map((t, i) => `<option value="${i}">${sanitize(t.label || t.name || `Track ${i+1}`)}</option>`).join("");
  if (universalPlayer.settings.defaultSubtitle !== "off") {
    const idx = tracks.findIndex(t => t.label === universalPlayer.settings.defaultSubtitle);
    if (idx >= 0) { sel.value = idx; universalPlayer.currentSubtitle = idx; }
  }
}

function updateQualityDisplay() {
  const sel = document.getElementById("upQuality");
  if (universalPlayer.hls) sel.value = universalPlayer.hls.currentLevel;
}

function updateSubtitleDisplay() {
  const sel = document.getElementById("upSubtitle");
  if (universalPlayer.hls) sel.value = universalPlayer.hls.currentTrack;
}

function updateMuteButton() {
  document.getElementById("upMute").textContent = universalPlayer.video.muted || universalPlayer.video.volume === 0 ? "🔇" : "🔊";
}

function updateTimeDisplay() {
  const v = universalPlayer.video;
  document.getElementById("upCurrentTime").textContent = formatTime(v.currentTime);
  document.getElementById("upDuration").textContent = formatTime(universalPlayer.duration);
}

function formatTime(s) {
  if (!isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}

function showOverlay(text, showSpinner = true) {
  const overlay = document.getElementById("upOverlay");
  const textEl = document.getElementById("upOverlayText");
  const progressEl = document.getElementById("upOverlayProgress");
  textEl.textContent = text;
  overlay.classList.remove("hidden");
  progressEl.classList.toggle("hidden", !showSpinner);
}

function hideOverlay() {
  document.getElementById("upOverlay").classList.add("hidden");
}

function updateSourceIndicator(name, status) {
  const ind = document.getElementById("upSourceIndicator");
  const nameEl = document.getElementById("upSourceName");
  const statusEl = document.getElementById("upSourceStatus");
  nameEl.textContent = name;
  statusEl.textContent = status;
  ind.classList.remove("hidden");
}

// Keep the object returned by initUniversalPlayer useful to integration code
// as well as the global functions used by the legacy wrappers.
universalPlayer.loadSource = loadSource;
universalPlayer.updateSourceIndicator = updateSourceIndicator;

window.destroyPlayer = function destroyPlayer() {
  clearProgressTimer();
  clearTimeout(controlsHideTimer);
  controlsHideTimer = null;
  if (universalPlayer.hls) {
    try { universalPlayer.hls.destroy(); } catch {}
    universalPlayer.hls = null;
  }
  // Navigation can call cleanup before the player has been initialized (for
  // example the first switch to Home, or while the profile picker is closing).
  // Cleanup must be idempotent; otherwise the null dereference aborts the
  // navigation handler and makes every subsequent button appear dead.
  if (universalPlayer.video) {
    universalPlayer.video.src = "";
    universalPlayer.video.load();
  }
  if (universalPlayer.embedFrame) universalPlayer.embedFrame.src = "";
  universalPlayer.currentSource = null;
  universalPlayer.currentMedia = null;
  const overlay = document.getElementById("upOverlay");
  const controls = document.getElementById("upControls");
  const indicator = document.getElementById("upSourceIndicator");
  if (overlay) overlay.classList.add("hidden");
  if (controls) controls.classList.add("hidden");
  if (indicator) indicator.classList.add("hidden");
};

window.getPlayerState = function getPlayerState() {
  return {
    currentTime: universalPlayer.video.currentTime,
    duration: universalPlayer.duration,
    paused: universalPlayer.video.paused,
    volume: universalPlayer.video.volume,
    playbackRate: universalPlayer.playbackRate,
    quality: universalPlayer.currentQuality,
    subtitle: universalPlayer.currentSubtitle,
    isEmbed: universalPlayer.isEmbed,
    source: universalPlayer.currentSource,
  };
};

window.setSetting = function setSetting(key, value) {
  universalPlayer.settings[key] = value;
  saveSettings();
};

window.universalPlayer = universalPlayer;
window.loadSource = loadSource;
