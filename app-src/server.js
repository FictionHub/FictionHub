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

// Fetch a playlist through the local /__stream proxy (it applies the Referer
// the upstream needs and rewrites segment URLs back to this server).
async function fetchStreamPlaylist(m3u8Url, referer) {
  const res = await fetch(`http://localhost:${PORT}/__stream/m3u8?u=${encodeURIComponent(m3u8Url)}&r=${encodeURIComponent(referer || "https://atlantic.st/")}`);
  if (!res.ok) throw new Error("playlist " + res.status);
  return res.text();
}

// Fetch arbitrary stream bytes (segment or AES-128 key) through the proxy.
async function fetchStreamBytes(url, referer) {
  const res = await fetch(`http://localhost:${PORT}/__stream/seg?u=${encodeURIComponent(url)}&r=${encodeURIComponent(referer || "https://atlantic.st/")}`);
  if (!res.ok) throw new Error("stream " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

function extFromUrl(url, fallback) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {}
  return fallback;
}

async function runVideoDownload(key, { type, id, title, season, episode, poster, rating, anime }) {
  const job = videoJobs[key] || (videoJobs[key] = { total: 0, done: 0, errors: [], cancel: false, running: true, current: null, error: "" });
  const dir = path.join(VIDEO_DIR, key);
  try {
    if (videoComplete(key)) { job.running = false; return; }

    const r = await fetch(`http://localhost:${PORT}/__stream/resolve?kind=${type}&id=${id}&season=${season || 1}&episode=${episode || 1}`, { headers: { "User-Agent": "FictionHub" } });
    if (!r.ok) throw new Error("stream resolve failed (" + r.status + ")");
    const resolved = await r.json();
    if (!resolved || !resolved.m3u8) throw new Error("no stream available for this title");
    const referer = resolved.referer || "https://atlantic.st/";

    let playlistBase = resolved.m3u8;
    let playlist = await fetchStreamPlaylist(resolved.m3u8, referer);
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

/* ---------- Native-player stream proxy + resolver ----------
   The app's own hls.js player runs on this origin, but upstream stream CDNs
   send no CORS headers and often require a Referer. All player traffic goes
   through these endpoints instead:
   - /__stream/resolve?kind=&id=&season=&episode=  → asks Atlantic's stream
     API (helios, then moscow as fallback) for the title and decrypts the
     returned token. The tokens ("hl_…"/"ms_…") are 12-byte-IV + AES-GCM
     payloads whose keys ship inside Atlantic's own public JS bundle — this
     replicates exactly what their player does, minus the browser part.
   - /__stream/m3u8?u=&r=  fetches an HLS playlist (Referer r, browser UA),
                           rewrites every URI line / URI="..." attribute to
                           point back at this proxy, serves it to hls.js.
                           Responses that aren't playlists (their m3u8-proxy
                           also pipes binary init segments through .m3u8
                           URLs) are passed through byte-clean.
   - /__stream/seg?u=&r=   pipes segment/key/media bytes through */
const STREAM_ALLOW = /(^|\.)(hls\.lol|atlantic\.st|transcode\.cfd|totallyacdn\.org|zenoak\.top)$/i;

const STREAM_TOKEN_KEYS = {
  hl_: "117c358bcfcaf8fe2cfca57c9d2238a300e1c4de2efb83a5012ba84d8a31f1dd",
  ms_: "55060a042823f51a94c296894a58a0db15f3baef807155140983083fa799ef47",
};
const hexBytes = (h) => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b, 16)));

async function decryptStreamToken(token) {
  const keyHex = STREAM_TOKEN_KEYS[token.slice(0, 3)];
  if (!keyHex) throw new Error("unknown stream token prefix");
  const raw = hexBytes(token.slice(3));
  if (raw.length < 28) throw new Error("stream token payload too short");
  const key = await crypto.subtle.importKey("raw", hexBytes(keyHex), { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
  return new TextDecoder().decode(pt);
}

// Atlantic's stream API: helios is the primary, moscow the fallback. TV uses
// seasonId/episodeId (their naming), not season/episode.
async function resolveNativeStream(kind, id, season, episode) {
  const q = new URLSearchParams({ tmdbId: String(id), type: kind });
  if (kind === "tv") { q.set("seasonId", String(season || 1)); q.set("episodeId", String(episode || 1)); }
  const problems = [];
  for (const ep of ["helios", "moscow"]) {
    try {
      const r = await fetch(`https://stream.hls.lol/${ep}?${q}`, {
        headers: streamFetchHeaders("https://atlantic.st/"),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) { problems.push(ep + " http " + r.status); continue; }
      const j = await r.json();
      const token = j && j.sources && j.sources.Moscow && j.sources.Moscow.url;
      if (!token) { problems.push(ep + " no-source"); continue; }
      const m3u8 = await decryptStreamToken(token);
      if (m3u8) return { m3u8, referer: "https://atlantic.st/" };
      problems.push(ep + " empty-decrypt");
    } catch (e) {
      problems.push(ep + " " + String(e.message || e).slice(0, 80));
    }
  }
  if (problems.length) console.log("[stream] resolve failed:", problems.join(" | "));
  return null;
}

function streamFetchHeaders(referer, extra = {}) {
  return { "User-Agent": UA, "Referer": referer || "https://atlantic.st/", ...extra };
}

function rewriteLine(line, playlistUrl, referer) {
  const toProxy = (abs, isPlaylist) =>
    isPlaylist
      ? `/__stream/m3u8?u=${encodeURIComponent(abs)}&r=${encodeURIComponent(referer)}`
      : `/__stream/seg?u=${encodeURIComponent(abs)}&r=${encodeURIComponent(referer)}`;
  // URI="..." attributes inside #EXT-X-KEY / #EXT-X-MAP / #EXT-X-MEDIA
  if (line.startsWith("#") && line.includes('URI="')) {
    return line.replace(/URI="([^"]+)"/g, (m, uri) => {
      const abs = new URL(uri, playlistUrl).toString();
      return `URI="${toProxy(abs, /\.m3u8(\?|$)/i.test(abs))}"`;
    });
  }
  if (line.startsWith("#") || !line.trim()) return line;
  const abs = new URL(line.trim(), playlistUrl).toString();
  return toProxy(abs, /\.m3u8(\?|$)/i.test(abs));
}

async function handleStream(req, res, u) {
  // resolve: embed-free source resolution (no hidden window, no browser)
  if (u.pathname === "/__stream/resolve") {
    const kind = u.searchParams.get("kind") === "tv" ? "tv" : "movie";
    const id = parseInt(u.searchParams.get("id"), 10);
    if (!id) { res.writeHead(400); return res.end("bad id"); }
    try {
      const out = await resolveNativeStream(kind, id,
        parseInt(u.searchParams.get("season"), 10), parseInt(u.searchParams.get("episode"), 10));
      res.writeHead(out ? 200 : 404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(out || { error: "no source" }));
    } catch (e) {
      res.writeHead(502);
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }

  const target = u.searchParams.get("u");
  const referer = u.searchParams.get("r") || "https://atlantic.st/";
  let dest;
  try { dest = new URL(target); } catch { res.writeHead(400); return res.end("bad url"); }
  if (!STREAM_ALLOW.test(dest.hostname)) { res.writeHead(403); return res.end("host not allowed"); }

  const upstreamHeaders = streamFetchHeaders(referer);
  if (req.headers.range) upstreamHeaders["Range"] = req.headers.range; // byte-range segments

  try {
    const up = await fetch(dest.toString(), { headers: upstreamHeaders, redirect: "follow" });
    if (!up.ok && up.status !== 206) { res.writeHead(up.status); return res.end("upstream " + up.status); }

    if (u.pathname === "/__stream/m3u8") {
      const buf = Buffer.from(await up.arrayBuffer());
      const finalUrl = up.url || dest.toString(); // resolve redirects for relative URIs
      // their m3u8-proxy pipes binary init segments through .m3u8 URLs too —
      // only rewrite when the body is actually a playlist
      if (buf.slice(0, 7).toString("latin1") === "#EXTM3U") {
        const rewritten = buf.toString("utf8").split("\n")
          .map(l => rewriteLine(l.replace(/\r$/, ""), finalUrl, referer)).join("\n");
        res.writeHead(200, {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(rewritten);
      }
      res.writeHead(up.status, {
        "Content-Type": up.headers.get("content-type") || "video/mp4",
        "Content-Length": buf.length,
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(buf);
    }

    // segment / key bytes — stream through
    res.writeHead(up.status, {
      "Content-Type": up.headers.get("content-type") || "video/mp2t",
      "Accept-Ranges": up.headers.get("accept-ranges") || "bytes",
      ...(up.headers.get("content-range") ? { "Content-Range": up.headers.get("content-range") } : {}),
      ...(up.headers.get("content-length") ? { "Content-Length": up.headers.get("content-length") } : {}),
      "Access-Control-Allow-Origin": "*",
    });
    const buf = Buffer.from(await up.arrayBuffer());
    return res.end(buf);
  } catch (e) {
    res.writeHead(502);
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
  if (p === "/") p = "/index.html";
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
