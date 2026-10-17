/* ===== Vidflix — movie/TV streaming UI on the Vidking embed API ===== */

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w300";
const BACKDROP = "https://image.tmdb.org/t/p/original";

// Multiple embed providers — all keyed by TMDB id. If one has "no source
// available", the user switches to the next. Atlantic is default (its own
// hls-based player with built-in subtitles, hosted on its own CDN); the rest
// are fallbacks.
const SOURCES = [
  {
    // Our own hls.js player fed by the main-process stream resolver
    // (hidden window harvests Atlantic's m3u8; playback goes through the
    // local /__stream proxy). Exact Continue Watching + no ad networks.
    name: "Native",
    tracks: true,
    native: true,
    movie: () => "", // URL is produced by the resolver, not built here
    tv: () => "",
  },
  {
    // Atlantic's own embed — bare player page, no third-party embed layer.
    // Verified working: streams from their hls.lol CDN with captions.
    name: "Atlantic",
    movie: (id) => `https://atlantic.st/embed/movie/${id}`,
    tv: (id, s, e) => `https://atlantic.st/embed/tv/${id}/${s}/${e}`,
  },
  {
    // TouStream's OFFICIAL embed API (toustream.xyz/api) — their raw streams
    // are scrape-gated (operator asks for Discord partnership instead), but
    // embedding is explicitly offered. Their page solves its own Turnstile.
    name: "TouStream",
    movie: (id) => `https://toustream.xyz/tou/movies/${id}`,
    tv: (id, s, e) => `https://toustream.xyz/tou/tv/${id}/${s}/${e}`,
  },
  {
    // Low-ad community favorite; emits MEDIA_DATA progress events
    name: "VidLink",
    tracks: true,
    movie: (id) => `https://vidlink.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
  },
  {
    name: "Vidfast",
    movie: (id) => `https://vidfast.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}`,
  },
  {
    name: "VidRock",
    movie: (id) => `https://vidrock.net/movie/${id}`,
    tv: (id, s, e) => `https://vidrock.net/tv/${id}/${s}/${e}`,
  },
  {
    name: "VidZee",
    movie: (id) => `https://player.vidzee.wtf/embed/movie/${id}`,
    tv: (id, s, e) => `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}`,
  },
  {
    // Query-param embed API — strong anime coverage alongside movies/TV
    name: "RiveStream",
    movie: (id) => `https://rivestream.ru/embed?type=movie&id=${id}`,
    tv: (id, s, e) => `https://rivestream.ru/embed?type=tv&id=${id}&season=${s}&episode=${e}`,
  },
  {
    name: "ScreenScape",
    movie: (id) => `https://screenscape.me/embed?tmdb=${id}&type=movie`,
    tv: (id, s, e) => `https://screenscape.me/embed?tmdb=${id}&type=tv&s=${s}&e=${e}&lan=eng`,
  },
  {
    // Supports ?progress= resume + nextEpisode/episodeSelector, but has been
    // unreachable at times — kept as a fallback rather than the default
    name: "Vidking",
    tracks: true, // emits PLAYER_EVENT progress; used for the failover detector
    resume: (url, secs) => `${url}&progress=${secs}`, // jump back to saved position
    movie: (id, c, a) => `https://www.vidking.net/embed/movie/${id}?color=${c}&autoPlay=${a}`,
    tv: (id, s, e, c, a) => `https://www.vidking.net/embed/tv/${id}/${s}/${e}?color=${c}&autoPlay=${a}&nextEpisode=true&episodeSelector=true`,
  },
  {
    // vidsrc-style mirror, low-ad
    name: "Nontongo",
    movie: (id) => `https://www.nontongo.win/embed/movie/${id}`,
    tv: (id, s, e) => `https://www.nontongo.win/embed/tv/${id}/${s}/${e}`,
  },
  {
    name: "AutoEmbed",
    movie: (id) => `https://autoembed.co/movie/tmdb/${id}`,
    tv: (id, s, e) => `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`,
  },
  {
    name: "AnyEmbed",
    movie: (id) => `https://anyembed.xyz/embed/tmdb-movie-${id}`,
    tv: (id, s, e) => `https://anyembed.xyz/embed/tmdb-tv-${id}-${s}-${e}`,
  },
  {
    // Last resort — reliable uptime but heavier on ads than the others
    name: "MultiEmbed",
    movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
    tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
  {
    // Anime-only — AniList-keyed Rive embed, shown only when playing anime.
    // AniList numbers episodes continuously across seasons, so use the
    // absolute episode number (computed in loadEpisodes) when we know it.
    name: "Rive Anime",
    animeOnly: true,
    animeUrl: async (m) => {
      const ani = await resolveAniListId(m.title, m.season);
      if (!ani) return null;
      return `https://rivestream.ru/embed?type=anime&id=${ani}&episode=${m.absEpisode || m.episode}`;
    },
  },
];

// Anime-specific embeds key off AniList ids, not TMDB. Resolve TMDB title →
// AniList id via the public GraphQL API (CORS-enabled, no key). Cached per
// session. Multi-season TMDB entries map to separate AniList entries, so for
// season > 1 the search string includes the season first.
const aniListCache = {};
async function resolveAniListId(title, season = 1) {
  const tries = season > 1 ? [`${title} Season ${season}`, `${title} ${season}`, title] : [title];
  for (const t of tries) {
    const key = t.toLowerCase().trim();
    if (!(key in aniListCache)) {
      try {
        const r = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            query: `query ($s: String) { Media(search: $s, type: ANIME) { id } }`,
            variables: { s: t },
          }),
        });
        const j = await r.json();
        aniListCache[key] = j?.data?.Media?.id || null;
      } catch {
        aniListCache[key] = null;
      }
    }
    if (aniListCache[key]) return aniListCache[key];
  }
  return null;
}
let sourceIndex = 0;
let failoverTimer = null;
let playbackStarted = false;
const FAILOVER_MS = 14000; // if Vidking sends no playback event in this time, try next source

// Default TMDB key, lightly obfuscated (reversed base64, split) so it isn't
// grep-able in source. NOTE: this is not real secrecy — a browser app must
// send the key to TMDB, so it's still visible in the Network tab. It only
// stops casual copy-paste and lets the site work with zero setup.
const _kp = ["=YGZmVmZwY", "mYwYmYwATO", "hV2NhNWN4g", "DOwYDZ0kjM", "0MGM"];
const DEFAULT_KEY = atob(_kp.join("").split("").reverse().join(""));

const store = {
  get key()       { return localStorage.getItem("tmdb_key") || DEFAULT_KEY; },
  set key(v)      { localStorage.setItem("tmdb_key", v); },
  // accent color belongs to the active profile
  get color()     { return getActiveProfile().color; },
  set color(v) {
    const list = ensureProfiles();
    const p = list.find(x => x.id === profileStore.activeId) || list[0];
    p.color = v;
    profileStore.list = list;
  },
  get autoplay()  { return localStorage.getItem("vk_autoplay") !== "false"; },
  set autoplay(v) { localStorage.setItem("vk_autoplay", v ? "true" : "false"); },
  // Continue Watching is per-profile
  get watching()  { return JSON.parse(localStorage.getItem(pkey("vk_watching")) || "{}"); },
  set watching(v) { localStorage.setItem(pkey("vk_watching"), JSON.stringify(v)); scheduleBackup(); },
  // Remembers which server actually had a given title, keyed by "type:id" —
  // so long-running shows (e.g. One Piece) don't need re-discovering on every
  // visit, which can take several manual server switches for later seasons.
  get lastServer() { return JSON.parse(localStorage.getItem(pkey("vk_lastserver")) || "{}"); },
  set lastServer(v) { localStorage.setItem(pkey("vk_lastserver"), JSON.stringify(v)); scheduleBackup(); },
};

// TMDB genre ids
const MOVIE_GENRES = [
  { id: 28, name: "Action" }, { id: 12, name: "Adventure" },
  { id: 35, name: "Comedy" }, { id: 27, name: "Horror" },
  { id: 878, name: "Sci-Fi" }, { id: 53, name: "Thriller" },
  { id: 18, name: "Drama" }, { id: 10749, name: "Romance" },
  { id: 14, name: "Fantasy" }, { id: 16, name: "Animation" },
  { id: 80, name: "Crime" }, { id: 9648, name: "Mystery" },
  { id: 10751, name: "Family" }, { id: 99, name: "Documentary" },
];
const TV_GENRES = [
  { id: 10759, name: "Action & Adventure" }, { id: 35, name: "Comedy" },
  { id: 18, name: "Drama" }, { id: 80, name: "Crime" },
  { id: 10765, name: "Sci-Fi & Fantasy" }, { id: 9648, name: "Mystery" },
  { id: 16, name: "Animation" }, { id: 10751, name: "Family" },
  { id: 99, name: "Documentary" }, { id: 10764, name: "Reality" },
];

let currentView = "home";
let searchTimer = null;
let activeMedia = null; // {type, id, title, season, episode, isAnime}
// "video" = TMDB iframe embeds (movies/TV/anime). The keyboard handler only
// applies source/episode shortcuts while a video watch view is open.
let watchMode = "video";

/* ---------- TMDB fetch ---------- */
async function tmdb(path, params = {}) {
  if (!store.key) throw new Error("no-key");
  const url = new URL(TMDB + path);
  url.searchParams.set("api_key", store.key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // always hit TMDB live so new episodes / releases appear on refresh
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("tmdb-" + res.status);
  return res.json();
}

/* ---------- Card rendering ---------- */
function mediaType(item) { return item.media_type || (item.title ? "movie" : "tv"); }
function titleOf(item)  { return item.title || item.name || "Untitled"; }
function yearOf(item)   { return (item.release_date || item.first_air_date || "").slice(0, 4); }

function cardHTML(item, opts) {
  const type = mediaType(item);
  if (type !== "movie" && type !== "tv") return "";
  const poster = item.poster_path ? IMG + item.poster_path : "";
  const rating = item.vote_average ? item.vote_average.toFixed(1) : "";
  const wkey = type + ":" + item.id;
  const w = store.watching[wkey];
  const prog = w && w.progress ? `<div class="progress-bar" style="width:${Math.min(w.progress,100)}%"></div>` : "";
  const img = poster
    ? `<img loading="lazy" src="${poster}" alt="">`
    : `<div style="height:258px"></div>`;
  const removeBtn = opts && opts.removable
    ? `<button class="card-remove" title="Remove" onclick='event.stopPropagation(); removeFromWatching("${type}", ${item.id})'>✕</button>`
    : "";
  return `<div class="card" onclick='openFromData(${JSON.stringify({id:item.id,type})})'>
      <div class="poster">
        ${removeBtn}
        ${rating ? `<div class="badge">★ ${rating}</div>` : ""}
        ${img}
        <div class="overlay"><div class="play-icon">▶</div></div>
        ${prog}
      </div>
      <div class="meta"><div class="t">${titleOf(item)}</div><div class="y">${yearOf(item)} · ${type === "movie" ? "Movie" : "TV"}</div></div>
    </div>`;
}

function rowHTML(title, items, opts) {
  const cards = items.map(item => cardHTML(item, opts)).join("");
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

function scrollRow(btn, dir) {
  const scroller = btn.parentElement.querySelector(".row-scroll");
  scroller.scrollBy({ left: dir * scroller.clientWidth * 0.85, behavior: "smooth" });
}

/* ---------- Infinite scroll (walks the entire TMDB catalog) ---------- */
let inf = { busy: false, page: 1, totalPages: 1, fetcher: null, grid: null, seen: null };
const infObserver = new IntersectionObserver(onSentinel, { rootMargin: "800px" });

function teardownInfinite() {
  infObserver.disconnect();
  document.getElementById("infSentinel")?.remove();
  inf = { busy: false, page: 1, totalPages: 1, fetcher: null, grid: null, seen: null };
}

// fetcher(page) must return a TMDB list response ({ results, total_pages }).
function initInfinite(gridEl, fetcher) {
  teardownInfinite();
  inf = { busy: false, page: 1, totalPages: 1, fetcher, grid: gridEl, seen: new Set() };
  const sentinel = document.createElement("div");
  sentinel.id = "infSentinel";
  sentinel.className = "inf-sentinel";
  gridEl.after(sentinel);
  infObserver.observe(sentinel);
}

async function onSentinel(entries) {
  if (!entries[0].isIntersecting || inf.busy || !inf.fetcher) return;
  if (inf.page > inf.totalPages) { document.getElementById("infSentinel")?.remove(); return; }
  inf.busy = true;
  const sentinel = document.getElementById("infSentinel");
  if (sentinel) sentinel.classList.add("loading");
  try {
    const data = await inf.fetcher(inf.page);
    inf.totalPages = Math.min(data.total_pages || 1, 500); // TMDB caps paging at 500
    const cards = (data.results || [])
      .filter(r => ["movie", "tv"].includes(mediaType(r)) && r.poster_path)
      .filter(r => { const k = mediaType(r) + ":" + r.id; if (inf.seen.has(k)) return false; inf.seen.add(k); return true; })
      .map(cardHTML).join("");
    if (cards) inf.grid.insertAdjacentHTML("beforeend", cards);
    inf.page++;
  } catch { /* ignore a failed page */ }
  inf.busy = false;
  if (sentinel) {
    sentinel.classList.remove("loading");
    // re-arm so it fires again if still in view (e.g. tall screens)
    infObserver.unobserve(sentinel);
    if (inf.page <= inf.totalPages) infObserver.observe(sentinel); else sentinel.remove();
  }
}

// builds a "Browse All" grid section and starts infinite paging into it
function appendBrowseAll(container, label, fetcher) {
  const section = document.createElement("section");
  section.className = "row";
  section.innerHTML = `<div class="row-head"><h2>Browse All ${label}</h2></div><div class="grid browse-grid"></div>`;
  container.appendChild(section);
  initInfinite(section.querySelector(".grid"), fetcher);
}

/* ---------- Skeleton loading ---------- */
function skeletonHTML(rows = 4) {
  const card = `<div class="skel-card shimmer"></div>`;
  const cards = card.repeat(8);
  const row = `<div class="skel-row"><div class="bar shimmer"></div><div class="skel-cards">${cards}</div></div>`;
  return row.repeat(rows);
}
function showSkeleton() {
  const rows = document.getElementById("rows");
  document.getElementById("grid").classList.add("hidden");
  rows.classList.remove("hidden");
  rows.innerHTML = skeletonHTML();
}

/* ---------- Views ---------- */
function setLoading(on) { document.getElementById("loader").classList.toggle("hidden", !on); }
function hideHero() { const h = document.getElementById("hero"); h.classList.add("hidden"); h.innerHTML = ""; clearInterval(heroTimer); }

/* ---------- Hero banner ---------- */
let heroItems = [];
let heroIndex = 0;
let heroTimer = null;

function renderHero(items) {
  heroItems = items.filter(i => i.backdrop_path && i.overview).slice(0, 6);
  if (!heroItems.length) return;
  heroIndex = 0;
  paintHero();
  clearInterval(heroTimer);
  heroTimer = setInterval(() => { heroIndex = (heroIndex + 1) % heroItems.length; paintHero(); }, 8000);
}

function paintHero() {
  const item = heroItems[heroIndex];
  const type = mediaType(item);
  const hero = document.getElementById("hero");
  hero.classList.remove("hidden");
  hero.style.backgroundImage = `url(${BACKDROP + item.backdrop_path})`;
  const dots = heroItems.map((_, i) =>
    `<span class="${i === heroIndex ? "on" : ""}" onclick="gotoHero(${i})"></span>`).join("");
  hero.innerHTML = `
    <div class="hero-content">
      <div class="hero-tag">${type === "movie" ? "Featured Movie" : "Featured Series"}</div>
      <h1>${titleOf(item)}</h1>
      <div class="hero-meta">
        ${item.vote_average ? `<span class="star">★ ${item.vote_average.toFixed(1)}</span>` : ""}
        <span>${yearOf(item) || ""}</span>
      </div>
      <p>${item.overview || ""}</p>
      <div class="hero-btns">
        <button class="btn btn-play" onclick='openFromData(${JSON.stringify({ id: item.id, type })})'>▶ Play</button>
        <button class="btn btn-ghost" onclick='openFromData(${JSON.stringify({ id: item.id, type })})'>ℹ More Info</button>
      </div>
    </div>
    <div class="hero-dots">${dots}</div>`;
}
function gotoHero(i) { heroIndex = i; paintHero(); clearInterval(heroTimer); heroTimer = setInterval(() => { heroIndex = (heroIndex + 1) % heroItems.length; paintHero(); }, 8000); }

async function renderHome() {
  const rows = document.getElementById("rows");
  showSkeleton();
  try {
    const [trend, popMovies, nowMovies, upMovies, topMovies, popTv, airTv, topTv] = await Promise.all([
      tmdb("/trending/all/week"),
      tmdb("/movie/popular"),
      tmdb("/movie/now_playing"),
      tmdb("/movie/upcoming"),
      tmdb("/movie/top_rated"),
      tmdb("/tv/popular"),
      tmdb("/tv/airing_today"),
      tmdb("/tv/top_rated"),
    ]);
    renderHero(trend.results);
    let html = "";
    html += continueRowHTML();
    html += rowHTML("Trending This Week", trend.results);
    html += rowHTML("Popular Movies", popMovies.results);
    html += rowHTML("Now Playing in Theaters", nowMovies.results);
    html += rowHTML("Popular TV Shows", popTv.results);
    html += rowHTML("Airing Today", airTv.results);
    html += rowHTML("Top Rated Movies", topMovies.results);
    html += rowHTML("Top Rated TV", topTv.results);
    html += rowHTML("Coming Soon", upMovies.results);
    const dlShelf = await renderVideoDownloadsShelf();
    rows.innerHTML = dlShelf + html;

    // genre rows appended progressively so the page paints fast
    appendGenreRows(rows, "movie", MOVIE_GENRES.slice(0, 6));
  } catch (e) {
    const dlShelf = await renderVideoDownloadsShelf().catch(() => "");
    handleErr(e);
    if (dlShelf) {
      const r = document.getElementById("rows");
      r.innerHTML = dlShelf + r.innerHTML;
    }
  }
}

async function appendGenreRows(container, type, genres) {
  for (const g of genres) {
    try {
      const data = await tmdb("/discover/" + type, {
        with_genres: g.id, sort_by: "popularity.desc", "vote_count.gte": 100,
      });
      const html = rowHTML(`${g.name} ${type === "movie" ? "Movies" : "Shows"}`, data.results);
      if (html) container.insertAdjacentHTML("beforeend", html);
    } catch { /* skip a failed genre */ }
  }
}

async function renderCategory(type) {
  const rows = document.getElementById("rows");
  hideHero();
  showSkeleton();
  try {
    const [pop, top, trend] = await Promise.all([
      tmdb(`/${type}/popular`),
      tmdb(`/${type}/top_rated`),
      tmdb(`/trending/${type}/week`),
    ]);
    renderHero(trend.results);
    let html = rowHTML("Trending", trend.results);
    html += rowHTML("Popular", pop.results);
    html += rowHTML("Top Rated", top.results);
    rows.innerHTML = html;
    await appendGenreRows(rows, type, type === "movie" ? MOVIE_GENRES : TV_GENRES);
    // browse the entire catalog for this type
    appendBrowseAll(rows, type === "movie" ? "Movies" : "TV Shows",
      (page) => tmdb("/discover/" + type, { sort_by: "popularity.desc", "vote_count.gte": 20, page }));
  } catch (e) { handleErr(e); }
}

async function renderAnime() {
  const rows = document.getElementById("rows");
  hideHero();
  showSkeleton();
  // anime = animation genre (16) + Japanese original language
  const animeTv = (p = {}) => tmdb("/discover/tv", { with_genres: 16, with_original_language: "ja", ...p });
  const animeMovie = (p = {}) => tmdb("/discover/movie", { with_genres: 16, with_original_language: "ja", ...p });
  try {
    const [popular, topRated, airing, movies, recent] = await Promise.all([
      animeTv({ sort_by: "popularity.desc", "vote_count.gte": 50 }),
      animeTv({ sort_by: "vote_average.desc", "vote_count.gte": 200 }),
      animeTv({ sort_by: "first_air_date.desc", "vote_count.gte": 20, "air_date.lte": new Date().toISOString().slice(0,10) }),
      animeMovie({ sort_by: "popularity.desc", "vote_count.gte": 50 }),
      animeMovie({ sort_by: "vote_average.desc", "vote_count.gte": 200 }),
    ]);
    let html = rowHTML("Popular Anime", popular.results);
    html += rowHTML("Top Rated Anime", topRated.results);
    html += rowHTML("Latest Episodes", airing.results);
    html += rowHTML("Anime Movies", movies.results);
    html += rowHTML("Acclaimed Anime Films", recent.results);
    rows.innerHTML = html;
    renderHero(popular.results);
    // browse every anime series in the catalog
    appendBrowseAll(rows, "Anime",
      (page) => tmdb("/discover/tv", { with_genres: 16, with_original_language: "ja", sort_by: "popularity.desc", "vote_count.gte": 10, page }));
  } catch (e) { handleErr(e); }
}

function continueRowHTML() {
  const w = store.watching;
  const items = Object.values(w)
    .sort((a, b) => b.updated - a.updated)
    .map(x => ({ id: x.id, media_type: x.type, title: x.title, poster_path: x.poster, vote_average: x.rating }));
  if (!items.length) return "";
  return rowHTML("Continue Watching", items, { removable: true });
}

function removeFromWatching(type, id) {
  const w = store.watching;
  delete w[type + ":" + id];
  store.watching = w;
  if (currentView === "home") renderHome();
  else if (currentView === "watching") renderWatching();
}

function renderWatching() {
  const rows = document.getElementById("rows");
  hideHero();
  document.getElementById("grid").classList.add("hidden");
  rows.classList.remove("hidden");
  const html = continueRowHTML();
  rows.innerHTML = html || `<p style="color:var(--muted); padding:40px 0">Nothing yet — start watching something!</p>`;
}

// Reset watch-view chrome for normal video playback (server tabs + hint).
function setWatchMode(mode) {
  watchMode = mode;
  document.getElementById("srcHint").classList.remove("hidden");
  document.getElementById("sourceTabs").classList.remove("hidden");
}

async function renderSearch(q) {
  const grid = document.getElementById("grid");
  hideHero();
  exitToBrowse();
  teardownInfinite();
  document.getElementById("rows").classList.add("hidden");
  grid.classList.remove("hidden");
  grid.innerHTML = "";
  setLoading(true);
  try {
    // probe first page so we can show a "no results" message
    const data = await tmdb("/search/multi", { query: q, include_adult: "false", page: 1 });
    const results = data.results.filter(r => ["movie", "tv"].includes(mediaType(r)) && r.poster_path);
    if (!results.length) {
      grid.innerHTML = `<p style="color:var(--muted)">No results for “${q}”.</p>`;
    } else {
      // page through every match
      initInfinite(grid, (page) => tmdb("/search/multi", { query: q, include_adult: "false", page }));
    }
  } catch (e) { handleErr(e); }
  setLoading(false);
}

function handleErr(e) {
  setLoading(false);
  if (e.message === "no-key") { showBanner(true); return; }
  document.getElementById("rows").innerHTML =
    `<p style="color:var(--muted)">Couldn't load data (${e.message}). Check your TMDB key in settings.</p>`;
}

function showBanner(on) { document.getElementById("setupBanner").classList.toggle("hidden", !on); }

/* ---------- Navigation ---------- */
function switchView(view) {
  currentView = view;
  teardownInfinite();
  if (typeof teardownMangaInfinite === "function") teardownMangaInfinite();
  exitToBrowse();
  document.getElementById("searchInput").value = "";
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo({ top: 0 });
  if (view === "home") renderHome();
  else if (view === "movie" || view === "tv") renderCategory(view);
  else if (view === "anime") renderAnime();
  else if (view === "manga") renderManga();
  else if (view === "downloads") renderVideoDownloadsView();
  else if (view === "watching") renderWatching();
  else if (view === "settings") renderSettingsView();
}
function goHome() { switchView("home"); }

/* ---------- Inline page navigation (no overlays) ---------- */
// Swap the browse surface for a full-window page (watch / manga), or back.
function enterPage(id) {
  document.getElementById("browse").classList.add("hidden");
  document.getElementById("watchView").classList.add("hidden");
  document.getElementById("mangaView").classList.add("hidden");
  document.getElementById("settingsView").classList.add("hidden");
  document.getElementById(id).classList.remove("hidden");
  window.scrollTo({ top: 0 });
}
function exitToBrowse() {
  // tear down whatever page was open
  if (typeof nativeClose === "function") nativeClose();
  const frame = document.getElementById("playerFrame");
  if (frame) frame.src = "";
  clearTimeout(failoverTimer);
  clearTimeout(videoDlTimer);
  document.getElementById("watchView").classList.add("hidden");
  document.getElementById("mangaView").classList.add("hidden");
  document.getElementById("settingsView").classList.add("hidden");
  document.getElementById("browse").classList.remove("hidden");
}
function pageOpen() {
  return !document.getElementById("watchView").classList.contains("hidden") ||
         !document.getElementById("mangaView").classList.contains("hidden") ||
         !document.getElementById("settingsView").classList.contains("hidden");
}

// Re-pull the catalog when the user comes back to the tab after a while,
// so newly released episodes / titles appear without a manual reload.
let lastLoaded = Date.now();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const stale = Date.now() - lastLoaded > 5 * 60 * 1000; // 5 min
  const searching = document.getElementById("searchInput").value.trim();
  if (stale && !pageOpen() && !searching) { lastLoaded = Date.now(); switchView(currentView); }
});

/* ---------- Player ---------- */
function openFromData(d) { openPlayer(d.type, d.id); }

async function openPlayer(type, id) {
  // start on whichever server last actually worked for this title, if any —
  // otherwise fall back to the user's preferred default server
  sourceIndex = store.lastServer[type + ":" + id] ?? settingsStore.playbackPrefs.preferredSourceIndex;
  if (!SOURCES[sourceIndex]) sourceIndex = 0; // stale index saved under an older source list
  activeMedia = { type, id, season: 1, episode: 1, isAnime: false };
  enterPage("watchView");
  setWatchMode("video"); // restore server tabs / hint
  document.getElementById("playerTitle").textContent = "Loading…";
  const picker = document.getElementById("episodePicker");

  // fetch details for title + (tv) seasons
  let title = "";
  try {
    const det = await tmdb(`/${type}/${id}`);
    title = titleOf(det);
    activeMedia.title = title;
    activeMedia.poster = det.poster_path;
    activeMedia.rating = det.vote_average;
    // anime = animation genre (16) + Japanese original — same rule as the
    // Anime browse view; anime-only sources exist just for these titles
    activeMedia.isAnime = type === "tv" &&
      (det.genres || []).some(g => g.id === 16) && det.original_language === "ja";
    activeMedia.seasons = det.seasons || [];
    if (type === "tv") {
      picker.classList.remove("hidden");
      const seasonSel = document.getElementById("seasonSelect");
      seasonSel.innerHTML = det.seasons
        .filter(s => s.season_number > 0 && s.episode_count > 0)
        .map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join("");
      // resume to last watched episode if available
      const w = store.watching[type + ":" + id];
      if (w && w.season) { seasonSel.value = w.season; activeMedia.season = w.season; activeMedia.episode = w.episode || 1; }
      await loadEpisodes(activeMedia.episode);
    } else {
      picker.classList.add("hidden");
      loadIframe();
    }
  } catch (e) {
    title = "";
    picker.classList.add("hidden");
    loadIframe();
  }
  document.getElementById("playerTitle").textContent = title;
}

async function loadEpisodes(preselect) {
  const season = +document.getElementById("seasonSelect").value;
  activeMedia.season = season;
  const epSel = document.getElementById("episodeSelect");
  try {
    const data = await tmdb(`/tv/${activeMedia.id}/season/${season}`);
    epSel.innerHTML = data.episodes
      .map(e => `<option value="${e.episode_number}">E${e.episode_number} · ${e.name}</option>`).join("");
  } catch {
    epSel.innerHTML = `<option value="1">Episode 1</option>`;
  }
  epSel.value = preselect || 1;
  activeMedia.episode = +epSel.value;
  // Absolute episode number across seasons — AniList-keyed anime embeds
  // number episodes continuously, while TMDB restarts per season
  activeMedia.absEpisode = activeMedia.episode + (activeMedia.seasons || [])
    .filter(s => s.season_number > 0 && s.season_number < activeMedia.season)
    .reduce((n, s) => n + (s.episode_count || 0), 0);
  loadIframe();
}

function playSelectedEpisode() {
  activeMedia.episode = +document.getElementById("episodeSelect").value;
  loadIframe();
}

// Step the episode <select> by ±1 within the current season (TV only).
function stepEpisode(delta) {
  const epSel = document.getElementById("episodeSelect");
  if (!activeMedia || activeMedia.type !== "tv" || !epSel.options.length) return;
  const next = epSel.selectedIndex + delta;
  if (next < 0 || next >= epSel.options.length) return;
  epSel.selectedIndex = next;
  playSelectedEpisode();
}
function playNextEpisode() { stepEpisode(1); }
function playPrevEpisode() { stepEpisode(-1); }

/* ---------- Video downloads (movies / series / anime) ---------- */
// "Your Downloads" shelf on the Home view (like the manga downloads shelf).
async function renderVideoDownloadsShelf() {
  await fetchVideoDownloads();
  const items = Object.values(videoDownloads);
  if (!items.length) return "";
  const cards = items.map(m => {
    const key = m.type === "tv" ? `tv-${m.id}-s${m.season}-e${m.episode}` : `movie-${m.id}`;
    const poster = m.poster ? IMG + m.poster : "";
    const img = poster ? `<img loading="lazy" src="${escHtml(poster)}" alt="">` : `<div style="height:258px"></div>`;
    const label = m.type === "tv" ? (m.anime ? "Anime" : "TV Show") : "Movie";
    const ep = m.type === "tv" ? `S${m.season || 1} E${m.episode || 1}` : "";
    return `<div class="card" onclick="event.stopPropagation(); playDownload('${escHtml(key)}')">
      <div class="poster">${img}<div class="overlay"><div class="play-icon">&#9654;</div></div><span class="dl-badge">${label}</span>${ep ? `<span class="dl-badge">${escHtml(ep)}</span>` : ""}</div>
      <div class="meta"><div class="t">${escHtml(m.title || "")}</div><div class="y">${label}</div></div>
    </div>`;
  }).join("");
  return `<section class="row">
    <div class="row-head"><h2>Your Downloads</h2><button class="btn btn-ghost" onclick="switchView('downloads')">View all</button></div>
    <div class="row-wrap"><button class="row-arrow left" onclick="scrollRow(this,-1)">&#8249;</button><div class="row-scroll">${cards}</div><button class="row-arrow right" onclick="scrollRow(this,1)">&#8250;</button></div></section>`;
}
// Downloads resolve through the same Native stream pipeline the player uses,
// then play back entirely from disk via the local server — no internet needed
// once downloaded. Stored under Documents/FictionHub/Video Downloads.
let videoDownloads = {};   // video key -> meta (from /__video/downloads)
let videoDlTimer = null;

function videoKey(type, id, season, episode) {
  return type === "tv" ? `tv-${id}-s${season}-e${episode}` : `movie-${id}`;
}
function videoSeasonKey(id, season) { return `tv-${id}-s${season}`; }

async function fetchVideoDownloads() {
  try {
    videoDownloads = await (await fetch("/__video/downloads")).json() || {};
  } catch { videoDownloads = {}; }
}

function videoIsDownloaded(key) { return !!videoDownloads[key]; }

function escHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

// Full video downloads library (its own view). Cards play the download in the
// native player, or delete it. Named apart from manga.js's renderDownloadsList
// (which manages manga chapters in Settings) since both are global.
async function renderVideoDownloadsView() {
  await fetchVideoDownloads();
  const rows = document.getElementById("rows");
  hideHero();
  document.getElementById("grid").classList.add("hidden");
  rows.classList.remove("hidden");
  const items = Object.values(videoDownloads)
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));
  const cards = items.map(downloadCardHTML).join("");
  rows.innerHTML = `<section class="row">
    <div class="row-head"><h2>Your Downloads</h2></div>
    <div class="row-wrap">
      <button class="row-arrow left" onclick="scrollRow(this,-1)">&#8249;</button>
      <div class="row-scroll">${cards}</div>
      <button class="row-arrow right" onclick="scrollRow(this,1)">&#8250;</button>
    </div>
  </section>${items.length ? "" : `<p style="color:var(--muted); padding:40px 0">No downloads yet. Open a movie, show or anime and tap Download.</p>`}`;
}

function downloadCardHTML(m) {
  const key = m.type === "tv" ? `tv-${m.id}-s${m.season}-e${m.episode}` : `movie-${m.id}`;
  const poster = m.poster ? IMG + m.poster : "";
  const label = m.type === "tv" ? (m.anime ? "Anime" : "TV Show") : "Movie";
  const ep = m.type === "tv" ? `Season ${m.season || 1} · Episode ${m.episode || 1}` : "";
  const img = poster
    ? `<img loading="lazy" src="${escHtml(poster)}" alt="">`
    : `<div style="height:258px"></div>`;
  return `<div class="card" onclick="event.stopPropagation(); playDownload('${escHtml(key)}')">
      <div class="poster">
        ${img}
        <div class="overlay"><div class="play-icon">&#9654;</div></div>
        <span class="dl-badge">${label}</span>${ep ? `<span class="dl-badge">${escHtml(ep)}</span>` : ""}
        <button class="dl-remove" onclick="event.stopPropagation(); deleteVideoDownload('${escHtml(key)}')">&#10005;</button>
      </div>
      <div class="meta"><div class="t">${escHtml(m.title || "")}</div><div class="y">${label}</div></div>
    </div>`;
}
function pollVideoDl() {
  clearTimeout(videoDlTimer);
  videoDlTimer = setTimeout(refreshVideoDlUi, 1000);
}

// Refresh the watch-view download bar for the current title/episode.
async function refreshVideoDlUi() {
  if (!activeMedia) return;
  await fetchVideoDownloads();
  const key = videoKey(activeMedia.type, activeMedia.id, activeMedia.season, activeMedia.episode);
  const skey = videoSeasonKey(activeMedia.id, activeMedia.season);
  const btn = document.getElementById("videoDlBtn");
  const seasonBtn = document.getElementById("videoSeasonDlBtn");
  const cancelBtn = document.getElementById("videoDlCancelBtn");
  const prog = document.getElementById("videoDlProgress");
  const bar = document.getElementById("videoDlBar");
  if (!btn || !bar) return;
  bar.classList.remove("hidden");
  if (seasonBtn) seasonBtn.classList.toggle("hidden", activeMedia.type !== "tv");

  let job = null, seasonJob = null;
  try { job = await fetch(`/__video/download/status?key=${encodeURIComponent(key)}`).then(r => r.json()); } catch { job = { running: false }; }
  if (activeMedia.type === "tv") {
    try { seasonJob = await fetch(`/__video/season-download/status?key=${encodeURIComponent(skey)}`).then(r => r.json()); } catch { seasonJob = null; }
  }

  const downloaded = videoIsDownloaded(key);
  if (seasonJob && seasonJob.running) {
    btn.textContent = downloaded ? "Play Download" : "Downloading…";
    btn.disabled = !downloaded;
    if (seasonBtn) { seasonBtn.textContent = "Downloading season…"; seasonBtn.disabled = true; }
    cancelBtn.classList.remove("hidden");
    prog.textContent = `Season ${activeMedia.season}: ${seasonJob.done}/${seasonJob.total || "?"} episodes`
      + (seasonJob.current ? ` · ${seasonJob.current}` : "")
      + (seasonJob.failed ? ` · ${seasonJob.failed} failed` : "")
      + (seasonJob.error ? ` · error: ${seasonJob.error}` : "");
    pollVideoDl();
    return;
  }
  if (job && job.running) {
    btn.textContent = "Downloading…";
    btn.disabled = true;
    if (seasonBtn) seasonBtn.disabled = true;
    cancelBtn.classList.remove("hidden");
    prog.textContent = `${job.done} / ${job.total || "?"} segments` + (job.error ? ` · error: ${job.error}` : "");
    pollVideoDl();
    return;
  }

  btn.textContent = downloaded ? "Play Download" : (activeMedia.type === "tv" ? "Download Episode" : "Download");
  btn.disabled = false;
  if (seasonBtn) { seasonBtn.textContent = "Download Season"; seasonBtn.disabled = false; }
  cancelBtn.classList.add("hidden");
  if (job && job.error) prog.textContent = "Download failed: " + job.error;
  else if (seasonJob && seasonJob.error) prog.textContent = "Season download failed: " + seasonJob.error;
  else if (downloaded) {
    const m = videoDownloads[key];
    prog.textContent = `Downloaded${m && m.segmentCount ? ` · ${m.segmentCount} segments` : ""}`;
  } else if (seasonJob && (seasonJob.done || seasonJob.skipped) && !seasonJob.cancel) {
    prog.textContent = `Season ${activeMedia.season}: ${seasonJob.skipped || seasonJob.done}/${seasonJob.total} episodes`
      + (seasonJob.failed ? ` · ${seasonJob.failed} failed` : "");
  } else prog.textContent = "";
}

function videoDlPayload() {
  return {
    type: activeMedia.type,
    id: activeMedia.id,
    title: activeMedia.title,
    season: activeMedia.season,
    episode: activeMedia.episode,
    poster: activeMedia.poster,
    rating: activeMedia.rating,
    anime: activeMedia.isAnime,
  };
}

async function downloadVideo() {
  if (!activeMedia) return;
  const key = videoKey(activeMedia.type, activeMedia.id, activeMedia.season, activeMedia.episode);
  if (videoIsDownloaded(key)) { playDownload(key); return; }
  const extra = activeMedia.type === "tv" ? ` (Season ${activeMedia.season} · Episode ${activeMedia.episode})` : "";
  if (!confirm(`Download “${activeMedia.title}”${extra}?\nThis saves the stream to Documents/FictionHub/Video Downloads so you can watch it offline.`)) return;
  try {
    const res = await fetch("/__video/download", { method: "POST", body: JSON.stringify(videoDlPayload()) });
    if (!res.ok) throw new Error(await res.text());
    await fetchVideoDownloads();
    refreshVideoDlUi();
  } catch (e) { alert("Could not start download: " + e.message); }
}

async function downloadVideoSeason() {
  if (!activeMedia || activeMedia.type !== "tv") return;
  const epSel = document.getElementById("episodeSelect");
  const episodes = epSel ? [...epSel.options].map(o => +o.value).filter(n => n > 0) : [];
  if (!episodes.length) { alert("No episodes listed for this season yet."); return; }
  const missing = episodes.filter(ep => !videoIsDownloaded(videoKey("tv", activeMedia.id, activeMedia.season, ep)));
  if (!missing.length) { alert("Every episode of this season is already downloaded."); return; }
  if (!confirm(`Download Season ${activeMedia.season} of “${activeMedia.title}” (${missing.length} episode${missing.length === 1 ? "" : "s"})?\nKeep FictionHub open until it finishes. Files go in Documents/FictionHub/Video Downloads.`)) return;
  try {
    const res = await fetch("/__video/season-download", {
      method: "POST",
      body: JSON.stringify({ ...videoDlPayload(), episodes: missing }),
    });
    if (!res.ok) throw new Error(await res.text());
    refreshVideoDlUi();
  } catch (e) { alert("Could not start season download: " + e.message); }
}

async function cancelVideoDownload() {
  if (!activeMedia) return;
  const key = videoKey(activeMedia.type, activeMedia.id, activeMedia.season, activeMedia.episode);
  const skey = videoSeasonKey(activeMedia.id, activeMedia.season);
  await fetch("/__video/download/cancel", { method: "POST", body: JSON.stringify({ key }) }).catch(() => {});
  if (activeMedia.type === "tv") {
    await fetch("/__video/season-download/cancel", { method: "POST", body: JSON.stringify({ key: skey }) }).catch(() => {});
  }
  refreshVideoDlUi();
}

async function playDownload(key) {
  if (!videoDownloads[key]) await fetchVideoDownloads();
  const m = videoDownloads[key];
  if (!m) return;
  activeMedia = {
    type: m.type, id: m.id, title: m.title,
    season: m.season || 1, episode: m.episode || 1,
    isAnime: !!m.anime, poster: m.poster, rating: m.rating,
  };
  enterPage("watchView");
  setWatchMode("video");
  document.getElementById("playerTitle").textContent = m.title;
  const picker = document.getElementById("episodePicker");
  if (m.type === "tv") {
    picker.classList.remove("hidden");
    const ss = document.getElementById("seasonSelect"), es = document.getElementById("episodeSelect");
    ss.innerHTML = `<option value="${m.season || 1}">Season ${m.season || 1}</option>`;
    es.innerHTML = `<option value="${m.episode || 1}">Episode ${m.episode || 1}</option>`;
  } else picker.classList.add("hidden");
  if (typeof nativePlayLocal === "function") nativePlayLocal(`/__video/playlist/${key}`);
  else alert("Local playback isn't available in this build.");
  refreshVideoDlUi();
}

async function deleteVideoDownload(key) {
  if (!confirm("Delete this download?")) return;
  await fetch("/__video/delete", { method: "POST", body: JSON.stringify({ key }) }).catch(() => {});
  await fetchVideoDownloads();
  refreshVideoDlUi();
  if (currentView === "downloads") renderVideoDownloadsView();
  else if (currentView === "home") renderHome();
}

function touchWatching() {
  if (!activeMedia || !activeMedia.title) return;
  const w = store.watching;
  const key = activeMedia.type + ":" + activeMedia.id;
  const prev = w[key];
  const epChanged = prev && activeMedia.type === "tv" &&
    (prev.season != activeMedia.season || prev.episode != activeMedia.episode);
  w[key] = {
    id: activeMedia.id,
    type: activeMedia.type,
    title: activeMedia.title,
    poster: activeMedia.poster,
    rating: activeMedia.rating,
    season: activeMedia.season,
    episode: activeMedia.episode,
    // real position kept unless the episode changed (then it belonged to another episode)
    progress: epChanged ? 0 : (prev && prev.progress) || 0,
    currentTime: epChanged ? 0 : (prev && prev.currentTime) || 0,
    duration: (prev && prev.duration) || 0,
    updated: Date.now(),
  };
  store.watching = w;
}

// Native tabs render our own player into #nativeStage instead of the iframe
function nativeActiveFor(src) { return !!(src && src.native); }

async function loadIframe() {
  const { type, id, season, episode } = activeMedia;
  let src = SOURCES[sourceIndex];
  if (!src || (src.animeOnly && !activeMedia.isAnime)) {
    // stale index saved under an older source list, or an anime-only server
    // remembered from a previous title — fall back to the first source
    sourceIndex = 0;
    src = SOURCES[0];
  }
  if (nativeActiveFor(src)) {
    touchWatching();    // native progress events arrive a few seconds in
    nativeClose();      // stop iframe playback + hide the native stage swap-in
    nativeOpen();
    renderSourceTabs();
    refreshVideoDlUi();
    return;
  }
  nativeClose();
  const color = store.color.replace("#", "");
  const auto = store.autoplay ? "true" : "false";
  touchWatching();
  let url;
  if (src.animeOnly) {
    // needs an async AniList lookup first; if the title can't be matched,
    // advance to the next server instead of showing a dead frame
    setFailoverNotice("Looking up anime on AniList…");
    url = await src.animeUrl(activeMedia);
    setFailoverNotice("");
    if (!url) {
      if (sourceIndex < SOURCES.length - 1) {
        setFailoverNotice("No AniList match — switched to next server.");
        switchSource(sourceIndex + 1);
      } else {
        setFailoverNotice("No source found on any server for this title.");
      }
      return;
    }
  } else {
    url = type === "movie"
      ? src.movie(id, color, auto)
      : src.tv(id, season, episode, color, auto);
  }
  // Cross-server resume: if we have a saved position for THIS exact title/episode
  // and the provider accepts a resume param, jump back to it — so progress
  // watched on one server carries over when switching to another.
  if (src.resume) {
    const w = store.watching[type + ":" + id];
    const sameEp = w && (type !== "tv" || (w.season == season && w.episode == episode));
    const secs = sameEp ? Math.floor(w.currentTime || 0) : 0;
    if (secs > 5) url = src.resume(url, secs);
  }
  // tell the main process which site the player iframe should be showing,
  // so it can block ad hijacks that navigate the whole iframe elsewhere
  window.fictionhub?.setEmbedHost(new URL(url).hostname);
  document.getElementById("playerFrame").src = url;
  renderSourceTabs();
  armFailover();
  refreshVideoDlUi();
}

// Only providers that emit progress events (VidLink MEDIA_DATA, Vidking
// PLAYER_EVENT) can be probed this way. If one loads but never starts
// (= "no source available"), silently advance to the next provider so the
// user isn't stuck.
function armFailover() {
  clearTimeout(failoverTimer);
  playbackStarted = false;
  setFailoverNotice("");
  if (!SOURCES[sourceIndex].tracks) return; // only the tracking server is detectable
  failoverTimer = setTimeout(() => {
    if (playbackStarted) return;
    if (sourceIndex < SOURCES.length - 1) {
      setFailoverNotice(`No source on Server ${sourceIndex + 1} — switched to Server ${sourceIndex + 2}.`);
      switchSource(sourceIndex + 1);
    } else {
      setFailoverNotice("No source found on any server for this title.");
    }
  }, FAILOVER_MS);
}

function setFailoverNotice(msg) {
  const el = document.getElementById("failoverNotice");
  if (el) { el.textContent = msg; el.classList.toggle("hidden", !msg); }
}

function renderSourceTabs() {
  const bar = document.getElementById("sourceTabs");
  bar.innerHTML = SOURCES.map((s, i) =>
    (s.animeOnly && !activeMedia?.isAnime) ? "" :
    `<button class="src-tab ${i === sourceIndex ? "active" : ""}" onclick="switchSource(${i})">Server ${i + 1}</button>`
  ).join("");
}

function switchSource(i) {
  sourceIndex = i;
  if (activeMedia) {
    const ls = store.lastServer;
    ls[activeMedia.type + ":" + activeMedia.id] = i;
    store.lastServer = ls;
  }
  loadIframe();
}

function closePlayer() {
  nativeClose(); // save final position + release the hls.js player
  activeMedia = null;
  exitToBrowse();
}

/* ---------- Cross-server progress tracking ----------
   Capture playback progress from ANY provider that emits postMessage events
   (Vidking PLAYER_EVENT, VidLink MEDIA_DATA, Videasy time/progress events, …)
   and fold it into one shared Continue Watching entry per title — so progress
   watched on one server carries across all servers. Pure-iframe providers that
   emit nothing simply can't contribute (no API to read). */
function num(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && !isNaN(n) ? n : null;
}
function normPct(p) { return p == null ? null : (p <= 1 ? p * 100 : p); } // accept 0–1 or 0–100

// Pull {currentTime, duration, progress%, season?, episode?} out of whatever
// shape a provider sends, or null if the message carries no usable progress.
function extractProgress(payload) {
  let d = payload.data != null ? payload.data : payload;

  // VidLink: { type:'MEDIA_DATA', data: { <id>: { progress:{watched,duration}, last_season_watched, last_episode_watched } } }
  if (payload.type === "MEDIA_DATA" && d && typeof d === "object") {
    const entry = d[activeMedia.id] || d[String(activeMedia.id)] || Object.values(d)[0];
    if (entry && entry.progress && typeof entry.progress === "object") {
      const watched = num(entry.progress.watched) || 0;
      const duration = num(entry.progress.duration) || 0;
      return {
        currentTime: watched, duration,
        progress: duration ? (watched / duration) * 100 : 0,
        season: num(entry.last_season_watched), episode: num(entry.last_episode_watched),
      };
    }
  }
  if (!d || typeof d !== "object") return null;

  // Time-based events (Vidking PLAYER_EVENT, AutoEmbed, etc.)
  let ct = num(d.currentTime ?? d.watched ?? d.time);
  const du = num(d.duration ?? d.totalDuration ?? d.runtime);
  // 'timestamp' is ambiguous (playback position vs unix epoch) — only trust it
  // when it's plausibly a position within the runtime
  if (ct == null) {
    const ts = num(d.timestamp);
    if (ts != null && (du ? ts <= du * 1.5 : ts < 100000)) ct = ts;
  }
  let pr = normPct(num(d.progress ?? d.percent ?? d.percentage));

  if (ct != null && ct > 0) {
    return { currentTime: ct, duration: du || 0, progress: du ? (ct / du) * 100 : (pr || 0),
             season: num(d.season), episode: num(d.episode) };
  }
  if (pr != null && pr > 0) {
    return { currentTime: 0, duration: du || 0, progress: pr,
             season: num(d.season), episode: num(d.episode) };
  }
  return null;
}

window.addEventListener("message", (e) => {
  if (!activeMedia) return;
  let payload = e.data;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return; } }
  if (!payload || typeof payload !== "object") return;

  const prog = extractProgress(payload);
  if (!prog) return;

  // any recognized progress event = this server found a source and is playing
  playbackStarted = true;
  clearTimeout(failoverTimer);
  setFailoverNotice("");

  const season = prog.season || activeMedia.season;
  const episode = prog.episode || activeMedia.episode;
  const key = activeMedia.type + ":" + activeMedia.id;
  const w = store.watching;
  const prev = w[key];

  // Ignore a reset-to-zero on (re)load so it doesn't wipe a real saved position
  // for the same episode (providers often emit progress:0 when the player boots).
  const sameEp = activeMedia.type !== "tv" || !prev || (prev.season == season && prev.episode == episode);
  if (prev && sameEp && (prog.currentTime || 0) < 2 && (prog.progress || 0) < 1 && (prev.progress || 0) > 1) return;

  w[key] = {
    id: activeMedia.id,
    type: activeMedia.type,
    title: activeMedia.title,
    poster: activeMedia.poster,
    rating: activeMedia.rating,
    season,
    episode,
    progress: prog.progress || (prev && sameEp ? prev.progress : 0) || 0,
    currentTime: prog.currentTime || (prev && sameEp ? prev.currentTime : 0) || 0,
    duration: prog.duration || (prev ? prev.duration : 0) || 0,
    updated: Date.now(),
  };
  store.watching = w;
});

/* ---------- Keyboard shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (!settingsStore.shortcutsEnabled) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === "Escape") { if (pageOpen()) exitToBrowse(); return; }

  const watchOpen = !document.getElementById("watchView").classList.contains("hidden");
  if (watchOpen && watchMode === "video") {
    if (e.key >= "1" && e.key <= "9") {
      const src = SOURCES[+e.key - 1];
      if (src && (!src.animeOnly || activeMedia.isAnime)) { switchSource(+e.key - 1); return; }
      return;
    }
    if (typeof nativeActive !== "undefined" && nativeActive) {
      // our own player owns the arrow keys (seeking) and space (play/pause)
      if (e.key === "ArrowRight") { nativeSeekBy(10); return; }
      if (e.key === "ArrowLeft") { nativeSeekBy(-10); return; }
      if (e.key === " ") { e.preventDefault(); nativeTogglePlay(); return; }
    }
    if (e.key === "ArrowRight") { playNextEpisode(); return; }
    if (e.key === "ArrowLeft") { playPrevEpisode(); return; }
  }

  if (!pageOpen()) {
    const map = { h: "home", m: "movie", t: "tv", a: "anime", n: "manga", d: "downloads", c: "watching" };
    if (map[e.key.toLowerCase()]) { switchView(map[e.key.toLowerCase()]); return; }
  }

  if (e.key === "/") { e.preventDefault(); document.getElementById("searchInput").focus(); }
});

/* ---------- Search ---------- */
document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (!q) { switchView(currentView === "watching" ? "home" : currentView); return; }
  searchTimer = setTimeout(() => {
    if (currentView === "manga") renderMangaSearch(q);
    else renderSearch(q);
  }, 350);
});

/* ---------- Settings ---------- */
function renderSettingsView() {
  enterPage("settingsView");

  // show only a user-supplied override (blank = using the built-in default key)
  document.getElementById("apiKeyInput").value = localStorage.getItem("tmdb_key") || "";
  document.getElementById("colorInput").value = store.color;
  document.getElementById("autoplayInput").checked = store.autoplay;

  selectThemeSwatch(settingsStore.theme, false);
  document.getElementById("shortcutsInput").checked = settingsStore.shortcutsEnabled;

  const reader = settingsStore.readerPrefs;
  document.getElementById("readerModeInput").value = reader.mode;
  document.getElementById("readerQualityInput").value = reader.quality;
  document.getElementById("readerDirectionInput").value = reader.direction;

  const serverSel = document.getElementById("preferredServerInput");
  serverSel.innerHTML = SOURCES.map((s, i) =>
    s.animeOnly ? "" : `<option value="${i}">${s.name}</option>`).join("");
  serverSel.value = settingsStore.playbackPrefs.preferredSourceIndex;

  if (typeof renderDownloadsList === "function") renderDownloadsList();
  if (typeof renderSyncStatus === "function") renderSyncStatus();
  if (typeof renderUpdateSection === "function") renderUpdateSection();
}

// `apply` (default true) updates the live theme as you click; pass false
// when just reflecting the saved value into the UI (e.g. on view open).
function selectThemeSwatch(theme, apply = true) {
  document.querySelectorAll("#themeSwatches .theme-swatch").forEach(el =>
    el.classList.toggle("selected", el.dataset.theme === theme));
  if (apply) applyTheme(theme);
}

function saveSettingsView() {
  // blank field falls back to the embedded default key
  store.key = document.getElementById("apiKeyInput").value.trim();
  store.color = document.getElementById("colorInput").value;
  store.autoplay = document.getElementById("autoplayInput").checked;
  setAccentVars(store.color);

  const selected = document.querySelector("#themeSwatches .theme-swatch.selected");
  settingsStore.theme = selected ? selected.dataset.theme : "dark";
  settingsStore.shortcutsEnabled = document.getElementById("shortcutsInput").checked;
  settingsStore.readerPrefs = {
    mode: document.getElementById("readerModeInput").value,
    quality: document.getElementById("readerQualityInput").value,
    direction: document.getElementById("readerDirectionInput").value,
  };
  settingsStore.playbackPrefs = {
    preferredSourceIndex: +document.getElementById("preferredServerInput").value,
  };

  switchView("home");
}

/* ---------- Backup & Transfer (export / import) ---------- */
function exportData() {
  const snapshot = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    snapshot[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fictionhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const snapshot = JSON.parse(reader.result);
      if (!snapshot.fh_profiles) throw new Error("not a FictionHub backup");
      if (!confirm("This will replace your current profiles, watch history, and settings. Continue?")) return;
      localStorage.clear();
      for (const [k, v] of Object.entries(snapshot)) localStorage.setItem(k, v);
      scheduleBackup();
      location.reload();
    } catch (e) {
      alert("Invalid backup file.");
    }
  };
  reader.readAsText(file);
}

/* ---------- Startup intro ---------- */
// Plays a short FictionHub logo animation (Pornhub-style) before the app
// shell appears. "Fiction" is white on black, "Hub" is black on orange.
// Only plays once per session; repeat profile switches skip straight to
// the app shell.
let introPlayed = false;

function showIntro() {
  if (introPlayed) { bootApp(); return; }
  introPlayed = true;
  const intro = document.getElementById("intro");
  if (!intro) { bootApp(); return; }
  intro.classList.remove("hidden");
  // 3 s animation, then fade out and boot the app shell
  setTimeout(() => {
    intro.classList.add("fade-out");
    setTimeout(() => {
      intro.classList.add("hidden");
      bootApp();
    }, 600);
  }, 3200);
}

// Core app boot: accent color, banner, home view. Called by showIntro()
// after the intro finishes, or directly when the intro is skipped.
function bootApp() {
  setAccentVars(store.color);
  showBanner(false); // default key is always available now
  switchView("home");
}

/* ---------- Init ---------- */
// Called once at startup and again whenever the active profile changes.
function initApp() {
  showIntro();
}
