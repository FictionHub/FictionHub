/* ===== Manga reader — powered by the MangaDex API (free, no key) ===== */

const MDX = "https://api.mangadex.org";
const MDX_COVER = "https://uploads.mangadex.org/covers";
const RATINGS = ["safe", "suggestive", "erotica"];
const MLIMIT = 60;

const mangaStore = {
  get reading() { return JSON.parse(localStorage.getItem(pkey("mdx_reading")) || "{}"); },
  set reading(v) { localStorage.setItem(pkey("mdx_reading"), JSON.stringify(v)); scheduleBackup(); },
};

let currentManga = null;       // { id, title, cover, chapters: [] }
let currentChapterIndex = 0;
let pageUrls = [];
let currentPage = 0;
let readerMode = "strip";
let readerQuality = "saver"; // "saver" | "hd"
let readerDirection = "ltr"; // "ltr" | "rtl"
let mdxPageData = null; // { baseUrl, hash, data[], dataSaver[] } for the open MangaDex chapter
let currentChapterDownloaded = false;
let downloadedChapterIds = new Set(); // mdx chapter ids downloaded for currentManga

// Pull the active profile's reader defaults from settingsStore. Called when
// entering the manga section (not at script load — profiles/backup may not
// be ready yet at that point).
function loadReaderPrefs() {
  const prefs = settingsStore.readerPrefs;
  readerMode = prefs.mode;
  readerQuality = prefs.quality;
  readerDirection = prefs.direction;
}

/* ---------- API helper (supports array params like includes[]) ----------
   MangaDex's API often doesn't send permissive CORS headers for arbitrary
   origins, so a direct browser fetch can fail with "Failed to fetch". We try
   direct first (fast path), then fall back through the proxy. Images load
   via <img> so they don't need this. */

// Every manga request goes through the app's OWN local server (server.js),
// which is started in-process by the Electron shell and always running on
// http://localhost:8787. It is same-origin (so no CORS errors) and injects the
// User-Agent / Referer / HX-Request headers that a browser can't set
// cross-origin. That means NO public/external CORS proxy and NO user
// configuration are ever needed — it just works offline to the internet
// services, with nothing leaving the machine except the manga source itself.
const PROXY = "/__proxy?url=";
function viaProxy(url) { return PROXY + encodeURIComponent(url); }

async function mdx(path, params = {}) {
  const url = new URL(MDX + path);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  const res = await fetch(viaProxy(url.toString()), { cache: "no-store" });
  if (!res.ok) throw new Error("mdx-" + res.status);
  return res.json();
}

/* ---------- Small helpers ---------- */
function esc(s) { return (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function mangaTitle(m) {
  const t = m.attributes.title || {};
  if (t.en) return t.en;
  const alt = (m.attributes.altTitles || []).find(a => a.en);
  return (alt && alt.en) || t["ja-ro"] || t.ja || Object.values(t)[0] || "Untitled";
}
function mangaCover(m) {
  const rel = (m.relationships || []).find(r => r.type === "cover_art");
  const f = rel && rel.attributes && rel.attributes.fileName;
  return f ? `${MDX_COVER}/${m.id}/${f}.256.jpg` : "";
}
function statusLabel(m) {
  const y = m.attributes.year || "";
  const s = cap(m.attributes.status || "");
  return [y, s].filter(Boolean).join(" · ") || "Manga";
}
// Chapters are normalized to: { source:'mdx'|'weeb', id, number, title, volume, group }
function normalizeMdxChapter(c) {
  const g = (c.relationships || []).find(r => r.type === "scanlation_group");
  return {
    source: "mdx",
    id: c.id,
    number: c.attributes.chapter || null,
    title: c.attributes.title || "",
    volume: c.attributes.volume || "",
    group: (g && g.attributes && g.attributes.name) || "Unknown",
  };
}
function chapLabel(c) {
  const num = c.number ? `Ch. ${c.number}` : "Oneshot";
  const vol = c.volume ? `Vol. ${c.volume} ` : "";
  const title = c.title ? ` — ${c.title}` : "";
  return `${vol}${num}${title}`;
}
function chapGroup(c) { return c.group || "Unknown"; }

/* ---------- Cards & rows (reuses .card / scrollRow from app.js) ---------- */
function mCard(id, title, cover, sub, progress, opts) {
  // referrerpolicy=no-referrer dodges MangaDex's anti-hotlink cover placeholder
  const img = cover ? `<img loading="lazy" referrerpolicy="no-referrer" src="${cover}" alt="">` : `<div style="height:258px"></div>`;
  const bar = progress ? `<div class="progress-bar" style="width:${Math.min(progress, 100)}%"></div>` : "";
  const removeBtn = opts && opts.removable
    ? `<button class="card-remove" title="Remove" onclick="event.stopPropagation(); removeFromReading('${id}')">✕</button>`
    : "";
  return `<div class="card" onclick="openManga('${id}')">
      <div class="poster">
        ${removeBtn}
        ${img}
        <div class="overlay"><div class="play-icon">📖</div></div>
        ${bar}
      </div>
      <div class="meta"><div class="t">${esc(title)}</div><div class="y">${esc(sub || "Manga")}</div></div>
    </div>`;
}

function mangaRow(title, list) {
  const cards = list.map(m => mCard(m.id, mangaTitle(m), mangaCover(m), statusLabel(m))).join("");
  if (!cards.trim()) return "";
  return `<section class="row">
    <div class="row-head"><h2>${title}</h2></div>
    <div class="row-wrap">
      <button class="row-arrow left" onclick="scrollRow(this,-1)">‹</button>
      <div class="row-scroll">${cards}</div>
      <button class="row-arrow right" onclick="scrollRow(this,1)">›</button>
    </div>
  </section>`;
}

function continueReadingHTML() {
  const items = Object.values(mangaStore.reading).sort((a, b) => b.updated - a.updated);
  if (!items.length) return "";
  const cards = items.map(x => mCard(x.id, x.title, x.cover, `Ch. ${x.chapterNum || "?"}`, x.progress, { removable: true })).join("");
  return `<section class="row">
    <div class="row-head"><h2>Continue Reading</h2></div>
    <div class="row-wrap">
      <button class="row-arrow left" onclick="scrollRow(this,-1)">‹</button>
      <div class="row-scroll">${cards}</div>
      <button class="row-arrow right" onclick="scrollRow(this,1)">›</button>
    </div>
  </section>`;
}

function removeFromReading(id) {
  const r = mangaStore.reading;
  delete r[id];
  mangaStore.reading = r;
  if (typeof currentView === "undefined" || currentView === "manga") renderManga();
}

/* ---------- Infinite scroll (offset-based, own observer) ---------- */
let mInf = { busy: false, offset: 0, total: Infinity, grid: null, seen: null, fetcher: null };
const mObs = new IntersectionObserver(onMSentinel, { rootMargin: "800px" });

function teardownMangaInfinite() {
  mObs.disconnect();
  const s = document.getElementById("mInfSentinel");
  if (s) s.remove();
  mInf = { busy: false, offset: 0, total: Infinity, grid: null, seen: null, fetcher: null };
}

function initMangaInfinite(grid, fetcher, opts = {}) {
  teardownMangaInfinite();
  mInf = { busy: false, offset: opts.start || 0, total: Infinity, grid, seen: opts.seen || new Set(), fetcher };
  const sentinel = document.createElement("div");
  sentinel.id = "mInfSentinel";
  sentinel.className = "inf-sentinel";
  grid.after(sentinel);
  mObs.observe(sentinel);
}

async function onMSentinel(entries) {
  if (!entries[0].isIntersecting || mInf.busy || !mInf.fetcher) return;
  if (mInf.offset >= mInf.total) { const s = document.getElementById("mInfSentinel"); if (s) s.remove(); return; }
  mInf.busy = true;
  const s = document.getElementById("mInfSentinel");
  if (s) s.classList.add("loading");
  try {
    const data = await mInf.fetcher(mInf.offset);
    mInf.total = data.total || 0;
    const cards = (data.data || [])
      .filter(m => { if (mInf.seen.has(m.id)) return false; mInf.seen.add(m.id); return true; })
      .map(m => mCard(m.id, mangaTitle(m), mangaCover(m), statusLabel(m))).join("");
    if (cards) mInf.grid.insertAdjacentHTML("beforeend", cards);
    mInf.offset += MLIMIT;
  } catch { /* ignore a failed page */ }
  mInf.busy = false;
  if (s) {
    s.classList.remove("loading");
    mObs.unobserve(s);
    if (mInf.offset < mInf.total) mObs.observe(s); else s.remove();
  }
}

/* ---------- Views ---------- */
// Shelf of series with downloaded chapters — like Continue Reading, but
// backed entirely by on-disk data, so it renders (and reads) offline too.
async function downloadsRowHTML() {
  try {
    const d = await fetch("/__manga/downloads").then(r => r.json());
    const ids = Object.keys(d).filter(mangaId => (d[mangaId] || []).length);
    if (!ids.length) return "";
    const cards = ids.map(mangaId =>
      mCard(mangaId, d[mangaId][0].mangaTitle || "Manga", `/__manga/cover/${mangaId}`, "Downloaded"))
      .join("");
    return `<section class="row">
      <div class="row-head"><h2>Your Downloads</h2></div>
      <div class="row-wrap">
        <button class="row-arrow left" onclick="scrollRow(this,-1)">‹</button>
        <div class="row-scroll">${cards}</div>
        <button class="row-arrow right" onclick="scrollRow(this,1)">›</button>
      </div>
    </section>`;
  } catch { return ""; }
}

async function renderManga() {
  if (typeof hideHero === "function") hideHero();
  loadReaderPrefs();
  teardownMangaInfinite();
  const rows = document.getElementById("rows");
  document.getElementById("grid").classList.add("hidden");
  rows.classList.remove("hidden");
  rows.innerHTML = typeof skeletonHTML === "function" ? skeletonHTML() : "";
  const base = {
    "includes[]": ["cover_art"],
    "contentRating[]": RATINGS,
    "availableTranslatedLanguage[]": ["en"],
    hasAvailableChapters: "true",
    limit: 20,
  };
  try {
    const [popular, latest, top] = await Promise.all([
      mdx("/manga", { ...base, "order[followedCount]": "desc" }),
      mdx("/manga", { ...base, "order[latestUploadedChapter]": "desc" }),
      mdx("/manga", { ...base, "order[rating]": "desc" }),
    ]);
    let html = continueReadingHTML();
    html += mangaRow("Popular Manga", popular.data);
    html += mangaRow("Latest Updates", latest.data);
    html += mangaRow("Top Rated", top.data);
    rows.innerHTML = html;
    // shelf of on-disk downloads, prepended once the local index answers
    downloadsRowHTML().then(dlHtml => { if (dlHtml) rows.insertAdjacentHTML("afterbegin", dlHtml); });
    // browse the whole catalog
    const section = document.createElement("section");
    section.className = "row";
    section.innerHTML = `<div class="row-head"><h2>Browse All Manga</h2></div><div class="grid browse-grid"></div>`;
    rows.appendChild(section);
    initMangaInfinite(section.querySelector(".grid"),
      (offset) => mdx("/manga", { ...base, limit: MLIMIT, offset, "order[followedCount]": "desc" }));
  } catch (e) {
    // Offline or MangaDex unreachable — downloaded series still browse + read
    const dl = await downloadsRowHTML();
    rows.innerHTML = dl +
      `<p style="color:var(--muted); padding:40px 0">Couldn't load the online catalog (${e.message}).` +
      (dl ? " Your downloaded series above still work." : " Downloaded series would still be available here.") +
      ` Check your internet connection and try again.</p>`;
  }
}

async function renderMangaSearch(q) {
  if (typeof hideHero === "function") hideHero();
  if (typeof exitToBrowse === "function") exitToBrowse();
  teardownMangaInfinite();
  const grid = document.getElementById("grid");
  document.getElementById("rows").classList.add("hidden");
  grid.classList.remove("hidden");
  grid.innerHTML = "";
  const base = {
    title: q,
    "includes[]": ["cover_art"],
    "contentRating[]": RATINGS,
    "availableTranslatedLanguage[]": ["en"],
  };
  try {
    const first = await mdx("/manga", { ...base, limit: MLIMIT, offset: 0 });
    if (!first.total) { grid.innerHTML = `<p style="color:var(--muted)">No manga for “${esc(q)}”.</p>`; return; }
    grid.innerHTML = first.data.map(m => mCard(m.id, mangaTitle(m), mangaCover(m), statusLabel(m))).join("");
    initMangaInfinite(grid, (offset) => mdx("/manga", { ...base, limit: MLIMIT, offset }),
      { start: MLIMIT, seen: new Set(first.data.map(m => m.id)) });
  } catch (e) {
    grid.innerHTML = `<p style="color:var(--muted)">Search failed (${e.message}).</p>`;
  }
}

/* ---------- Local caches: manga detail + chapter lists ----------
   Re-opening a manga used to re-download the same rarely-changing data on
   every click, which made each one wait a couple of seconds. Both are cached
   in localStorage with a TTL and refreshed in the background
   (stale-while-revalidate), so repeat opens paint instantly. */
const DETAIL_TTL = 24 * 60 * 60 * 1000;  // title/cover/description ~never change
const CHAPTERS_TTL = 6 * 60 * 60 * 1000; // new chapters land occasionally
const detMem = new Map(), chapMem = new Map(); // session layer (no JSON parse)

function cacheGet(kind, id, ttl, mem) {
  const hit = mem.get(id);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const raw = localStorage.getItem(pkey(`mdx_cache_${kind}:${id}`));
    if (!raw) return null;
    const e = JSON.parse(raw);
    if (Date.now() - e.t < ttl) { mem.set(id, e); return e.v; }
    localStorage.removeItem(pkey(`mdx_cache_${kind}:${id}`));
  } catch { /* corrupted entry — treat as missing */ }
  return null;
}

function cacheSet(kind, id, v, mem) {
  const e = { t: Date.now(), v };
  const lsKey = pkey(`mdx_cache_${kind}:${id}`);
  try {
    localStorage.setItem(lsKey, JSON.stringify(e));
    mem.set(id, e);
  } catch {
    // Quota hit (chapter lists are big) — evict the oldest half of the cache
    // and retry once. If it still fails, the session-memory copy still works.
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.includes("mdx_cache_")) continue;
        let t = 0;
        try { t = JSON.parse(localStorage.getItem(k)).t || 0; } catch {}
        entries.push({ k, t });
      }
      entries.sort((a, b) => a.t - b.t);
      for (const { k } of entries.slice(0, Math.ceil(entries.length / 2))) localStorage.removeItem(k);
      detMem.clear(); chapMem.clear(); mem.set(id, e);
      localStorage.setItem(lsKey, JSON.stringify(e));
    } catch { /* memory cache still holds it */ }
  }
}

/* ---------- Detail + chapters ---------- */
async function fetchAllChapters(id) {
  const FEED = (offset) => mdx(`/manga/${id}/feed`, {
    "translatedLanguage[]": ["en"],
    "order[volume]": "asc",
    "order[chapter]": "asc",
    "contentRating[]": RATINGS,
    "includes[]": ["scanlation_group"],
    limit: 500, offset,
  });
  // MangaDex caps the feed at 500 per page, so long series (One Piece ≈ 1100+)
  // need several — fetch them all in parallel instead of one after another.
  const first = await FEED(0);
  const total = Math.min(first.total, 2000); // 2000-chapter safety cap kept
  const pages = [];
  for (let o = 500; o < total; o += 500) pages.push(FEED(o));
  const all = [...first.data, ...(await Promise.all(pages)).flatMap(r => r.data)];
  // one entry per chapter number (first available group wins), normalized.
  // Skip "external" chapters (pages:0, externalUrl set) — MangaDex doesn't
  // host these itself, so at-home/server returns no images for them. Leaving
  // them out lets the merge fall back to MangaKatana/WeebCentral for that
  // chapter number instead of showing a blank reader.
  const seen = new Set();
  const out = [];
  for (const c of all) {
    if (!c.attributes.pages && c.attributes.externalUrl) continue;
    const key = c.attributes.chapter ?? "oneshot:" + c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalizeMdxChapter(c));
  }
  return out;
}

async function openManga(id) {
  enterPage("mangaView");
  backToDetail();
  document.getElementById("chapterList").innerHTML = `<div class="loader"></div>`;
  document.getElementById("mangaCover").src = "";
  document.getElementById("mangaTitle").textContent = "Loading…";
  document.getElementById("mangaStatus").textContent = "";
  document.getElementById("mangaDesc").textContent = "";

  // Chapters don't depend on the detail response, and either may be cached —
  // so fire every fetch off up front and paint from cache when available.
  // Cached opens render instantly and refresh in the background.
  const cachedDet = cacheGet("det", id, DETAIL_TTL, detMem);
  const cachedChaps = cacheGet("chap", id, CHAPTERS_TTL, chapMem);
  const detP = cachedDet ? null : mdx(`/manga/${id}`, { "includes[]": ["cover_art", "author", "artist"] });
  const chapP = cachedChaps ? null : fetchAllChapters(id);

  let title = "", cover = "";

  const renderDetail = (d) => {
    document.getElementById("mangaCover").src = d.cover || "";
    document.getElementById("mangaTitle").textContent = d.title;
    document.getElementById("mangaStatus").textContent = d.status;
    document.getElementById("mangaDesc").textContent = d.desc;
  };

  const finish = (chapters) => {
    currentManga = { id, title, cover, sources: { mdx: chapters, katana: [], weeb: [] } };
    rebuildChapters();
    augmentManga(title); // pull extra chapters from the scraper sources
    updateSeriesDlUi();  // reflect any running/finished batch download

    downloadedChapterIds = new Set();
    fetch("/__manga/downloads").then(r => r.json()).then(d => {
      downloadedChapterIds = new Set((d[id] || []).map(c => c.chapterId));
      renderChapterList();
    }).catch(() => {});
  };

  try {
    // ---- detail (paints the header) ----
    if (cachedDet) {
      renderDetail(cachedDet);
      title = cachedDet.title;
      cover = cachedDet.cover;
      // background refresh — update the header if anything changed
      mdx(`/manga/${id}`, { "includes[]": ["cover_art", "author", "artist"] }).then(det => {
        const d = detFromData(det.data);
        cacheSet("det", id, d, detMem);
        if (currentManga && currentManga.id === id) renderDetail(d);
      }).catch(() => {});
    } else {
      const det = await detP;
      const d = detFromData(det.data);
      cacheSet("det", id, d, detMem);
      renderDetail(d);
      title = d.title;
      cover = d.cover;
    }

    // ---- chapters ----
    if (cachedChaps) {
      finish(cachedChaps);
      // background refresh — re-merge only if the chapter set actually changed
      fetchAllChapters(id).then(fresh => {
        cacheSet("chap", id, fresh, chapMem);
        const a = currentManga && currentManga.id === id ? currentManga.sources.mdx : null;
        if (a && (fresh.length !== a.length ||
                  (fresh[fresh.length - 1] || {}).id !== (a[a.length - 1] || {}).id)) {
          currentManga.sources.mdx = fresh;
          rebuildChapters();
        }
      }).catch(() => {});
    } else {
      const chapters = await chapP;
      cacheSet("chap", id, chapters, chapMem);
      finish(chapters);
    }
  } catch (e) {
    // Offline / network failure — rebuild the page from downloaded chapters
    // so the offline library is fully usable with no internet.
    let recovered = false;
    try {
      const d = await fetch("/__manga/downloads").then(r => r.json());
      const chs = (d[id] || []).slice().sort((a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0));
      if (chs.length) {
        recovered = true;
        title = chs[0].mangaTitle || "Manga";
        cover = `/__manga/cover/${id}`;
        document.getElementById("mangaCover").src = cover;
        document.getElementById("mangaTitle").textContent = title;
        document.getElementById("mangaStatus").textContent = "Offline · downloaded chapters";
        document.getElementById("mangaDesc").textContent = "";
        currentManga = {
          id, title, cover,
          sources: { mdx: chs.map(c => ({ source: "mdx", id: c.chapterId, number: c.number, title: c.title || "", volume: "", group: c.group || "Unknown" })), katana: [], weeb: [] },
        };
        downloadedChapterIds = new Set(currentManga.sources.mdx.map(c => c.id));
        rebuildChapters();
      }
    } catch { /* not even the local server — give up below */ }
    if (!recovered) {
      document.getElementById("chapterList").innerHTML =
        `<p style="color:var(--muted)">Couldn't load chapters (${e.message}).</p>`;
    }
  }
}

// Flatten a MangaDex detail response into the fields the header renders.
function detFromData(m) {
  let cover = mangaCover(m);
  if (cover) cover = cover.replace(".256.jpg", ".512.jpg");
  const author = ((m.relationships || []).find(r => r.type === "author") || {}).attributes;
  return {
    title: mangaTitle(m),
    cover,
    status: [m.attributes.year, cap(m.attributes.status || ""), author && author.name].filter(Boolean).join(" · "),
    desc: ((m.attributes.description && m.attributes.description.en) || "").slice(0, 600),
  };
}

// Run every source in parallel. The merge below prefers the FAST direct ones
// (MangaDex, MangaKatana); the slower WeebCentral scraper only fills chapters
// the fast sources lack — so the common case stays instant.
function augmentManga(title) {
  augmentWithKatana(title).catch(() => {});
  augmentWithWeeb(title).catch(() => {});
}

// Merge by chapter number, priority mdx > katana > weeb. MangaDex chapters
// prevail (they're the only ones offline-downloadable); other sources only
// fill chapter numbers MangaDex doesn't have.
function rebuildChapters() {
  const byNum = new Map();
  const order = [
    currentManga.sources.mdx,    // prevails: direct API + data-saver, downloadable
    currentManga.sources.katana, // fast: direct WebP, gap-filler
    currentManga.sources.weeb,
  ];
  for (const list of order) {
    for (const c of list) {
      const key = c.number != null ? String(c.number) : "oneshot:" + c.id;
      if (!byNum.has(key)) byNum.set(key, c);
    }
  }
  currentManga.chapters = [...byNum.values()]
    .sort((a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0));
  renderChapterList();
}

function renderChapterList() {
  const list = document.getElementById("chapterList");
  if (!currentManga.chapters.length) {
    list.innerHTML = `<p style="color:var(--muted)">No English chapters available.</p>`;
    return;
  }
  const r = mangaStore.reading[currentManga.id];
  list.innerHTML = currentManga.chapters.map((c, i) => {
    const active = r && r.chapterIndex === i ? " reading" : "";
    const badge = downloadedChapterIds.has(c.id)
      ? `<span class="chap-badge">Downloaded</span>`
      : c.source === "mdx" ? `<span class="chap-badge chap-badge-downloadable">Downloadable</span>` : "";
    return `<button class="chap-item${active}" onclick="openChapter(${i})">
        <span class="chap-name">${esc(chapLabel(c))}${badge}</span>
      </button>`;
  }).join("");
  document.getElementById("chapterSelect").innerHTML =
    currentManga.chapters.map((c, i) => `<option value="${i}">${esc(chapLabel(c))}</option>`).join("");
}

/* ---------- Series download (offline library) ---------- */
let seriesDlTimer = null;

// Reflect the batch-download state for the currently open manga onto the
// detail-view button; polls while a job is running.
async function updateSeriesDlUi() {
  if (!currentManga) return;
  const btn = document.getElementById("seriesDlBtn");
  const prog = document.getElementById("seriesDlProgress");
  const cancelBtn = document.getElementById("seriesDlCancelBtn");
  if (!btn) return;
  let job = null;
  try {
    job = await fetch(`/__manga/series-download/status?mangaId=${currentManga.id}`).then(r => r.json());
  } catch { return; }
  if (job && job.running && currentManga) {
    btn.textContent = "Downloading…";
    btn.disabled = true;
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    prog.textContent = `${job.done}/${job.total} chapters` +
      (job.failed ? ` · ${job.failed} failed` : "") +
      (job.error ? ` · error: ${job.error}` : "");
    clearTimeout(seriesDlTimer);
    seriesDlTimer = setTimeout(updateSeriesDlUi, 1000);
  } else {
    const wasRunning = btn.textContent === "Downloading…";
    btn.textContent = "Download Series";
    btn.disabled = false;
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (job && (job.done || job.skipped) && !job.cancel && !job.error) {
      prog.textContent = `Downloaded ${job.skipped || job.done}/${job.total} chapters` +
        (job.failed ? ` · ${job.failed} failed` : "");
    }
    if (wasRunning) refreshDownloadedBadges(); // job just finished
  }
}

function cancelSeriesDownload() {
  if (!currentManga) return;
  fetch("/__manga/series-download/cancel", {
    method: "POST",
    body: JSON.stringify({ mangaId: currentManga.id }),
  }).catch(() => {});
}

// Netflix-style "save the whole series": one background job on the local
// server stores every MangaDex chapter on disk; the app then reads them
// offline. Keep the app open until it finishes.
async function downloadSeries() {
  if (!currentManga) return;
  const n = currentManga.chapters.filter(c => c.source === "mdx" && !downloadedChapterIds.has(c.id)).length;
  if (!n) { alert("All chapters are already downloaded."); return; }
  if (!confirm(`Download all ${n} chapters of "${currentManga.title}" for offline reading?\n\nThey are stored in the app's data folder and readable with no internet. Keep FictionHub open until the download finishes.`)) return;
  try {
    const res = await fetch("/__manga/series-download", {
      method: "POST",
      body: JSON.stringify({ mangaId: currentManga.id, mangaTitle: currentManga.title, coverUrl: currentManga.cover || "" }),
    });
    if (!res.ok) throw new Error(await res.text());
    updateSeriesDlUi();
  } catch (e) {
    alert("Could not start download: " + e.message);
  }
}

// Re-pull the downloads index and refresh the chapter-list badges.
async function refreshDownloadedBadges() {
  if (!currentManga) return;
  try {
    const d = await fetch("/__manga/downloads").then(r => r.json());
    downloadedChapterIds = new Set((d[currentManga.id] || []).map(c => c.chapterId));
    renderChapterList();
    updateDownloadBtn();
  } catch {}
}

/* ---------- Reader ---------- */
async function openChapter(index) {
  if (!currentManga || index < 0 || index >= currentManga.chapters.length) return;
  currentChapterIndex = index;
  const ch = currentManga.chapters[index];
  document.getElementById("mangaDetail").classList.add("hidden");
  document.getElementById("mangaReader").classList.remove("hidden");
  document.getElementById("chapterSelect").value = index;
  window.scrollTo({ top: 0 });
  const pages = document.getElementById("readerPages");
  pages.innerHTML = `<div class="loader"></div>`;
  try {
    const cached = ch.source === "mdx"
      ? await fetch(`/__manga/check?mangaId=${currentManga.id}&chapterId=${ch.id}`).then(r => r.json()).catch(() => ({ downloaded: false }))
      : { downloaded: false };
    currentChapterDownloaded = !!cached.downloaded;
    if (cached.downloaded) {
      mdxPageData = null;
      pageUrls = Array.from({ length: cached.pageCount }, (_, i) =>
        `/__manga/page?mangaId=${currentManga.id}&chapterId=${ch.id}&page=${i}`);
    } else if (ch.source === "katana") {
      mdxPageData = null;
      pageUrls = await katanaPages(ch.id);
    } else if (ch.source === "weeb") {
      mdxPageData = null;
      pageUrls = await weebPages(ch.id);
    } else {
      const at = await mdx(`/at-home/server/${ch.id}`);
      mdxPageData = { baseUrl: at.baseUrl, hash: at.chapter.hash, data: at.chapter.data, dataSaver: at.chapter.dataSaver };
      buildMdxPages();
    }
    renderPages();
    updateDownloadBtn();
    saveReading();
    preloadNextChapter();
  } catch (e) {
    pages.innerHTML = `<p style="color:var(--muted); padding:30px">Couldn't load pages (${e.message}). Try the next chapter.</p>`;
  }
}

// Build MangaDex page URLs at the current quality (data-saver ≈ half the bytes).
function buildMdxPages() {
  if (!mdxPageData) return;
  const useSaver = readerQuality === "saver" && mdxPageData.dataSaver && mdxPageData.dataSaver.length;
  const files = useSaver ? mdxPageData.dataSaver : mdxPageData.data;
  const dir = useSaver ? "data-saver" : "data";
  pageUrls = files.map(f => `${mdxPageData.baseUrl}/${dir}/${mdxPageData.hash}/${f}`);
}

function updateQualityBtn() {
  const b = document.getElementById("qualityBtn");
  if (!b) return;
  b.textContent = readerQuality === "saver" ? "Data Saver" : "HD";
  b.classList.toggle("hidden", !mdxPageData); // WeebCentral has only one quality
}

function updateDownloadBtn() {
  const b = document.getElementById("downloadBtn");
  if (!b) return;
  const ch = currentManga && currentManga.chapters[currentChapterIndex];
  const isMdx = ch && ch.source === "mdx";
  b.classList.toggle("hidden", !isMdx);
  b.disabled = currentChapterDownloaded;
  b.textContent = currentChapterDownloaded ? "Downloaded" : "Download";
}

// Download the currently-open MangaDex chapter for offline reading. Uses the
// already-fetched mdxPageData (full-quality "data" set, not data-saver) — must
// POST promptly since MangaDex at-home URLs are short-lived tokens.
async function downloadCurrentChapter() {
  const ch = currentManga && currentManga.chapters[currentChapterIndex];
  if (!ch || ch.source !== "mdx" || !mdxPageData || currentChapterDownloaded) return;
  const btn = document.getElementById("downloadBtn");
  btn.disabled = true;
  btn.textContent = "Downloading…";
  const pages = mdxPageData.data.map(f => `${mdxPageData.baseUrl}/data/${mdxPageData.hash}/${f}`);
  try {
    const res = await fetch("/__manga/download", {
      method: "POST",
      body: JSON.stringify({
        mangaId: currentManga.id,
        chapterId: ch.id,
        pages,
        coverUrl: currentManga.cover || "",
        meta: { mangaTitle: currentManga.title, number: ch.number, title: ch.title, group: chapGroup(ch) },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    currentChapterDownloaded = true;
    downloadedChapterIds.add(ch.id);
    updateDownloadBtn();
    renderChapterList();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Download";
    alert("Download failed: " + e.message);
  }
}

/* ---------- Manage downloads (Settings) ---------- */
async function renderDownloadsList() {
  const wrap = document.getElementById("downloadsList");
  if (!wrap) return;
  wrap.innerHTML = `<p class="hint">Loading…</p>`;
  let downloads;
  try { downloads = await fetch("/__manga/downloads").then(r => r.json()); } catch { downloads = {}; }
  const mangaIds = Object.keys(downloads);
  if (!mangaIds.length) {
    wrap.innerHTML = `<p class="hint">No downloaded chapters yet. Downloads are stored locally and not auto-deleted.</p>`;
    return;
  }
  wrap.innerHTML = mangaIds.map(mangaId => {
    const chapters = downloads[mangaId];
    const title = esc(chapters[0].mangaTitle || mangaId);
    const rows = chapters
      .sort((a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0))
      .map(c => `
        <div class="download-row">
          <span>${esc(chapLabel(c))}</span>
          <button class="rbtn" onclick="deleteDownload('${mangaId}','${c.chapterId}')">Delete</button>
        </div>`).join("");
    return `
      <div class="download-manga">
        <div class="download-row download-manga-head">
          <strong>${title}</strong>
          <button class="rbtn" onclick="deleteDownload('${mangaId}')">Delete all</button>
        </div>
        ${rows}
      </div>`;
  }).join("");
}

async function deleteDownload(mangaId, chapterId) {
  await fetch("/__manga/delete", { method: "POST", body: JSON.stringify({ mangaId, chapterId }) });
  renderDownloadsList();
  if (currentManga && currentManga.id === mangaId) {
    currentChapterDownloaded = false;
    updateDownloadBtn();
    renderChapterList();
  }
}

function toggleQuality() {
  readerQuality = readerQuality === "saver" ? "hd" : "saver";
  settingsStore.readerPrefs = { mode: readerMode, quality: readerQuality, direction: readerDirection };
  if (mdxPageData) {
    const at = currentPage;
    buildMdxPages();
    renderPages();
    if (readerMode === "paged") showPage(Math.min(at, pageUrls.length - 1));
  }
  updateQualityBtn();
}

function renderPages() {
  const wrap = document.getElementById("readerPages");
  document.getElementById("modeBtn").textContent = readerMode === "strip" ? "Paged View" : "Long Strip";
  updateQualityBtn();
  if (readerMode === "strip") {
    // eager load (no lazy) so pages stream in ahead of the scroll
    wrap.className = "reader-pages strip";
    wrap.innerHTML = pageUrls.map((u, i) =>
      `<img referrerpolicy="no-referrer" src="${u}" data-orig="${u}" alt="Page ${i + 1}" onerror="imgProxyFallback(this)">`).join("");
  } else {
    wrap.className = "reader-pages paged";
    currentPage = 0;
    wrap.innerHTML = `<img id="pageImg" referrerpolicy="no-referrer" src="${pageUrls[0]}" data-orig="${pageUrls[0]}" alt="Page 1" onclick="readerClick(event)" onerror="imgProxyFallback(this)"><div class="page-count" id="pageCount"></div>`;
    updatePageCount();
    preloadAround(0);
  }
  wrap.scrollTop = 0;
}

// Warm the browser cache for the next few pages so flipping is instant.
function preloadAround(i) {
  for (let k = i + 1; k <= i + 3 && k < pageUrls.length; k++) {
    const im = new Image();
    im.referrerPolicy = "no-referrer";
    im.src = pageUrls[k];
  }
}

// Prefetch the next chapter's first page (MangaDex only — one cheap request).
async function preloadNextChapter() {
  const next = currentManga && currentManga.chapters[currentChapterIndex + 1];
  if (!next || next.source !== "mdx") return;
  try {
    const at = await mdx(`/at-home/server/${next.id}`);
    // Warm the cache from uploads.mangadex.org, not the assigned MD@H node —
    // nodes are sometimes broken (HTTP 200 + truncated image), and a warmed
    // broken response would just guarantee a failed load later.
    const saver = readerQuality === "saver" && at.chapter.dataSaver && at.chapter.dataSaver.length;
    const f = (saver ? at.chapter.dataSaver : at.chapter.data)[0];
    if (f) { const im = new Image(); im.referrerPolicy = "no-referrer"; im.src = `https://uploads.mangadex.org/${saver ? "data-saver" : "data"}/${at.chapter.hash}/${f}`; }
  } catch { /* best effort */ }
}

// A page image failed to load. Retry chain, one step per onerror:
//   1. MangaDex@Home node → uploads.mangadex.org. Nodes are community servers
//      and a broken one can serve a whole region HTTP 200s with truncated,
//      undecodable JPEGs (placeholder + alt text in the reader). uploads
//      mirrors the exact same /data and /data-saver paths, same filenames.
//   2. Still failing (e.g. host Referer check on katana/weeb images) → once
//      through the local proxy, which sends the right Referer server-side.
function imgProxyFallback(img) {
  const orig = img.dataset.orig || img.src;
  if (orig.startsWith(PROXY)) return; // proxy already failed; give up
  const stage = +(img.dataset.retry || 0);
  const isNodeUrl = /^https?:\/\/[^/]+\/data(-saver)?\//.test(orig) &&
                    !orig.startsWith("https://uploads.mangadex.org/");
  if (stage === 0 && isNodeUrl) {
    img.dataset.retry = "1";
    img.src = orig.replace(/^https?:\/\/[^/]+/, "https://uploads.mangadex.org");
    return;
  }
  img.dataset.retry = "2";
  img.src = viaProxy(stage >= 1 ? img.src : orig);
}

function updatePageCount() {
  const el = document.getElementById("pageCount");
  if (el) el.textContent = `${currentPage + 1} / ${pageUrls.length}`;
}

function showPage(i) {
  if (i < 0) { if (currentChapterIndex > 0) openChapter(currentChapterIndex - 1); return; }
  if (i >= pageUrls.length) { nextChapter(); return; }
  currentPage = i;
  const img = document.getElementById("pageImg");
  img.dataset.orig = pageUrls[i];
  delete img.dataset.retry; // allow the upload-host/proxy fallback for the new page
  img.src = pageUrls[i];
  updatePageCount();
  preloadAround(i);
  document.getElementById("readerPages").scrollTop = 0;
}

function readerClick(e) {
  if (readerMode !== "paged") return;
  const img = e.currentTarget;
  const x = e.clientX - img.getBoundingClientRect().left;
  const forward = x > img.clientWidth / 2;
  const next = readerDirection === "rtl" ? !forward : forward;
  showPage(currentPage + (next ? 1 : -1));
}

function toggleMode() {
  readerMode = readerMode === "strip" ? "paged" : "strip";
  settingsStore.readerPrefs = { mode: readerMode, quality: readerQuality, direction: readerDirection };
  renderPages();
}
function prevChapter() { openChapter(currentChapterIndex - 1); }
function nextChapter() { openChapter(currentChapterIndex + 1); }
function jumpChapter(v) { openChapter(+v); }

function backToDetail() {
  document.getElementById("mangaReader").classList.add("hidden");
  document.getElementById("mangaDetail").classList.remove("hidden");
  window.scrollTo({ top: 0 });
}
// Top "‹ Back" button: from the reader go to the chapter list; from the
// detail page go back to browsing.
function mangaBack() {
  if (!document.getElementById("mangaReader").classList.contains("hidden")) backToDetail();
  else closeManga();
}
function closeManga() {
  document.getElementById("readerPages").innerHTML = "";
  pageUrls = [];
  exitToBrowse();
}

function saveReading() {
  if (!currentManga) return;
  const ch = currentManga.chapters[currentChapterIndex];
  const r = mangaStore.reading;
  r[currentManga.id] = {
    id: currentManga.id,
    title: currentManga.title,
    cover: currentManga.cover,
    chapterIndex: currentChapterIndex,
    chapterNum: (ch && ch.number) || "?",
    total: currentManga.chapters.length,
    progress: ((currentChapterIndex + 1) / currentManga.chapters.length) * 100,
    updated: Date.now(),
  };
  mangaStore.reading = r;
}

// WeebCentral fallback source
// No API — scrapes HTML/HTMX. All requests go through the app's own local
// server (see viaProxy), which is same-origin and injects the HX-Request
// header + weebcentral Referer that a browser can't set cross-origin. No
// external CORS proxy and no configuration are needed. Images load via <img>
// through the same proxy when the host blocks hotlinking.
const WEEB = "https://weebcentral.com";

async function weebGet(url, { method = "GET", body = null } = {}) {
  const res = await fetch(viaProxy(url), {
    method,
    body,
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error("weeb-" + res.status);
  return res.text();
}

function parseHTML(html) { return new DOMParser().parseFromString(html, "text/html"); }
function normTitle(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

// Strict title match for cross-source linking. Exact (normalized) wins; otherwise
// one title must FULLY contain the other AND the shorter must be ≥60% of the
// longer — this blocks "shares one word" and arbitrary-first-result mis-links.
function titleMatch(a, b) {
  a = normTitle(a); b = normTitle(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length >= long.length * 0.6;
}

async function weebSearch(title) {
  const html = await weebGet(`${WEEB}/search/simple?location=main`,
    { method: "POST", body: `text=${encodeURIComponent(title)}` });
  const doc = parseHTML(html);
  return [...doc.querySelectorAll('a[href*="/series/"]')].map(a => {
    const m = (a.getAttribute("href") || "").match(/\/series\/([^/]+)\/?([^/?#]*)/);
    if (!m) return null;
    return { id: m[1], slug: m[2] || "", title: a.textContent.trim() };
  }).filter(Boolean);
}

function pickWeebMatch(results, title) {
  return results.find(r => titleMatch(r.title, title)) || null;
}

async function weebChapters(seriesId) {
  const html = await weebGet(`${WEEB}/series/${seriesId}/full-chapter-list`);
  const doc = parseHTML(html);
  return [...doc.querySelectorAll('a[href*="/chapters/"]')].map(a => {
    const m = (a.getAttribute("href") || "").match(/\/chapters\/([^/?#]+)/);
    if (!m) return null;
    const text = a.textContent.replace(/\s+/g, " ").trim();
    const num = (text.match(/(\d+(?:\.\d+)?)/) || [])[1] || null;
    return { source: "weeb", id: m[1], number: num, title: "", volume: "", group: "WeebCentral" };
  }).filter(c => c && c.number);
}

async function weebPages(chapterId) {
  const html = await weebGet(`${WEEB}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`);
  const doc = parseHTML(html);
  // Return RAW image URLs (planeptune.us). The reader tries them directly first
  // (fast); if the host's Referer check blocks one, onerror swaps to the proxy.
  return [...doc.querySelectorAll("img")]
    .map(i => i.getAttribute("src"))
    .filter(s => s && /^https?:/.test(s));
}

// Search WeebCentral for the same series and feed its chapters into the merge.
async function augmentWithWeeb(title) {
  const myId = currentManga && currentManga.id;
  const results = await weebSearch(title);
  const match = pickWeebMatch(results, title);
  if (!match) return;
  const weebChs = await weebChapters(match.id);
  if (!weebChs.length || !currentManga || currentManga.id !== myId) return; // still same manga?
  currentManga.sources.weeb = weebChs;
  rebuildChapters();
}

/* ================= MangaKatana — in-browser fallback =================
   No API — plain HTML. Reachable through the Worker. Fast WebP images on
   i{N}.mangakatana.com, listed in a `var ytaw=[...]` array on the chapter page. */
const KATANA = "https://mangakatana.com";

async function katanaGet(url) {
  const res = await fetch(viaProxy(url), { cache: "no-store" });
  if (!res.ok) throw new Error("katana-" + res.status);
  return res.text();
}

async function katanaSearch(title) {
  const html = await katanaGet(`${KATANA}/?search=${encodeURIComponent(title)}&search_by=book_name`);
  const doc = parseHTML(html);
  // results list: <a href="https://mangakatana.com/manga/{slug}.{id}"> with an <h3>
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="/manga/"]')) {
    const href = a.getAttribute("href") || "";
    if (!/\/manga\/[^/]+\.\d+$/.test(href) || seen.has(href)) continue; // series links only
    seen.add(href);
    const h3 = a.querySelector("h3");
    out.push({ url: href, title: (h3 ? h3.textContent : a.textContent).trim() });
  }
  // single exact match → MangaKatana 302s straight to the series page (no list)
  if (!out.length && /\/manga\/[^/]+\.\d+/.test(html)) {
    const m = html.match(/https?:\/\/mangakatana\.com\/manga\/[^/"']+\.\d+/);
    const t = (doc.querySelector("h1.heading, h1") || {}).textContent || title;
    if (m) out.push({ url: m[0], title: t.trim(), _isDetail: true, _html: html });
  }
  return out;
}

function katanaChapters(html, mangaUrl) {
  const doc = parseHTML(html);
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="/c"]')) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/\/manga\/[^/]+\.\d+\/c([\d.]+)/i);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ source: "katana", id: href, number: m[1], title: a.textContent.replace(/\s+/g, " ").trim().slice(0, 80), volume: "", group: "MangaKatana" });
  }
  return out;
}

async function katanaPages(chapterUrl) {
  const html = await katanaGet(chapterUrl);
  // Pages live in JS arrays — one is a 1-page preview (ytaw), another is the
  // full chapter (thzq). Names vary, so scan every array of quoted image URLs
  // and keep the longest set.
  let best = [];
  for (const m of html.matchAll(/=\s*\[([\s\S]*?)\]/g)) {
    const urls = [...m[1].matchAll(/['"](https?:\/\/[^'"]+?\.(?:jpe?g|png|webp|gif)[^'"]*)['"]/gi)]
      .map(x => x[1]);
    if (urls.length > best.length) best = urls;
  }
  if (!best.length) throw new Error("no-pages");
  return best;
}

function pickKatanaMatch(results, title) {
  // strict only — NO arbitrary first-result fallback (that caused unrelated
  // manga to share the same wrong chapters)
  return results.find(r => titleMatch(r.title, title)) || null;
}

// MangaKatana is primary: search it, pull its chapter list, feed it to the merge.
async function augmentWithKatana(title) {
  const myId = currentManga && currentManga.id;
  const results = await katanaSearch(title);
  const match = pickKatanaMatch(results, title);
  if (!match || !currentManga || currentManga.id !== myId) return;
  const html = match._isDetail ? match._html : await katanaGet(match.url);
  if (!currentManga || currentManga.id !== myId) return; // manga changed during fetch
  const chs = katanaChapters(html, match.url);
  if (!chs.length) return;
  currentManga.sources.katana = chs;
  rebuildChapters();
}

/* ---------- Keyboard nav (paged mode only) ---------- */
document.addEventListener("keydown", (e) => {
  const view = document.getElementById("mangaView");
  if (view.classList.contains("hidden")) return;
  if (document.getElementById("mangaReader").classList.contains("hidden")) return;
  if (readerMode !== "paged") return;
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); showPage(currentPage + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); showPage(currentPage - 1); }
});
