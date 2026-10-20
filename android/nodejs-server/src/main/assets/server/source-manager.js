/* ===== Source Manager: prioritizes, tracks health, and handles automatic failover =====
   Works with scraper.js registry and provides a unified interface for the player. */

const SOURCE_MANAGER_CONFIG = {
  playbackTimeout: 12000,
  preloadCount: 3,
  weights: {
    successRate: 0.5,
    recency: 0.2,
    speed: 0.2,
    userPreference: 0.1,
  },
  minHealthScore: 0.3,
};

let sourceManager = {
  currentSources: [],
  currentIndex: 0,
  playbackTimer: null,
  playbackStarted: false,
  activeMedia: null,
  callbacks: {
    onSourceChange: null,
    onFailover: null,
    onError: null,
    onPlaybackStart: null,
  },
  userPreferences: {},
  loadTimes: {},

  // These are also exposed as globals (window.failover, window.reportPlaybackStarted).
  // Keep them as real methods on the manager too, so both
  // `sourceManager.failover()` and `window.failover()` work — the app code
  // calls them as methods, and a missing method used to throw a TypeError
  // that aborted playback right after the stream had already started.
  reportPlaybackStarted() {
    sourceManager.playbackStarted = true;
    clearTimeout(sourceManager.playbackTimer);
    if (sourceManager.callbacks.onPlaybackStart) {
      sourceManager.callbacks.onPlaybackStart(getCurrentSource());
    }
  },

  async failover(reason = "Playback failed") {
    const oldSource = getCurrentSource();
    sourceManager.currentIndex++;
    console.log(`[source-manager] Failing over from ${oldSource?.api?.name} to next source (reason: ${reason})`);

    if (sourceManager.currentIndex >= sourceManager.currentSources.length) {
      console.log("[source-manager] No more sources to try");
      if (sourceManager.callbacks.onError) {
        sourceManager.callbacks.onError("All sources exhausted");
      }
      return null;
    }

    const newSource = getCurrentSource();
    if (sourceManager.callbacks.onSourceChange) {
      sourceManager.callbacks.onSourceChange(newSource, oldSource);
    }
    return newSource;
  },
};

// NOTE: keep this implementation under a name that is NOT re-exported to
// window. A top-level `function initSourceManager` shares the global binding
// with `window.initSourceManager`, so a wrapper that called `initSourceManager`
// would call itself forever (RangeError: Maximum call stack size exceeded)
// and abort the whole app-init chain — leaving the player container empty
// (black screen).
function createSourceManager(registry, callbacks = {}) {
  sourceManager.callbacks = { ...sourceManager.callbacks, ...callbacks };
  sourceManager.userPreferences = JSON.parse(localStorage.getItem("fh_source_prefs") || "{}");
  sourceManager.loadTimes = JSON.parse(localStorage.getItem("fh_source_loadtimes") || "{}");
  rebuildSourceList(registry);
  return sourceManager;
}

function rebuildSourceList(registry) {
  if (!registry?.embedAPIs) {
    sourceManager.currentSources = [];
    return;
  }

  const media = sourceManager.activeMedia;
  if (!media) return;

  const candidates = [];
  for (const [key, api] of Object.entries(registry.embedAPIs)) {
    const health = registry.health[key] || {};
    const score = calculateHealthScore(key, api, health, media);
    if (score >= SOURCE_MANAGER_CONFIG.minHealthScore) {
      candidates.push({
        key,
        api,
        health,
        score,
        url: generateUrl(api, media),
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const prefKey = `${media.type}:${media.id}`;
    const userPref = sourceManager.userPreferences[prefKey];
    if (userPref === a.key) return -1;
    if (userPref === b.key) return 1;
    return 0;
  });

  sourceManager.currentSources = candidates;
  sourceManager.currentIndex = 0;
  console.log("[source-manager] Rebuilt source list:", candidates.map(c => `${c.api.name} (${(c.score*100).toFixed(0)}%)`));
}

function calculateHealthScore(key, api, health, media) {
  const w = SOURCE_MANAGER_CONFIG.weights;
  let score = 0;

  score += w.successRate * (health.successRate || 0.5);

  if (health.lastChecked) {
    const hoursSinceCheck = (Date.now() - health.lastChecked) / (1000 * 60 * 60);
    const recencyScore = Math.exp(-hoursSinceCheck / 168);
    score += w.recency * recencyScore;
  } else {
    score += w.recency * 0.5;
  }

  const loadTime = sourceManager.loadTimes[key];
  if (loadTime) {
    const speedScore = Math.max(0.1, Math.min(1, 2000 / loadTime));
    score += w.speed * speedScore;
  } else {
    score += w.speed * 0.5;
  }

  const prefKey = `${media.type}:${media.id}`;
  if (sourceManager.userPreferences[prefKey] === key) {
    score += w.userPreference;
  }

  if (api.native) score += 0.15;
  if (api.tracks) score += 0.1;
  if (media.isAnime && api.animeOnly) score += 0.2;

  return Math.min(1, score);
}

function generateUrl(api, media) {
  if (media.type === "movie") {
    if (api.movieUrl) return eval("(" + api.movieUrl + ")")(media.id);
  } else if (media.type === "tv") {
    if (media.isAnime && api.animeUrl) return eval("(" + api.animeUrl + ")")(media);
    if (api.tvUrl) return eval("(" + api.tvUrl + ")")(media.id, media.season, media.episode);
  }
  return null;
}

window.initSourceManager = createSourceManager;

window.setActiveMedia = function setActiveMedia(media, registry) {
  sourceManager.activeMedia = media;
  sourceManager.currentIndex = 0;
  sourceManager.playbackStarted = false;
  clearTimeout(sourceManager.playbackTimer);
  rebuildSourceList(registry);
  return getCurrentSource();
};

function getCurrentSource() {
  if (sourceManager.currentIndex >= sourceManager.currentSources.length) return null;
  return sourceManager.currentSources[sourceManager.currentIndex];
}

window.getAllSources = function getAllSources() {
  return [...sourceManager.currentSources];
};

window.getCurrentIndex = function getCurrentIndex() {
  return sourceManager.currentIndex;
};

window.startPlaybackMonitor = function startPlaybackMonitor() {
  sourceManager.playbackStarted = false;
  clearTimeout(sourceManager.playbackTimer);
  sourceManager.playbackTimer = setTimeout(() => {
    if (!sourceManager.playbackStarted && sourceManager.callbacks.onFailover) {
      console.log("[source-manager] Playback timeout, failing over...");
      sourceManager.callbacks.onFailover();
    }
  }, SOURCE_MANAGER_CONFIG.playbackTimeout);
};

window.reportPlaybackStarted = function reportPlaybackStarted() {
  sourceManager.reportPlaybackStarted();
};

window.reportLoadTime = function reportLoadTime(sourceKey, loadTimeMs) {
  sourceManager.loadTimes[sourceKey] = loadTimeMs;
  try {
    localStorage.setItem("fh_source_loadtimes", JSON.stringify(sourceManager.loadTimes));
  } catch {}
};

window.failover = async function failover(reason = "Playback failed") {
  return sourceManager.failover(reason);
};

window.selectSource = function selectSource(index) {
  if (index >= 0 && index < sourceManager.currentSources.length) {
    const oldSource = getCurrentSource();
    sourceManager.currentIndex = index;
    const newSource = getCurrentSource();
    if (sourceManager.activeMedia) {
      const prefKey = `${sourceManager.activeMedia.type}:${sourceManager.activeMedia.id}`;
      sourceManager.userPreferences[prefKey] = newSource.key;
      try {
        localStorage.setItem("fh_source_prefs", JSON.stringify(sourceManager.userPreferences));
      } catch {}
    }
    if (sourceManager.callbacks.onSourceChange) {
      sourceManager.callbacks.onSourceChange(newSource, oldSource);
    }
    return newSource;
  }
  return getCurrentSource();
};

window.reportSourceResult = function reportSourceResult(sourceKey, success, details = {}) {
  window.dispatchEvent(new CustomEvent("fh:source-result", {
    detail: { sourceKey, success, details, timestamp: Date.now() }
  }));
};

window.preloadNextSources = function preloadNextSources() {
  const sources = sourceManager.currentSources.slice(sourceManager.currentIndex + 1, 
    sourceManager.currentIndex + 1 + SOURCE_MANAGER_CONFIG.preloadCount);
  for (const s of sources) {
    if (s.url) {
      fetch(`/__proxy?url=${encodeURIComponent(s.url)}`, { priority: "low" }).catch(() => {});
    }
  }
};

window.getSourceDisplayInfo = function getSourceDisplayInfo() {
  return sourceManager.currentSources.map((s, i) => ({
    index: i,
    name: s.api.name,
    key: s.key,
    score: (s.score * 100).toFixed(0) + "%",
    active: i === sourceManager.currentIndex,
    health: s.health.successRate ? (s.health.successRate * 100).toFixed(0) + "%" : "N/A",
    hasMovie: !!s.api.movieUrl,
    hasTV: !!s.api.tvUrl,
    hasAnime: !!s.api.animeUrl,
    native: s.api.native || false,
    tracks: s.api.tracks || false,
    url: s.url,
  }));
};

window.SOURCE_MANAGER_CONFIG = SOURCE_MANAGER_CONFIG;
