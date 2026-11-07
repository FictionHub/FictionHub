/**
 * FictionHub — fully local server (replaces the Cloudflare Workers).
 *
 * Serves the site AND proxies the manga sources, all on http://localhost:8787.
 * It binds to 127.0.0.1 only, so NOTHING is exposed to the internet — this runs
 * entirely on your machine.
 *
 * Requires Node.js 18+ (for built-in fetch). Get it from https://nodejs.org
 *
 * Run:   node server.js
 * Then open:  http://localhost:8787
 * Keep the window open while you use the site.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Config can arrive through process.env (Electron / plain node) OR through
// Java system properties (Android's nodejs-mobile bridge only sets the latter),
// so read both. A missing FH_DATA_DIR on Android sent the localStorage backup
// into the app's private files dir with the wrong lifetime.
const javaProp = (name) => {
  try {
    return typeof System !== "undefined" && System.getProperty ? System.getProperty(name) : null;
  } catch {
    return null;
  }
};
const config = (name, fallback) => process.env[name] || javaProp(name) || fallback;

const PORT = Number(config("FH_PORT", 8787)) || 8787;
const DIR = __dirname;
// Writable, update-safe location for the localStorage backup. In the packaged
// Electron app, __dirname lives inside app.asar (read-only, and replaced on
// every auto-update) — electron-main.js points this at userData instead, so
// Continue Watching/Reading survives reinstalls.
const DATA_DIR = config("FH_DATA_DIR", DIR);
const BACKUP_FILE = path.join(DATA_DIR, "fh-backup.json");
// Downloaded manga chapters go under Documents, not the app/userData folder,
// so they're easy to find, back up, or move in a normal file browser.
const MANGA_DIR = config("FH_MANGA_DIR", path.join(os.homedir(), "Documents", "FictionHub", "Manga Downloads"));
// Downloaded movies, series and anime go alongside the manga library, so the
// whole offline library lives in one easy-to-back-up place.
const VIDEO_DIR = config("FH_VIDEO_DIR", path.join(os.homedir(), "Documents", "FictionHub", "Video Downloads"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// only these hosts may be proxied (so it can't be misused as an open proxy)
const ALLOW = /(^|\.)(mangadex\.org|mangadex\.network|weebcentral\.com|planeptune\.us|compsci88\.com|comick\.live|comick\.fun|comick\.io|comicknew\.pictures|comick\.pictures|mangakatana\.com|mkklcdnv6tempv5\.com|mkklcdnv3\.com|mkklcdnv5\.com|streamfree\.app|extendsclass\.com)$/i;

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".ts": "video/mp2t", ".m3u8": "application/vnd.apple.mpegurl", ".mp4": "video/mp4",
  ".m4s": "video/mp4", ".m4a": "audio/mp4", ".aac": "audio/aac", ".bin": "application/octet-stream",
};

async function proxy(req, res, target) {
  let dest;
  try { dest = new URL(target); } catch { res.writeHead(400); return res.end("bad url"); }
  if (!ALLOW.test(dest.hostname)) { res.writeHead(403); return res.end("host not allowed"); }

  const headers = { "User-Agent": UA };
  if (/weebcentral\.com$/i.test(dest.hostname)) {
    headers["Referer"] = "https://weebcentral.com/";
    headers["HX-Request"] = "true";
    headers["HX-Current-URL"] = "https://weebcentral.com/";
  }
  if (/(planeptune\.us|compsci88\.com)$/i.test(dest.hostname)) headers["Referer"] = "https://weebcentral.com/";
  if (/comick/i.test(dest.hostname)) headers["Referer"] = "https://comick.live/";
  if (/mangakatana\.com|mkklcdn/i.test(dest.hostname)) headers["Referer"] = "https://mangakatana.com/";

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await new Promise(r => { const d = []; req.on("data", c => d.push(c)); req.on("end", () => r(Buffer.concat(d))); });
    headers["Content-Type"] = req.headers["content-type"] || "application/x-www-form-urlencoded";
  }

  try {
    const up = await fetch(dest.toString(), { method: req.method, headers, body });
    const buf = Buffer.from(await up.arrayBuffer());
    const resHeaders = {
      "Content-Type": up.headers.get("content-type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    };
    // sync-room creation needs the new blob's id, which jsonblob returns
    // as a Location header — forward it through
    const loc = up.headers.get("location");
    if (loc) resHeaders["Location"] = loc;
    res.writeHead(up.status, resHeaders);
    res.end(buf);
  } catch (e) {
    res.writeHead(502); res.end(String(e));
  }
}

// Only allow plain id-like path segments (MangaDex ids are UUIDs) — blocks
// path traversal (".." / "/" / "\") in manga-downloads paths.
function safeId(s) { return typeof s === "string" && /^[A-Za-z0-9_-]+$/.test(s) ? s : null; }

// ---------- Manga series batch download (Netflix-style offline library) ----------
// One background job per manga: pulls the full chapter feed from MangaDex,
// then stores every chapter under MANGA_DIR/<mangaId>/<chapterId>/ the same
// way single-chapter downloads do. Progress is polled by the renderer.
const seriesJobs = {}; // mangaId -> { total, done, skipped, failed, errors[], cancel, running, current }
const videoJobs = {};  // video key -> { total, done, errors[], cancel, running, current, error }
const videoSeasonJobs = {}; // tv-{id}-s{season} -> { total, done, skipped, failed, cancel, running, current, error }

// Fetch an array of page URLs with limited parallelism (MangaDex rate
// limits around 5 req/s; 4 keeps a chapter to a few seconds).
async function fetchPagesParallel(urls, dir, naming) {
  const files = new Array(urls.length);
  let next = 0, ok = true, firstErr = null;
  async function worker() {
    while (ok) {
      const i = next++;
      if (i >= urls.length) return;
      try {
        const up = await fetch(urls[i], { headers: { "User-Agent": UA } });
        if (!up.ok) throw new Error(`page ${i + 1} failed (${up.status})`);
        const ext = path.extname(new URL(urls[i]).pathname).toLowerCase() || ".jpg";
        const fname = naming(i, ext);
        await fs.promises.writeFile(path.join(dir, fname), Buffer.from(await up.arrayBuffer()));
        files[i] = fname;
      } catch (e) {
        ok = false; firstErr = e;
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (!ok) throw firstErr || new Error("page fetch failed");
  return files;
}

async function runSeriesDownload(mangaId, mangaTitle, coverUrl) {
  const job = seriesJobs[mangaId];
  const getJSON = async (url) => {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error("mdx-" + r.status);
    return r.json();
  };
  try {
    // full chapter feed, 500 per page
    let offset = 0, total = Infinity;
    const feed = [];
    while (offset < total && offset < 2000 && !job.cancel) {
      const u = new URL(`https://api.mangadex.org/manga/${mangaId}/feed`);
      [["translatedLanguage[]", "en"], ["order[volume]", "asc"], ["order[chapter]", "asc"],
       ["contentRating[]", "safe"], ["contentRating[]", "suggestive"], ["contentRating[]", "erotica"],
       ["includes[]", "scanlation_group"], ["limit", "500"], ["offset", String(offset)]]
        .forEach(([k, v]) => u.searchParams.append(k, v));
      const data = await getJSON(u.toString());
      total = data.total;
      feed.push(...data.data);
      if (!data.data.length) break;
      offset += 500;
    }
    // one chapter per number (first group wins), skip external-url chapters
    const seen = new Set();
    const list = [];
    for (const c of feed) {
      if (!c.attributes.pages && c.attributes.externalUrl) continue;
      const key = c.attributes.chapter ?? "oneshot:" + c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(c);
    }
    job.total = list.length;

    // keep the series cover on disk so the offline library looks right
    const dir0 = path.join(MANGA_DIR, mangaId);
    await fs.promises.mkdir(dir0, { recursive: true });
    const coverFile = path.join(dir0, "cover.jpg");
    if (coverUrl && !fs.existsSync(coverFile)) {
      try {
        const cr = await fetch(mdxUploadsUrl(coverUrl), { headers: { "User-Agent": UA } });
        if (cr.ok) await fs.promises.writeFile(coverFile, Buffer.from(await cr.arrayBuffer()));
      } catch { /* cover is cosmetic */ }
    }

    for (const c of list) {
      if (job.cancel) break;
      const chId = c.id;
      if (fs.existsSync(path.join(MANGA_DIR, mangaId, chId, "meta.json"))) {
        job.skipped++; job.done++; continue;
      }
      job.current = c.attributes.chapter || "oneshot";
      try {
        const at = await getJSON(`https://api.mangadex.org/at-home/server/${chId}`);
        const urls = at.chapter.data.map(f => mdxUploadsUrl(`${at.baseUrl}/data/${at.chapter.hash}/${f}`));
        const dir = path.join(MANGA_DIR, mangaId, chId);
        await fs.promises.mkdir(dir, { recursive: true });
        const files = await fetchPagesParallel(urls, dir, (i, ext) => String(i).padStart(3, "0") + ext);
        const g = (c.relationships || []).find(r => r.type === "scanlation_group");
        const meta = {
          mangaTitle,
          number: c.attributes.chapter || null,
          title: c.attributes.title || "",
          group: (g && g.attributes && g.attributes.name) || "Unknown",
          pageCount: files.length, files, downloadedAt: Date.now(),
        };
        await fs.promises.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
        job.done++;
      } catch (e) {
        job.failed++;
        job.errors.push(`ch. ${c.attributes.chapter || "oneshot"}: ${e.message}`);
        await fs.promises.rm(path.join(MANGA_DIR, mangaId, chId), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch (e) {
    job.error = String(e.message || e);
  } finally {
    job.running = false;
    job.current = null;
  }
}

/* ---------- Video downloads (movies / series / anime) ---------- */
// Resolves the title's HLS stream through the same Native pipeline the player
// uses, then stores the playlist, every segment and any AES-128 key on disk.
// The rewritten playlist points at __video/seg/... and __video/key/... so the
// in-app hls.js player can play the whole thing offline with no upstream.
function videoKey(type, id, season, episode) {
  return type === "tv" ? `tv-${id}-s${season}-e${episode}` : `movie-${id}`;
}
function videoSeasonKey(id, season) { return `tv-${id}-s${season}`; }

function videoComplete(key) {
  const dir = path.join(VIDEO_DIR, key);
  return fs.existsSync(path.join(dir, "meta.json")) && fs.existsSync(path.join(dir, "index.m3u8"));
}

// The /__stream/m3u8 proxy rewrites every URI to /__stream/m3u8?u=… or
// /__stream/seg?u=…. Peel that back so we can fetch the real upstream URL
// (still through the proxy) and write a local playlist that points at disk.
function unwrapProxyUri(uri) {
  if (!uri) return uri;
  try {
    const abs = /^https?:\/\//i.test(uri) ? new URL(uri) : new URL(uri, "http://localhost");
    if (abs.pathname.startsWith("/__stream/")) {
      const real = abs.searchParams.get("u");
      if (real) return real;
    }
  } catch {}
  return uri;
}

function resolveStreamUri(uri, playlistBase) {
  const real = unwrapProxyUri(uri);
  try { return new URL(real, playlistBase).toString(); } catch { return real; }
}

function pickBestVariant(playlist) {
  const lines = playlist.split("\n").map(l => l.replace(/\r$/, ""));
  let best = null, bestBw = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const bw = parseInt((lines[i].match(/BANDWIDTH=(\d+)/) || [])[1], 10) || 0;
    const next = (lines[i + 1] || "").trim();
    if (next && !next.startsWith("#") && bw >= bestBw) { bestBw = bw; best = next; }
  }
  return best;
}

// Fetch a playlist through the local /__stream proxy (it applies the headers
// the upstream needs — header profile `h` — and rewrites URIs back here).
async function fetchStreamPlaylist(m3u8Url, h) {
  const res = await fetch(`http://localhost:${PORT}/__stream/m3u8?u=${encodeURIComponent(m3u8Url)}&h=${h}`);
  if (!res.ok) throw new Error("playlist " + res.status);
  return res.text();
}

// Fetch arbitrary stream bytes (segment or AES-128 key) through the proxy.
// Retries rate limits (429) and server hiccups with backoff — stream CDNs
// throttle a fast offline download long before it finishes.
async function fetchStreamBytes(url, h) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(`http://localhost:${PORT}/__stream/seg?u=${encodeURIComponent(url)}&h=${h}`);
    } catch (e) {
      lastErr = e; // network error: retry
    }
    if (res) {
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastErr = new Error("stream " + res.status);
      if (res.status !== 429 && res.status < 500) throw lastErr; // permanent
    }
    await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500));
  }
  throw lastErr;
}

function extFromUrl(url, fallback) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    // CDNs disguise media segments as web files; keep the media fallback.
    if (/^\.(html?|png|jpe?g|gif|webp|js|css|txt|ico|svg)$/.test(ext)) return fallback;
    if (ext && ext.length <= 5) return ext;
  } catch {}
  return fallback;
}

async function runVideoDownload(key, { type, id, title, season, episode, poster, rating, anime }) {
  const job = videoJobs[key] || (videoJobs[key] = { total: 0, done: 0, errors: [], cancel: false, running: true, current: null, error: "" });
  const dir = path.join(VIDEO_DIR, key);
  try {
    if (videoComplete(key)) { job.running = false; return; }

    // Offline copies are written as a local HLS playlist, so only HLS
    // streams from the Vyla SDK are usable here.
    const resolved = await resolveFirstStream(type === "tv" ? "tv" : "movie", id, season || 1, episode || 1, { hlsOnly: true });
    if (!resolved || !resolved.url) throw new Error("no stream available for this title");
    const referer = resolved.h; // header profile for every request below

    let playlistBase = resolved.url;
    let playlist = await fetchStreamPlaylist(resolved.url, referer);
    // Multi-rendition master: keep the highest-bandwidth variant for offline.
    if (playlist.includes("#EXT-X-STREAM-INF")) {
      const variantUri = pickBestVariant(playlist);
      if (!variantUri) throw new Error("no variant in stream playlist");
      playlistBase = resolveStreamUri(variantUri, playlistBase);
      playlist = await fetchStreamPlaylist(playlistBase, referer);
    }

    const entries = [];
    let keyN = 0, mapN = 0, segN = 0;
    for (const raw of playlist.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const uriMatch = line.startsWith("#") && line.includes('URI="') ? line.match(/URI="([^"]+)"/) : null;
      if (line.startsWith("#EXT-X-KEY:") && uriMatch) {
        const fname = `key${keyN++}.bin`;
        entries.push({ kind: "key", url: resolveStreamUri(uriMatch[1], playlistBase), fname, line });
        continue;
      }
      if (line.startsWith("#EXT-X-MAP:") && uriMatch) {
        const url = resolveStreamUri(uriMatch[1], playlistBase);
        const fname = `init${mapN++}${extFromUrl(url, ".mp4")}`;
        entries.push({ kind: "map", url, fname, line });
        continue;
      }
      if (line.trim() && !line.startsWith("#")) {
        const url = resolveStreamUri(line.trim(), playlistBase);
        const fname = String(++segN).padStart(6, "0") + extFromUrl(url, ".ts");
        entries.push({ kind: "seg", url, fname, line });
        continue;
      }
      entries.push({ kind: "pass", line });
    }
    if (!entries.some(e => e.kind === "seg")) throw new Error("no segments in stream");
    const work = entries.filter(e => e.kind !== "pass");
    job.total = work.length;

    await fs.promises.mkdir(dir, { recursive: true });

    let cursor = 0, firstErr = null;
    async function worker() {
      while (!job.cancel && !firstErr) {
        const i = cursor++;
        if (i >= work.length) return;
        const e = work[i];
        try {
          job.current = e.fname;
          const buf = await fetchStreamBytes(e.url, referer);
          await fs.promises.writeFile(path.join(dir, e.fname), buf);
          job.done++;
        } catch (err) {
          firstErr = err;
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (firstErr) throw firstErr;
    if (job.cancel) throw new Error("cancelled");

    const localUri = (kind, fname) => `/__video/${kind === "key" ? "key" : "seg"}/${key}/${fname}`;
    const out = entries.map(e => {
      if (e.kind === "key" || e.kind === "map") return e.line.replace(/URI="[^"]+"/, `URI="${localUri(e.kind, e.fname)}"`);
      if (e.kind === "seg") return localUri("seg", e.fname);
      return e.line;
    });
    if (!out.some(line => line && line.startsWith("/__video/seg/"))) throw new Error("download cancelled before any segment");
    await fs.promises.writeFile(path.join(dir, "index.m3u8"), out.join("\n"));
    const meta = { title, type, id, season: season || null, episode: episode || null, poster, rating, anime: !!anime, segmentCount: segN, downloadedAt: Date.now() };
    await fs.promises.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
  } catch (e) {
    if (String(e.message || e) !== "cancelled") job.error = String(e.message || e);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  } finally {
    job.running = false;
    job.current = null;
  }
}

async function runSeasonDownload(skey, { type, id, title, season, episodes, poster, rating, anime }) {
  const job = videoSeasonJobs[skey];
  try {
    const list = (episodes || []).map(n => parseInt(n, 10)).filter(n => n > 0);
    job.total = list.length;
    for (const episode of list) {
      if (job.cancel) break;
      const key = videoKey("tv", id, season, episode);
      if (videoComplete(key)) { job.skipped++; job.done++; continue; }
      job.current = "E" + episode;
      videoJobs[key] = { total: 0, done: 0, errors: [], cancel: false, running: true, current: null, error: "" };
      await runVideoDownload(key, { type, id, title, season, episode, poster, rating, anime });
      if (videoJobs[key].error) {
        job.failed++;
        job.errors.push("E" + episode + ": " + videoJobs[key].error);
      }
      job.done++;
    }
  } catch (e) {
    job.error = String(e.message || e);
  } finally {
    job.running = false;
    job.current = null;
  }
}

function mdxUploadsUrl(u) {
  return /^https?:\/\/[^/]+\/data(-saver)?\//.test(u) && !u.includes("//uploads.mangadex.org/")
    ? u.replace(/^https?:\/\/[^/]+/, "https://uploads.mangadex.org")
    : u;
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.promises.readFile(file, "utf8")); } catch { return fallback; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Manga offline downloads (MangaDex chapters only) — stored under
// DATA_DIR/manga-downloads/<mangaId>/<chapterId>/{meta.json, 000.jpg, ...}
async function handleManga(req, res, u) {
  if (u.pathname === "/__manga/downloads" && req.method === "GET") {
    const out = {};
    try {
      for (const mangaId of await fs.promises.readdir(MANGA_DIR)) {
        const chapters = [];
        for (const chapterId of await fs.promises.readdir(path.join(MANGA_DIR, mangaId))) {
          const meta = await readJSON(path.join(MANGA_DIR, mangaId, chapterId, "meta.json"), null);
          if (meta) chapters.push({ chapterId, ...meta, files: undefined });
        }
        if (chapters.length) out[mangaId] = chapters;
      }
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(out));
  }

  if (u.pathname === "/__manga/check" && req.method === "GET") {
    const mangaId = safeId(u.searchParams.get("mangaId"));
    const chapterId = safeId(u.searchParams.get("chapterId"));
    if (!mangaId || !chapterId) { res.writeHead(400); return res.end("bad id"); }
    const meta = await readJSON(path.join(MANGA_DIR, mangaId, chapterId, "meta.json"), null);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(meta ? { downloaded: true, pageCount: meta.pageCount } : { downloaded: false }));
  }

  if (u.pathname === "/__manga/page" && req.method === "GET") {
    const mangaId = safeId(u.searchParams.get("mangaId"));
    const chapterId = safeId(u.searchParams.get("chapterId"));
    const page = parseInt(u.searchParams.get("page"), 10);
    const meta = mangaId && chapterId && page >= 0
      ? await readJSON(path.join(MANGA_DIR, mangaId, chapterId, "meta.json"), null) : null;
    const fname = meta && meta.files && meta.files[page];
    if (!fname) { res.writeHead(404); return res.end("not found"); }
    const file = path.join(MANGA_DIR, mangaId, chapterId, fname);
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  }

  if (u.pathname === "/__manga/download" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const mangaId = safeId(body.mangaId);
    const chapterId = safeId(body.chapterId);
    const pages = Array.isArray(body.pages) ? body.pages : [];
    if (!mangaId || !chapterId || !pages.length) { res.writeHead(400); return res.end("bad request"); }
      const dir = path.join(MANGA_DIR, mangaId, chapterId);
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        // cache the series cover so the offline downloads shelf has art
        if (body.coverUrl) {
          const coverFile = path.join(MANGA_DIR, mangaId, "cover.jpg");
          if (!fs.existsSync(coverFile)) {
            try {
              const cr = await fetch(mdxUploadsUrl(body.coverUrl), { headers: { "User-Agent": UA } });
              if (cr.ok) await fs.promises.writeFile(coverFile, Buffer.from(await cr.arrayBuffer()));
            } catch { /* cosmetic */ }
          }
        }
        const files = [];
      for (let i = 0; i < pages.length; i++) {
        const dest = new URL(mdxUploadsUrl(pages[i]));
        if (!ALLOW.test(dest.hostname)) throw new Error("host not allowed: " + dest.hostname);
        const up = await fetch(dest.toString(), { headers: { "User-Agent": UA } });
        if (!up.ok) throw new Error(`page ${i + 1} failed (${up.status})`);
        const ext = path.extname(dest.pathname).toLowerCase() || ".jpg";
        const fname = String(i).padStart(3, "0") + ext;
        await fs.promises.writeFile(path.join(dir, fname), Buffer.from(await up.arrayBuffer()));
        files.push(fname);
      }
      const meta = { ...(body.meta || {}), pageCount: files.length, files, downloadedAt: Date.now() };
      await fs.promises.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      res.writeHead(500);
      return res.end(String(e.message || e));
    }
  }

  if (u.pathname === "/__manga/delete" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const mangaId = safeId(body.mangaId);
    const chapterId = body.chapterId != null ? safeId(body.chapterId) : null;
    if (!mangaId || (body.chapterId != null && !chapterId)) { res.writeHead(400); return res.end("bad request"); }
    const dir = chapterId ? path.join(MANGA_DIR, mangaId, chapterId) : path.join(MANGA_DIR, mangaId);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    res.writeHead(204);
    return res.end();
  }

  if (u.pathname === "/__manga/cover" && req.method === "GET") {
    const mangaId = safeId(u.searchParams.get("mangaId"));
    if (!mangaId) { res.writeHead(400); return res.end("bad id"); }
    return fs.readFile(path.join(MANGA_DIR, mangaId, "cover.jpg"), (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      res.end(data);
    });
  }

  if (u.pathname === "/__manga/series-download" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const mangaId = safeId(body.mangaId);
    if (!mangaId) { res.writeHead(400); return res.end("bad request"); }
    if (seriesJobs[mangaId] && seriesJobs[mangaId].running) { res.writeHead(409); return res.end("already running"); }
    seriesJobs[mangaId] = { total: 0, done: 0, skipped: 0, failed: 0, errors: [], cancel: false, running: true, current: null, error: "" };
    runSeriesDownload(mangaId, String(body.mangaTitle || "").slice(0, 200), String(body.coverUrl || ""));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (u.pathname === "/__manga/series-download/status" && req.method === "GET") {
    const mangaId = safeId(u.searchParams.get("mangaId"));
    const job = mangaId ? seriesJobs[mangaId] : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(job || { running: false }));
  }

  if (u.pathname === "/__manga/series-download/cancel" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const mangaId = safeId(body.mangaId);
    if (mangaId && seriesJobs[mangaId]) seriesJobs[mangaId].cancel = true;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404);
  res.end("not found");
}

/* ---------- Video downloads (movies / series / anime) ---------- */
// Offline library for video: downloads index, per-title start/cancel/status,
// delete, and same-origin serving of the local playlist + segments + keys so
// the in-app hls.js player can play a download with no internet.
async function handleVideo(req, res, u) {
  if (u.pathname === "/__video/downloads" && req.method === "GET") {
    const out = {};
    try {
      for (const key of await fs.promises.readdir(VIDEO_DIR)) {
        const meta = await readJSON(path.join(VIDEO_DIR, key, "meta.json"), null);
        if (meta) out[key] = meta;
      }
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(out));
  }

  if (u.pathname === "/__video/check" && req.method === "GET") {
    const key = safeId(u.searchParams.get("key"));
    if (!key) { res.writeHead(400); return res.end("bad key"); }
    const has = fs.existsSync(path.join(VIDEO_DIR, key, "index.m3u8"));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ downloaded: has }));
  }

  if (u.pathname === "/__video/download" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const type = body.type === "tv" ? "tv" : "movie";
    const id = parseInt(body.id, 10);
    const season = parseInt(body.season, 10) || 1;
    const episode = parseInt(body.episode, 10) || 1;
    if (!id) { res.writeHead(400); return res.end("bad id"); }
    const key = videoKey(type, id, season, episode);
    if (videoComplete(key)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, already: true }));
    }
    if (videoJobs[key] && videoJobs[key].running) { res.writeHead(409); return res.end("already running"); }
    videoJobs[key] = { total: 0, done: 0, errors: [], cancel: false, running: true, current: null, error: "" };
    runVideoDownload(key, {
      type, id,
      title: String(body.title || "").slice(0, 200),
      season, episode,
      poster: body.poster || null,
      rating: body.rating || null,
      anime: !!body.anime,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (u.pathname === "/__video/season-download" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const id = parseInt(body.id, 10);
    const season = parseInt(body.season, 10) || 1;
    const episodes = Array.isArray(body.episodes) ? body.episodes : [];
    if (!id || !episodes.length) { res.writeHead(400); return res.end("bad request"); }
    const skey = videoSeasonKey(id, season);
    if (videoSeasonJobs[skey] && videoSeasonJobs[skey].running) { res.writeHead(409); return res.end("already running"); }
    videoSeasonJobs[skey] = { total: 0, done: 0, skipped: 0, failed: 0, errors: [], cancel: false, running: true, current: null, error: "" };
    runSeasonDownload(skey, {
      type: "tv", id,
      title: String(body.title || "").slice(0, 200),
      season, episodes,
      poster: body.poster || null,
      rating: body.rating || null,
      anime: !!body.anime,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (u.pathname === "/__video/season-download/status" && req.method === "GET") {
    const key = safeId(u.searchParams.get("key"));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify((key && videoSeasonJobs[key]) || { running: false }));
  }

  if (u.pathname === "/__video/season-download/cancel" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const key = safeId(body.key);
    if (key && videoSeasonJobs[key]) videoSeasonJobs[key].cancel = true;
    if (key) {
      for (const k of Object.keys(videoJobs)) {
        if (k.startsWith(key + "-e") && videoJobs[k]) videoJobs[k].cancel = true;
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (u.pathname === "/__video/download/status" && req.method === "GET") {
    const key = safeId(u.searchParams.get("key"));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(videoJobs[key] || { running: false }));
  }

  if (u.pathname === "/__video/download/cancel" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const key = safeId(body.key);
    if (key && videoJobs[key]) videoJobs[key].cancel = true;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (u.pathname === "/__video/delete" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }
    const key = safeId(body.key);
    if (!key) { res.writeHead(400); return res.end("bad key"); }
    await fs.promises.rm(path.join(VIDEO_DIR, key), { recursive: true, force: true }).catch(() => {});
    res.writeHead(204);
    return res.end();
  }

  // Serve the local playlist / segments / AES-128 keys to the in-app player.
  const m = u.pathname.match(/^\/__video\/(playlist|seg|key)\/([^/]+)(?:\/(.+))?$/);
  if (m) {
    const kind = m[1], key = m[2], file = m[3];
    if (!safeId(key) || (file && !/^[A-Za-z0-9_.-]+$/.test(file))) { res.writeHead(400); return res.end("bad path"); }
    const p = path.join(VIDEO_DIR, key, file || "index.m3u8");
    const ext = path.extname(p).toLowerCase();
    const type = kind === "key" ? "application/octet-stream"
      : kind === "playlist" || ext === ".m3u8" ? "application/vnd.apple.mpegurl"
      : (TYPES[ext] || "application/octet-stream");
    return fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
      res.end(data);
    });
  }

  res.writeHead(404);
  res.end("not found");
}

/* ---------- Stream sources: Vyla SDK + header-aware stream proxy ----------
   Every video source comes from the Vyla SDK (@vyla-entertainment/sdk,
   https://gitlab.com/vyla-entertainment/sdk). It runs here, server-side,
   and turns a TMDB id into direct HLS / MP4 stream URLs plus the request
   headers (Referer/Origin/UA) each CDN insists on.

   Two consumers use it:
   - Vyla's own web player (vyla-player/), through the /api/* routes below.
   - The offline downloader, which picks the first HLS stream any source
     returns (resolveFirstStream) and fetches it through:
       /__stream/m3u8?u=&h=  HLS playlist; every URI is rewritten back here
       /__stream/seg?u=&h=   segment / key bytes (Range-aware)
     `h` names a header profile this server issued when it resolved the
     stream. Only URLs carrying a known profile are proxied, so this can't
     be used as an open proxy (and it binds to 127.0.0.1 anyway). */

// The SDK is an ES module with top-level await; server.js is CommonJS, so it
// is loaded once with a dynamic import. A load failure (e.g. a missing
// optional native dependency on some platform) must not take down the rest
// of the server — manga, downloads and backups keep working.
let vylaPromise = null;
function getVyla() {
  if (!vylaPromise) {
    vylaPromise = (async () => {
      const { pathToFileURL } = require("url");
      const entry = require.resolve("@vyla-entertainment/sdk");
      const mod = await import(pathToFileURL(entry).href);
      const VylaSDK = mod.default || mod.VylaSDK;
      return new VylaSDK({ tmdbApiKey: config("TMDB_API_KEY", undefined) });
    })().catch((e) => {
      console.error("[vyla] SDK failed to load:", e);
      vylaPromise = null; // allow a retry on the next request
      throw e;
    });
  }
  return vylaPromise;
}

// Sources that answered quickly and reliably in testing go first; the rest
// follow in the SDK's own order. Live health probes reorder this further.
const VYLA_PREFERRED = ["vidzee", "vidlink", "vixsrc", "rivestream", "vidfast", "hexa", "pstream", "vidsrc", "cinesrc", "nexa", "vidvault"];

// Health probe cache — the SDK probes each source against a known movie and
// episode. Run in the background at most every 6 hours.
const VYLA_HEALTH_TTL = 6 * 60 * 60 * 1000;
let vylaHealth = { at: 0, results: {}, running: false };

function refreshVylaHealth(force = false) {
  if (vylaHealth.running) return;
  if (!force && Date.now() - vylaHealth.at < VYLA_HEALTH_TTL) return;
  vylaHealth.running = true;
  getVyla()
    .then(sdk => sdk.probeAllSources())
    .then(results => { vylaHealth = { at: Date.now(), results: results || {}, running: false }; })
    .catch(e => {
      console.log("[vyla] health probe failed:", String(e.message || e).slice(0, 120));
      vylaHealth.running = false;
    });
}

async function vylaSourceList() {
  const sdk = await getVyla();
  const list = sdk.getSources(true);
  const health = vylaHealth.results;
  const rank = (key) => {
    const i = VYLA_PREFERRED.indexOf(key);
    return i === -1 ? VYLA_PREFERRED.length : i;
  };
  // healthy first (fastest first), then untested, then known-failing
  const tier = (key) => {
    const h = health[key];
    if (!h) return 1;
    return h.ok ? 0 : 2;
  };
  return list
    .map((cfg, order) => ({ cfg, order }))
    .sort((a, b) =>
      tier(a.cfg.key) - tier(b.cfg.key) ||
      (tier(a.cfg.key) === 0 ? (health[a.cfg.key].ms || 0) - (health[b.cfg.key].ms || 0) : 0) ||
      rank(a.cfg.key) - rank(b.cfg.key) ||
      a.order - b.order)
    .map(({ cfg }) => ({
      key: cfg.key,
      name: cfg.label || cfg.key,
      anime: /anime|kisskh/i.test(cfg.key),
      health: health[cfg.key] ? { ok: !!health[cfg.key].ok, ms: health[cfg.key].ms } : null,
    }));
}

// Header profiles: id → headers to send upstream. Bounded so a long session
// doesn't grow it forever (oldest profiles are evicted first).
const headerProfiles = new Map();
const HEADER_PROFILE_MAX = 2000;
function issueHeaderProfile(headers) {
  const clean = { "User-Agent": UA };
  for (const [k, v] of Object.entries(headers || {})) {
    if (typeof v === "string" && v && !/^(host|content-length|connection|range)$/i.test(k)) clean[k] = v;
  }
  const sig = JSON.stringify(clean);
  for (const [id, p] of headerProfiles) if (p.sig === sig) return id;
  const id = require("crypto").randomBytes(6).toString("hex");
  headerProfiles.set(id, { sig, headers: clean });
  while (headerProfiles.size > HEADER_PROFILE_MAX) headerProfiles.delete(headerProfiles.keys().next().value);
  return id;
}

function streamType(item) {
  const url = item.url || "";
  if (item.type === "hls" || /\.m3u8(\?|$)/i.test(url)) return "hls";
  if (item.type === "dash" || /\.mpd(\?|$)/i.test(url)) return "dash";
  return "mp4";
}

// Normalise one SDK getStream() result into the streams the player can use.
// DASH is dropped (the player has hls.js only); HLS is listed before MP4
// because the MP4 links are often huge MKV/HEVC files browsers can't decode.
function playableStreams(result, sourceKey) {
  if (!result) return [];
  const items = Array.isArray(result.allUrls) && result.allUrls.length ? result.allUrls : (result.url ? [result] : []);
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const type = streamType(item);
    if (type === "dash") continue;
    const h = issueHeaderProfile(item.headers || result.headers);
    const enc = encodeURIComponent(url);
    out.push({
      source: sourceKey,
      server: item.server || item.label || sourceKey,
      quality: item.quality || "Auto",
      type,
      url,
      h,
      play: type === "hls" ? `/__stream/m3u8?u=${enc}&h=${h}` : `/__stream/seg?u=${enc}&h=${h}`,
    });
  }
  // Streams labelled with another language (e.g. "VixSrc (Italian)") go
  // after English / unlabelled ones.
  const foreign = (s) => /english|\beng\b/i.test(s.server) ? 0
    : /italian|\bita\b|hindi|french|spanish|latino|german|russian|portuguese|arabic|turkish/i.test(s.server) ? 1 : 0;
  return out.sort((a, b) =>
    ((a.type === "hls" ? 0 : 1) - (b.type === "hls" ? 0 : 1)) || (foreign(a) - foreign(b)));
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);

async function vylaStreams(key, kind, id, season, episode) {
  const sdk = await getVyla();
  const isTv = kind === "tv";
  const result = await withTimeout(
    sdk.getStream(key, String(id), isTv ? (season || 1) : null, isTv ? (episode || 1) : null),
    30000
  );
  return playableStreams(result, key);
}

// Try sources in ranked order, a few at a time, and return the first that
// yields a stream. Used by the offline downloader and the legacy player.
async function resolveFirstStream(kind, id, season, episode, { hlsOnly = false } = {}) {
  const sources = await vylaSourceList();
  const BATCH = 4;
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(s =>
      vylaStreams(s.key, kind, id, season, episode).catch(() => [])));
    for (const streams of results) {
      const usable = hlsOnly ? streams.filter(s => s.type === "hls") : streams;
      if (usable.length) return usable[0];
    }
  }
  return null;
}

function rewriteLine(line, playlistUrl, h) {
  const toProxy = (abs, isPlaylist) =>
    `/__stream/${isPlaylist ? "m3u8" : "seg"}?u=${encodeURIComponent(abs)}&h=${h}`;
  // URI="..." attributes inside #EXT-X-KEY / #EXT-X-MAP / #EXT-X-MEDIA
  if (line.startsWith("#") && line.includes('URI="')) {
    return line.replace(/URI="([^"]+)"/g, (m, uri) => {
      if (uri.startsWith("data:") || uri.startsWith("skd:")) return m;
      const abs = new URL(uri, playlistUrl).toString();
      return `URI="${toProxy(abs, /\.m3u8(\?|$)/i.test(abs))}"`;
    });
  }
  if (line.startsWith("#") || !line.trim()) return line;
  const abs = new URL(line.trim(), playlistUrl).toString();
  return toProxy(abs, /\.m3u8(\?|$)/i.test(abs));
}

// A playlist is a playlist even when the URL doesn't say so (many SDK
// sources serve HLS from extension-less API paths), so variant playlists are
// detected by the preceding #EXT-X-STREAM-INF / TYPE= tag, not the URL.
function rewritePlaylist(text, playlistUrl, h) {
  const lines = text.split("\n").map(l => l.replace(/\r$/, ""));
  let nextIsPlaylist = false;
  return lines.map(line => {
    if (line.startsWith("#EXT-X-STREAM-INF") || line.startsWith("#EXT-X-I-FRAME-STREAM-INF")) {
      nextIsPlaylist = line.startsWith("#EXT-X-STREAM-INF");
      if (line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) =>
          `URI="/__stream/m3u8?u=${encodeURIComponent(new URL(uri, playlistUrl).toString())}&h=${h}"`);
      }
      return line;
    }
    if (line.startsWith("#EXT-X-MEDIA") && line.includes('URI="')) {
      return line.replace(/URI="([^"]+)"/g, (m, uri) =>
        `URI="/__stream/m3u8?u=${encodeURIComponent(new URL(uri, playlistUrl).toString())}&h=${h}"`);
    }
    if (nextIsPlaylist && line.trim() && !line.startsWith("#")) {
      nextIsPlaylist = false;
      return `/__stream/m3u8?u=${encodeURIComponent(new URL(line.trim(), playlistUrl).toString())}&h=${h}`;
    }
    return rewriteLine(line, playlistUrl, h);
  }).join("\n");
}

function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

/* ---------- Vyla player API (/api/*) ----------
   The streaming player is Vyla's own web player (vyla-player/, vendored from
   gitlab.com/vyla-entertainment/player). It expects the routes of its
   Express server; these are ported from it and run on the same SDK
   instance as the downloader.

   Its /api/proxy fetches whatever URL it is given. That's fine on a hosted
   server, but here it would let any web page the user visits reach their
   local network through the app. So the proxy only serves hosts the SDK
   itself handed out (stream, subtitle and download URLs, and the hosts named
   inside playlists fetched from those), and never private addresses. */
const VYLA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const trustedHosts = new Set();

function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "0.0.0.0") return true;
  if (/^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.includes(":") && (h === "::1" || /^f[cd]/.test(h) || /^fe80/.test(h))) return true;
  return false;
}

function trustUrl(url) {
  try {
    const u = new URL(url);
    if (/^https?:$/.test(u.protocol) && !isPrivateHost(u.hostname)) trustedHosts.add(u.hostname.toLowerCase());
  } catch {}
}

const vylaParam = (u, name) => {
  const v = u.searchParams.get(name);
  return v && v !== "null" && v !== "undefined" ? v : undefined;
};

async function isStreamPlayable(streamUrl, headers = {}, depth = 0) {
  try {
    const res = await fetch(streamUrl, {
      headers: { "User-Agent": VYLA_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", ...headers, Range: "bytes=0-1024" },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    if (![200, 206, 304].includes(res.status)) { res.body?.cancel(); return false; }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const isM3U8 = streamUrl.includes(".m3u8") || ct.includes("mpegurl") || ct.includes("m3u8");
    if (!isM3U8) { res.body?.cancel(); return true; }

    const text = await res.text();
    let first = null;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) { first = new URL(t, streamUrl).toString(); break; }
    }
    if (!first) return false;
    if (first.includes("m3u8")) return depth < 3 && isStreamPlayable(first, headers, depth + 1);
    const chunk = await fetch(first, {
      headers: { "User-Agent": VYLA_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", ...headers, Range: "bytes=0-1024" },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    chunk.body?.cancel();
    return [200, 206, 304].includes(chunk.status);
  } catch {
    return false;
  }
}

async function handleVylaApi(req, res, u) {
  try {
    if (u.pathname === "/api/sources") {
      const sdk = await getVyla();
      refreshVylaHealth();
      // RegExp fields (cdnHeaders patterns) don't survive JSON; send what the
      // player uses.
      const sources = sdk.getSources(true).map(cfg => ({ key: cfg.key, label: cfg.label }));
      return sendJSON(res, 200, { sources });
    }

    if (u.pathname === "/api/stream") {
      const provider = vylaParam(u, "provider");
      const tmdbId = vylaParam(u, "tmdbId");
      if (!provider || !tmdbId) return sendJSON(res, 400, { error: "Missing provider or tmdbId parameter" });
      const sdk = await getVyla();
      const s = vylaParam(u, "season");
      const e = vylaParam(u, "episode");
      const streamData = await withTimeout(sdk.getStream(String(provider), String(tmdbId), s, s ? (e || "1") : e), 30000);
      if (!streamData) return sendJSON(res, 404, { error: "Stream not found" });

      const headers = streamData.headers || {};
      if (Array.isArray(streamData.allUrls) && streamData.allUrls.length) {
        const checks = await Promise.all(streamData.allUrls.map(async (x) =>
          x && x.url && await isStreamPlayable(x.url, x.headers || headers) ? x : null));
        streamData.allUrls = checks.filter(Boolean);
        if (streamData.allUrls.length) {
          if (!streamData.url || !streamData.allUrls.some(x => x.url === streamData.url)) streamData.url = streamData.allUrls[0].url;
        } else {
          streamData.url = null;
        }
      } else if (streamData.url && !(await isStreamPlayable(streamData.url, headers))) {
        streamData.url = null;
      }
      if (!streamData.url) return sendJSON(res, 404, { error: "No playable stream found" });

      trustUrl(streamData.url);
      for (const x of streamData.allUrls || []) trustUrl(x.url);
      return sendJSON(res, 200, { success: true, provider, stream: streamData });
    }

    if (u.pathname === "/api/subtitles") {
      const tmdbId = vylaParam(u, "tmdbId");
      if (!tmdbId) return sendJSON(res, 200, { subtitles: [] });
      const sdk = await getVyla();
      const subtitles = (await withTimeout(sdk.getSubtitles(String(tmdbId), vylaParam(u, "season"), vylaParam(u, "episode")), 15000)) || [];
      for (const t of subtitles) trustUrl(t && t.file);
      return sendJSON(res, 200, { subtitles });
    }

    if (u.pathname === "/api/downloads") {
      const tmdbId = vylaParam(u, "tmdbId");
      if (!tmdbId) return sendJSON(res, 200, { downloads: [] });
      const sdk = await getVyla();
      const downloads = (await withTimeout(sdk.getDownloads(String(tmdbId), vylaParam(u, "season"), vylaParam(u, "episode")), 60000)) || [];
      for (const d of downloads) trustUrl(d && d.url);
      return sendJSON(res, 200, { downloads });
    }

    if (u.pathname === "/api/proxy") return vylaProxy(req, res, u);
  } catch (e) {
    if (u.pathname === "/api/subtitles") return sendJSON(res, 200, { subtitles: [] });
    if (u.pathname === "/api/downloads") return sendJSON(res, 200, { downloads: [] });
    return sendJSON(res, 404, { error: String(e.message || e) });
  }
  res.writeHead(404);
  res.end("not found");
}

async function vylaProxy(req, res, u) {
  const targetUrl = u.searchParams.get("url");
  if (!targetUrl) { res.writeHead(400); return res.end("Missing url parameter"); }
  let dest;
  try { dest = new URL(targetUrl); } catch { res.writeHead(400); return res.end("bad url"); }
  if (!/^https?:$/.test(dest.protocol) || isPrivateHost(dest.hostname) || !trustedHosts.has(dest.hostname.toLowerCase())) {
    res.writeHead(403); return res.end("host not allowed");
  }

  let customHeaders = {};
  if (u.searchParams.get("headers")) {
    try { customHeaders = JSON.parse(u.searchParams.get("headers")) || {}; } catch {}
  }
  for (const k of Object.keys(customHeaders)) {
    if (/^(host|content-length|connection)$/i.test(k) || typeof customHeaders[k] !== "string") delete customHeaders[k];
  }
  const isStrip = u.searchParams.get("strip") === "1" || u.searchParams.get("tt") === "1" ||
    /tiktokcdn\.com|ibyteimg\.com|seg\.html|enproxy|letsgocdn\d+\.shop/i.test(targetUrl);

  const fetchOpts = {
    method: req.method === "HEAD" ? "HEAD" : "GET",
    headers: { "User-Agent": VYLA_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", ...customHeaders },
    redirect: "follow",
  };
  if (req.headers.range) fetchOpts.headers.Range = req.headers.range;

  let response, lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      response = await fetch(dest.toString(), fetchOpts);
      if (response.ok || response.status === 206 || response.status === 404) break;
      if (i < 2) { response.body?.cancel(); await new Promise(r => setTimeout(r, 1000)); }
    } catch (err) {
      lastErr = err;
      response = null;
      if (i < 2) await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  if (!response) { res.writeHead(502); return res.end(lastErr ? String(lastErr.message) : "Bad Gateway"); }
  if (!response.ok && response.status !== 206) {
    response.body?.cancel();
    res.writeHead(response.status); return res.end(`Upstream error: ${response.status}`);
  }

  const ct = (response.headers.get("content-type") || "").toLowerCase();
  const isM3U8 = targetUrl.includes(".m3u8") || ct.includes("mpegurl") || ct.includes("m3u8");
  if (isM3U8 && req.method !== "HEAD") {
    const text = await response.text();
    const base = response.url || targetUrl;
    const headersParam = Object.keys(customHeaders).length ? `&headers=${encodeURIComponent(JSON.stringify(customHeaders))}` : "";
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      if (t.startsWith("#")) {
        if (t.includes('URI="')) {
          lines[i] = t.replace(/URI="([^"]+)"/g, (m, uri) => {
            if (/^(data|skd):/i.test(uri)) return m;
            const abs = new URL(uri, base).toString();
            trustUrl(abs);
            return `URI="/api/proxy?url=${encodeURIComponent(abs)}${headersParam}"`;
          });
        }
        continue;
      }
      const abs = new URL(t, base).toString();
      trustUrl(abs);
      const stripParam = isStrip || /seg\.html|enproxy|tiktokcdn|ibyteimg/i.test(abs) ? "&strip=1" : "";
      lines[i] = `/api/proxy?url=${encodeURIComponent(abs)}${headersParam}${stripParam}`;
    }
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
    return res.end(lines.join("\n"));
  }

  if (isStrip && req.method !== "HEAD") {
    // segments wrapped in a fake image header: drop the 120-byte prefix
    let buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 120 && (buffer[0] === 0x89 || buffer[0] === 0xFF || buffer[0] === 0x00)) buffer = buffer.subarray(120);
    res.writeHead(200, { "Content-Type": "video/MP2T" });
    return res.end(buffer);
  }

  const out = {};
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    if (response.headers.has(h)) out[h] = response.headers.get(h);
  }
  res.writeHead(response.status, out);
  if (req.method === "HEAD" || !response.body) { response.body?.cancel(); return res.end(); }
  const { Readable } = require("stream");
  const body = Readable.fromWeb(response.body);
  req.on("close", () => body.destroy());
  body.on("error", () => res.destroy());
  body.pipe(res);
}

async function handleStream(req, res, u) {
  const target = u.searchParams.get("u");
  const profile = headerProfiles.get(u.searchParams.get("h") || "");
  if (!profile) { res.writeHead(403); return res.end("unknown stream profile"); }
  let dest;
  try { dest = new URL(target); } catch { res.writeHead(400); return res.end("bad url"); }
  if (!/^https?:$/.test(dest.protocol)) { res.writeHead(400); return res.end("bad url"); }

  const upstreamHeaders = { ...profile.headers };
  if (req.headers.range) upstreamHeaders["Range"] = req.headers.range; // byte-range segments / MP4 seeking

  try {
    const up = await fetch(dest.toString(), { headers: upstreamHeaders, redirect: "follow" });
    if (!up.ok && up.status !== 206) { res.writeHead(up.status); return res.end("upstream " + up.status); }

    if (u.pathname === "/__stream/m3u8") {
      const buf = Buffer.from(await up.arrayBuffer());
      const finalUrl = up.url || dest.toString(); // resolve redirects for relative URIs
      // some upstream proxies pipe binary init segments through .m3u8 URLs
      // too — only rewrite when the body is actually a playlist
      if (buf.slice(0, 16).toString("latin1").replace(/^﻿/, "").trimStart().startsWith("#EXTM3U")) {
        const h = u.searchParams.get("h");
        res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
        return res.end(rewritePlaylist(buf.toString("utf8"), finalUrl, h));
      }
      res.writeHead(up.status, {
        "Content-Type": up.headers.get("content-type") || "video/mp4",
        "Content-Length": buf.length,
      });
      return res.end(buf);
    }

    // /__stream/seg — segment / key / MP4 bytes, streamed through without
    // buffering whole (MP4 sources can be several GB)
    // CDNs often disguise TS segments as images; tell the player the truth.
    let segType = up.headers.get("content-type") || "video/mp2t";
    if (/^(image|text)\//i.test(segType)) segType = "video/mp2t";
    res.writeHead(up.status, {
      "Content-Type": segType,
      "Accept-Ranges": up.headers.get("accept-ranges") || "bytes",
      ...(up.headers.get("content-range") ? { "Content-Range": up.headers.get("content-range") } : {}),
      ...(up.headers.get("content-length") ? { "Content-Length": up.headers.get("content-length") } : {}),
    });
    if (!up.body) return res.end();
    const { Readable } = require("stream");
    const body = Readable.fromWeb(up.body);
    req.on("close", () => body.destroy());
    body.on("error", () => res.destroy());
    return body.pipe(res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(502);
    res.end(String(e));
  }
}

function openBrowser() {
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  require("child_process").exec(cmd);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  // CORS: on Android the UI is served by Capacitor from https://fictionhub.local
  // while this server listens on http://localhost:8787 — a different origin.
  // Every API call (resolve, stream proxy, downloads, backup) is therefore a
  // cross-origin request and was blocked without these headers, leaving the
  // player on a black screen. The server binds to 127.0.0.1 only, so allowing
  // any origin exposes nothing beyond this device.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (u.pathname === "/__proxy") {
    const target = u.searchParams.get("url");
    if (!target) { res.writeHead(400); return res.end("missing url"); }
    return proxy(req, res, target);
  }

  if (u.pathname.startsWith("/__stream/")) {
    return handleStream(req, res, u);
  }

  if (u.pathname.startsWith("/api/")) {
    return handleVylaApi(req, res, u);
  }

  if (u.pathname.startsWith("/__manga/")) {
    return handleManga(req, res, u);
  }

  if (u.pathname.startsWith("/__video/")) {
    return handleVideo(req, res, u);
  }

  // Local-disk backup of localStorage (profiles, Continue Watching/Reading,
  // settings) — survives app updates/reinstalls, which wipe app.asar but not
  // userData. GET returns the last snapshot ({} if none yet); POST replaces it.
  if (u.pathname === "/__backup") {
    if (req.method === "GET") {
      return fs.readFile(BACKUP_FILE, "utf8", (err, data) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(err ? "{}" : data);
      });
    }
    if (req.method === "POST") {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        fs.writeFile(BACKUP_FILE, Buffer.concat(chunks), (err) => {
          res.writeHead(err ? 500 : 204);
          res.end();
        });
      });
      return;
    }
    res.writeHead(405);
    return res.end("method not allowed");
  }

  // static file serving
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith("/")) p += "index.html"; // "/" and folders like /vyla-player/
  const file = path.join(DIR, p);
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

const inElectron = !!process.versions.electron;

// If the port's already taken: in a browser run, open it and exit; inside the
// Electron app, just reuse whatever's already serving (don't kill the app).
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    if (inElectron) { console.log("Port in use — reusing existing server."); return; }
    console.log("FictionHub is already running — opening browser…"); openBrowser(); process.exit(0);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`FictionHub is running locally → http://localhost:${PORT}`);
  if (!inElectron) {
    console.log(`(Keep this window open while you use the site. Ctrl+C to stop.)`);
    openBrowser(); // browser run only; the Electron app opens its own window
  }
});
