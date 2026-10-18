/* ===== Auto-scraper: discovers and validates streaming sources from FMHY + custom lists =====
   Runs in renderer. Periodically scrapes known site directories, extracts embed URLs,
   validates them against TMDB IDs, and feeds the SourceManager. */

const SCRAPER_CONFIG = {
  scanInterval: 6 * 60 * 60 * 1000,
  checkTimeout: 8000,
  maxConcurrent: 6,
  minSuccessRate: 0.3,
  knownEmbedAPIs: [
    {
      name: "VidSrc",
      movie: (id) => `https://vidsrc.me/embed/movie/${id}`,
      tv: (id, s, e) => `https://vidsrc.me/embed/tv/${id}/${s}/${e}`,
      checkSelector: "video, iframe[src*='m3u8'], .jwplayer",
    },
    {
      name: "VidSrc.to",
      movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
      tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "2Embed",
      movie: (id) => `https://www.2embed.to/embed/movie/${id}`,
      tv: (id, s, e) => `https://www.2embed.to/embed/tv/${id}/${s}/${e}`,
      checkSelector: "video, iframe",
    },
    {
      name: "MultiEmbed",
      movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
      tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
      checkSelector: "video, iframe",
    },
    {
      name: "SuperEmbed",
      movie: (id) => `https://superembed.stream/embed/movie/${id}`,
      tv: (id, s, e) => `https://superembed.stream/embed/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "GoMo",
      movie: (id) => `https://gomo.to/movie/${id}`,
      tv: (id, s, e) => `https://gomo.to/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "DBGO",
      movie: (id) => `https://dbgo.fun/play/movie/${id}`,
      tv: (id, s, e) => `https://dbgo.fun/play/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "ApiMDB",
      movie: (id) => `https://apimdb.net/movie/${id}`,
      tv: (id, s, e) => `https://apimdb.net/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "FSAPI",
      movie: (id) => `https://fsapi.xyz/movie/${id}`,
      tv: (id, s, e) => `https://fsapi.xyz/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "AutoEmbed",
      movie: (id) => `https://autoembed.co/movie/tmdb/${id}`,
      tv: (id, s, e) => `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`,
      checkSelector: "video, iframe",
    },
    {
      name: "AnyEmbed",
      movie: (id) => `https://anyembed.xyz/embed/tmdb-movie-${id}`,
      tv: (id, s, e) => `https://anyembed.xyz/embed/tmdb-tv-${id}-${s}-${e}`,
      checkSelector: "video",
    },
    {
      name: "VidLink",
      movie: (id) => `https://vidlink.pro/movie/${id}`,
      tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "VidFast",
      movie: (id) => `https://vidfast.pro/movie/${id}`,
      tv: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}`,
      checkSelector: "video",
    },
    {
      name: "ScreenScape",
      movie: (id) => `https://screenscape.me/embed?tmdb=${id}&type=movie`,
      tv: (id, s, e) => `https://screenscape.me/embed?tmdb=${id}&type=tv&s=${s}&e=${e}&lan=eng`,
      checkSelector: "video",
    },
    {
      name: "RiveStream",
      movie: (id) => `https://rivestream.ru/embed?type=movie&id=${id}`,
      tv: (id, s, e) => `https://rivestream.ru/embed?type=tv&id=${id}&season=${s}&episode=${e}`,
      checkSelector: "video",
    },
  ],
  siteDirectories: [
    "https://fmhy.artistgrid.cx/video",
    "https://raw.githubusercontent.com/FMHYHelper/FMHY/main/VideoPiracyGuide.md",
  ],
  testTitles: [
    { type: "movie", id: 550, title: "Fight Club" },
    { type: "movie", id: 238, title: "The Godfather" },
    { type: "movie", id: 278, title: "The Shawshank Redemption" },
    { type: "tv", id: 1399, title: "Game of Thrones", season: 1, episode: 1 },
    { type: "tv", id: 1402, title: "The Walking Dead", season: 1, episode: 1 },
    { type: "tv", id: 60625, title: "Rick and Morty", season: 1, episode: 1 },
    { type: "tv", id: 9389, title: "Cowboy Bebop", season: 1, episode: 1 },
  ],
};

const REGISTRY_KEY = "fh_source_registry_v2";
let sourceRegistry = null;
let scanInProgress = false;
let scanAbortController = null;

/* ---------- Persistence ---------- */
function loadRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.sources && !parsed.embedAPIs) {
        parsed.embedAPIs = parsed.sources;
        delete parsed.sources;
      }
      sourceRegistry = {
        embedAPIs: parsed.embedAPIs || {},
        discovered: parsed.discovered || {},
        health: parsed.health || {},
        lastScan: parsed.lastScan || 0,
        version: 2,
      };
    }
  } catch (e) {
    console.warn("[scraper] Failed to load registry:", e);
  }
  if (!sourceRegistry) {
    sourceRegistry = { embedAPIs: {}, discovered: {}, health: {}, lastScan: 0, version: 2 };
  }
  for (const api of SCRAPER_CONFIG.knownEmbedAPIs) {
    const key = api.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (!sourceRegistry.embedAPIs[key]) {
      sourceRegistry.embedAPIs[key] = {
        name: api.name,
        type: "embed",
        movieUrl: api.movie.toString(),
        tvUrl: api.tv.toString(),
        animeUrl: api.animeUrl?.toString(),
        checkSelector: api.checkSelector,
        headers: api.headers,
        addedAt: Date.now(),
        source: "builtin",
      };
    }
  }
  saveRegistry();
}

function saveRegistry() {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(sourceRegistry));
  } catch (e) {
    console.warn("[scraper] Failed to save registry:", e);
  }
}

/* ---------- HTML/Markdown parsing helpers ---------- */
function extractUrlsFromHTML(html) {
  const urls = new Set();
  const matches = html.match(/(?:href|src)=["']([^"']+)["']/gi) || [];
  for (const m of matches) {
    const url = m.replace(/^(?:href|src)=["']/i, "").replace(/["']$/, "");
    if (url.startsWith("http")) urls.add(url);
  }
  const bareMatches = html.match(/https?:\/\/[^\s<>"'{}|\\^`\[\]]+/gi) || [];
  for (const m of bareMatches) urls.add(m.replace(/[.,;)]+$/, ""));
  return [...urls];
}

function extractUrlsFromMarkdown(md) {
  const urls = new Set();
  const mdLinks = md.match(/\[[^\]]*\]\(([^)]+)\)/g) || [];
  for (const m of mdLinks) {
    const url = m.match(/\(([^)]+)\)/)[1];
    if (url.startsWith("http")) urls.add(url);
  }
  const bareMatches = md.match(/https?:\/\/[^\s<>"'{}|\\^`\[\]]+/gi) || [];
  for (const m of bareMatches) urls.add(m.replace(/[.,;)]+$/, ""));
  return [...urls];
}

function normalizeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ---------- Scrape site directories ---------- */
async function scrapeDirectories() {
  const discovered = {};
  for (const dirUrl of SCRAPER_CONFIG.siteDirectories) {
    try {
      console.log("[scraper] Scraping directory:", dirUrl);
      const res = await fetch(dirUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const text = await res.text();
      let urls;
      if (dirUrl.endsWith(".md")) {
        urls = extractUrlsFromMarkdown(text);
      } else {
        urls = extractUrlsFromHTML(text);
      }
      console.log(`[scraper] Found ${urls.length} URLs in ${dirUrl}`);
      for (const url of urls) {
        const host = normalizeHostname(url);
        if (!host) continue;
        if (isExcludedHost(host)) continue;
        if (!discovered[host]) {
          discovered[host] = { urls: [], firstSeen: Date.now(), source: dirUrl };
        }
        discovered[host].urls.push(url);
      }
    } catch (e) {
      console.warn("[scraper] Failed to scrape", dirUrl, e.message);
    }
  }
  return discovered;
}

const EXCLUDED_HOSTS = new Set([
  "github.com", "raw.githubusercontent.com", "gitlab.com",
  "reddit.com", "www.reddit.com", "old.reddit.com",
  "discord.com", "discord.gg", "discordapp.com",
  "twitter.com", "x.com", "t.co",
  "youtube.com", "youtu.be", "vimeo.com",
  "google.com", "cse.google.com", "docs.google.com",
  "pastebin.com", "imgur.com", "i.imgur.com",
  "rentry.co", "telegra.ph", "notion.site",
  "cloudflare.com", "cloudflare.net",
  "archive.org", "web.archive.org",
  "wikipedia.org", "wikimedia.org",
  "facebook.com", "instagram.com",
  "telegram.org", "t.me",
  "paypal.com", "patreon.com", "ko-fi.com",
  "buycoffee.to", "buymeacoffee.com",
]);

function isExcludedHost(host) {
  for (const ex of EXCLUDED_HOSTS) {
    if (host === ex || host.endsWith("." + ex)) return true;
  }
  return false;
}

/* ---------- Source validation ---------- */
async function validateEmbedAPI(apiKey, api) {
  const results = { movie: false, tv: false, anime: false, errors: [] };
  const testMovie = SCRAPER_CONFIG.testTitles.find(t => t.type === "movie");
  const testTV = SCRAPER_CONFIG.testTitles.find(t => t.type === "tv");
  const testAnime = SCRAPER_CONFIG.testTitles.find(t => t.type === "tv" && t.title.includes("Cowboy"));

  async function testUrl(url, selector) {
    try {
      const res = await fetch(`/__proxy?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(SCRAPER_CONFIG.checkTimeout),
      });
      if (!res.ok) return false;
      const html = await res.text();
      const hasVideo = html.includes("<video") ||
                       html.includes("m3u8") ||
                       html.includes(".mpd") ||
                       html.includes("jwplayer") ||
                       html.includes("clappr") ||
                       html.includes("hls.js") ||
                       html.includes("videojs") ||
                       (selector && new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(html));
      return hasVideo;
    } catch (e) {
      return false;
    }
  }

  if (api.movieUrl && testMovie) {
    try {
      const url = eval("(" + api.movieUrl + ")")(testMovie.id);
      results.movie = await testUrl(url, api.checkSelector);
    } catch (e) { results.errors.push("movie: " + e.message); }
  }
  if (api.tvUrl && testTV) {
    try {
      const url = eval("(" + api.tvUrl + ")")(testTV.id, testTV.season || 1, testTV.episode || 1);
      results.tv = await testUrl(url, api.checkSelector);
    } catch (e) { results.errors.push("tv: " + e.message); }
  }
  if (api.animeUrl && testAnime) {
    try {
      const url = eval("(" + api.animeUrl + ")")(testAnime.id, testAnime.season || 1, testAnime.episode || 1);
      results.anime = await testUrl(url, api.checkSelector);
    } catch (e) { results.errors.push("anime: " + e.message); }
  }
  return results;
}

/* ---------- Scrape discovered sites for embed patterns ---------- */
async function analyzeDiscoveredHost(host, info) {
  const patterns = [
    "/embed/movie/{id}",
    "/embed/tv/{id}/{s}/{e}",
    "/movie/{id}",
    "/tv/{id}/{s}/{e}",
    "/play/movie/{id}",
    "/play/tv/{id}/{s}/{e}",
    "/watch/{id}",
    "/player/movie/{id}",
    "/player/tv/{id}/{s}/{e}",
    "/?v={id}",
    "/embed?tmdb={id}",
    "/embed?type=movie&id={id}",
    "/embed?type=tv&id={id}&season={s}&episode={e}",
  ];
  return {
    host,
    potential: true,
    patterns,
    urls: info.urls,
    discoveredAt: info.firstSeen,
  };
}

/* ---------- Main scan routine ---------- */
async function runFullScan() {
  if (scanInProgress) return;
  scanInProgress = true;
  scanAbortController = new AbortController();
  console.log("[scraper] Starting full source scan...");

  try {
    const discovered = await scrapeDirectories();
    console.log("[scraper] Discovered hosts:", Object.keys(discovered).length);

    for (const [host, info] of Object.entries(discovered)) {
      if (!sourceRegistry.discovered[host]) {
        const analysis = await analyzeDiscoveredHost(host, info);
        sourceRegistry.discovered[host] = analysis;
      }
    }

    console.log("[scraper] Validating", Object.keys(sourceRegistry.embedAPIs).length, "embed APIs...");
    for (const [key, api] of Object.entries(sourceRegistry.embedAPIs)) {
      if (scanAbortController.signal.aborted) break;
      const health = await validateEmbedAPI(key, api);
      const successCount = [health.movie, health.tv, health.anime].filter(Boolean).length;
      const totalTests = [health.movie, health.tv, health.anime].filter(x => x !== undefined).length;
      sourceRegistry.health[key] = {
        ...health,
        successRate: totalTests > 0 ? successCount / totalTests : 0,
        lastChecked: Date.now(),
        consecutiveFailures: health.movie || health.tv || health.anime ? 0 : (sourceRegistry.health[key]?.consecutiveFailures || 0) + 1,
      };
      console.log(`[scraper] ${api.name}: movie=${health.movie} tv=${health.tv} anime=${health.anime} rate=${(sourceRegistry.health[key].successRate*100).toFixed(0)}%`);
    }

    for (const [key, health] of Object.entries(sourceRegistry.health)) {
      if (health.consecutiveFailures >= 3 && health.successRate < SCRAPER_CONFIG.minSuccessRate) {
        console.log("[scraper] Removing consistently failing source:", key);
        delete sourceRegistry.embedAPIs[key];
        delete sourceRegistry.health[key];
      }
    }

    sourceRegistry.lastScan = Date.now();
    saveRegistry();
    console.log("[scraper] Scan complete. Active sources:", Object.keys(sourceRegistry.embedAPIs).length);
    broadcastRegistryUpdate();
  } catch (e) {
    console.error("[scraper] Scan failed:", e);
  } finally {
    scanInProgress = false;
    scanAbortController = null;
  }
}

function broadcastRegistryUpdate() {
  window.dispatchEvent(new CustomEvent("fh:sources-updated", {
    detail: { embedAPIs: sourceRegistry.embedAPIs, health: sourceRegistry.health }
  }));
}

/* ---------- Public API ---------- */
window.initScraper = function initScraper() {
  loadRegistry();
  if (!sourceRegistry.lastScan || Date.now() - sourceRegistry.lastScan > SCRAPER_CONFIG.scanInterval) {
    setTimeout(runFullScan, 5000);
  }
  setInterval(runFullScan, SCRAPER_CONFIG.scanInterval);
  return {
    getRegistry: () => sourceRegistry,
    runScan: runFullScan,
    addCustomSource: addCustomSource,
    removeSource: removeSource,
  };
};

function addCustomSource(name, config) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
  sourceRegistry.embedAPIs[key] = {
    name,
    type: "embed",
    movieUrl: config.movieUrl,
    tvUrl: config.tvUrl,
    animeUrl: config.animeUrl,
    checkSelector: config.checkSelector,
    headers: config.headers,
    addedAt: Date.now(),
    source: "custom",
  };
  saveRegistry();
  broadcastRegistryUpdate();
}

function removeSource(key) {
  delete sourceRegistry.embedAPIs[key];
  delete sourceRegistry.health[key];
  saveRegistry();
  broadcastRegistryUpdate();
}

window.testSource = async function testSource(sourceKey, type, id, season, episode) {
  const api = sourceRegistry.embedAPIs[sourceKey];
  if (!api) return { ok: false, error: "Source not found" };
  try {
    let url;
    if (type === "movie") url = eval("(" + api.movieUrl + ")")(id);
    else if (type === "tv") url = eval("(" + api.tvUrl + ")")(id, season, episode);
    else return { ok: false, error: "Invalid type" };
    const res = await fetch(`/__proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const hasVideo = html.includes("<video") || html.includes("m3u8") || html.includes("iframe");
    return { ok: hasVideo, url, html: hasVideo ? html.slice(0, 500) : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

window.SCRAPER_CONFIG = SCRAPER_CONFIG;
