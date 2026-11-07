import { TMDB_KEY, baseURL } from './config.js';
import { store } from './state.js';
import { isMobile, isIOS, fmt } from './utils/helpers.js';
import { haptic } from './utils/haptics.js';
import { initLoaderBackdrop, hideLoader, setShouldHideLoader } from './ui/loader.js';

window.store = store;
window.TMDB_KEY = TMDB_KEY;
window.baseURL = baseURL;
window.isMobile = isMobile;
window.isIOS = isIOS;
window.fmt = fmt;
window.haptic = haptic;
window.hideLoader = hideLoader;

Object.defineProperty(window, 's', { get: () => store.s });
Object.defineProperty(window, 'e', { get: () => store.e });
Object.defineProperty(window, 'id', { get: () => store.id });
Object.defineProperty(window, 'sources', { get: () => store.sources, set: (v) => store.sources = v });
Object.defineProperty(window, 'currentSourceIndex', { get: () => store.currentSourceIndex, set: (v) => store.currentSourceIndex = v });
Object.defineProperty(window, 'buildSourceList', { get: () => store.buildSourceList, set: (v) => store.buildSourceList = v });
Object.defineProperty(window, 'sourcesLoaded', { get: () => store.sourcesLoaded, set: (v) => store.sourcesLoaded = v });

let _playerPlay = null;
let _sourceDiscoveryCancelled = false;

window.__skipSourceDiscovery = false;
window.__sourceDebug = [];
window.__lastSourceError = null;

export function proxyStreamUrl(url, headers = {}) {
    if (!url) return '';
    const encoded = encodeURIComponent(url);
    const headersParam = Object.keys(headers).length ? `&headers=${encodeURIComponent(JSON.stringify(headers))}` : '';
    return `${baseURL}/api/proxy?url=${encoded}${headersParam}`;
}
window.proxyStreamUrl = proxyStreamUrl;

function reportSourceDebug(message, details) {
    const entry = { message, details, timestamp: new Date().toISOString() };
    if (!window.__sourceDebug) window.__sourceDebug = [];
    window.__sourceDebug.push(entry);
    if (window.__sourceDebug.length > 25) window.__sourceDebug.shift();
    window.__lastSourceError = entry;
    console.error(`${message}`, details);
    return entry;
}

window.setWatchPartySourceMode = function (enabled) {
    window.__skipSourceDiscovery = !!enabled;
    if (enabled) {
        _sourceDiscoveryCancelled = true;
        if (typeof window.setShouldHideLoader === 'function') window.setShouldHideLoader(true);
        if (typeof window.hideLoader === 'function') window.hideLoader();
    } else {
        _sourceDiscoveryCancelled = false;
    }
};

function shouldSkipSourceDiscovery() {
    const params = new URLSearchParams(location.search);
    const wpParam = params.get('wp');
    const hashWp = (location.hash.match(/wp=([A-Z0-9]+)/) || [])[1] || null;
    return window.__skipSourceDiscovery || !!(wpParam || hashWp);
}

Object.defineProperty(window, 'play', {
    get: () => {
        return async function (raw, videoId, isFallback) {
            if (raw === '__init__') return;
            if (_playerPlay) return _playerPlay(raw, videoId, isFallback);
        };
    },
    set: (fn) => { _playerPlay = fn; }
});

async function init() {
    if (store.id) {
        const blockedMessage = await isContentBlocked(store.id);
        if (blockedMessage) {
            initLoaderBackdrop();
            showBlockedScreen(blockedMessage);
            return;
        }
    }

    await Promise.all([
        import('./api/tmdb.js'),
        import('./api/subtitles.js'),
        import('./ui/toast.js'),
        import('./core/player.js'),
        import('./ui/glow.js'),
        import('./features/episodes.js')
    ]);

    initLoaderBackdrop();

    if (isMobile()) {
        const mainVideo = document.getElementById('v');
        if (mainVideo) mainVideo.removeAttribute('controls');
    }

    if (store.id) {
        try { window.play('__init__', store.id); } catch (e) { }
        if (shouldSkipSourceDiscovery()) {
            if (typeof window.setShouldHideLoader === 'function') window.setShouldHideLoader(true);
            if (typeof window.hideLoader === 'function') window.hideLoader();
        } else {
            startSourceDiscovery();
        }
    }
}

let activeAuthPromise = null;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
let refreshTimer = null;

function scheduleTokenRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!store.sessionTokenExpiresAt) return;
    const delay = Math.max(store.sessionTokenExpiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS, 0);
    refreshTimer = setTimeout(() => { getSessionToken(true).catch(() => { }); }, delay);
}

async function requestNewToken() {
    const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
    return res.json();
}

async function requestRefreshedToken(currentToken) {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Session-Token': currentToken
        }
    });

    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    return res.json();
}

async function getSessionToken(forceRefresh) {
    if (!forceRefresh && store.sessionToken) return store.sessionToken;
    if (activeAuthPromise) return activeAuthPromise;
    activeAuthPromise = (async () => {
        let data;
        try {
            data = store.sessionToken ? await requestRefreshedToken(store.sessionToken) : await requestNewToken();
        } catch (err) {
            data = await requestNewToken();
        }
        store.sessionToken = data.token;
        store.sessionTokenExpiresAt = Date.now() + 30 * 60 * 1000;
        scheduleTokenRefresh();
        activeAuthPromise = null;
        return data.token;
    })().catch((err) => {
        activeAuthPromise = null;
        throw err;
    });
    return activeAuthPromise;
}

async function testSource(sourceKey) {
    const params = new URLSearchParams({
        provider: sourceKey,
        tmdbId: store.id
    });
    if (store.s) {
        params.set('season', store.s);
        params.set('episode', store.e || '1');
    }
    const res = await fetch(`${baseURL}/api/stream?${params.toString()}`);
    if (!res.ok) throw new Error(`Source check failed (${res.status})`);
    const data = await res.json();
    const streamInfo = data.stream || data;
    if (!streamInfo || (!streamInfo.url && (!streamInfo.allUrls || !streamInfo.allUrls.length))) {
        throw new Error(`No URL for ${sourceKey}`);
    }
    return streamInfo;
}

function showErrorScreen(error = null) {
    const spinnerEl = document.getElementById('loader-spinner-wrap');
    if (spinnerEl) spinnerEl.style.display = 'none';
    const errScreen = document.getElementById('error-screen');
    const errText = document.querySelector('.err-text');
    const errSub = document.querySelector('.err-sub');
    const detail = error?.message || error || 'The video source could not be loaded.';
    if (errText) errText.textContent = 'Playback failed';
    if (errSub) {
        errSub.textContent = detail;
    } else if (errText) {
        errText.insertAdjacentHTML('afterend', `<div class="err-sub">${String(detail).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`);
    }
    if (errScreen) errScreen.classList.add('show');
}

function setSourceDiscoveryUiHidden(hidden) {
    window.__sourceDiscoveryUiHidden = !!hidden;
    if (!hidden) return;
    if (typeof window.hideUI === 'function') window.hideUI();
    const controlsWrapper = document.getElementById('player-controls-wrapper');
    const titleBar = document.getElementById('title-bar');
    const player = document.getElementById('player');
    if (controlsWrapper) controlsWrapper.classList.remove('on');
    if (titleBar) titleBar.classList.remove('on');
    if (player) player.classList.remove('ui-on');
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function fetchSourceKeys() {
    const cacheKey = 'vyla_sources_cache';
    const cached = sessionStorage.getItem(cacheKey);
    let list;
    if (cached) {
        try { list = JSON.parse(cached); } catch (e) { }
    }
    if (!list) {
        const res = await fetch(`${baseURL}/api/sources`);
        if (!res.ok) throw new Error(`Failed to fetch sources (${res.status})`);
        const data = await res.json();
        list = Array.isArray(data) ? data : (data.sources || []);
        sessionStorage.setItem(cacheKey, JSON.stringify(list));
    }

    if (store.s) {
        list = list.filter(src => !src.key.includes('movie'));
    } else {
        list = list.filter(src => !src.key.includes('anime') && !src.animeOnly);
    }

    list = shuffleArray(list);

    const lastWorking = localStorage.getItem('vyla_last_source');
    if (lastWorking) {
        const idx = list.findIndex(s => s.key === lastWorking);
        if (idx > -1) {
            const [item] = list.splice(idx, 1);
            list.unshift(item);
        }
    }
    return list;
}

async function loadTitleMeta() {
    try {
        const mediaType = store.s ? 'tv' : 'movie';
        const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${store.id}?api_key=${TMDB_KEY}`);
        if (!res.ok) {
            const fallbackTitle = store.s ? `TV Show (TMDB: ${store.id}) · S${store.s}E${store.e || '1'}` : `Movie (TMDB: ${store.id})`;
            document.title = fallbackTitle;
            return;
        }
        const meta = await res.json();
        let metaTitle = meta.title || meta.name || 'Unknown';
        if (store.s) metaTitle += ` · S${store.s}E${store.e || '1'}`;
        document.title = metaTitle;
        if (typeof window.setTitleWithTmdbImage === 'function') {
            await window.setTitleWithTmdbImage(metaTitle, Object.assign({}, meta, { tmdb_id: store.id }));
        }
        if (typeof window.showNowPlayingToast === 'function') window.showNowPlayingToast(metaTitle);
    } catch (e) {
        reportSourceDebug('Title meta fetch error', { error: e.message });
    }
}

async function testSourceForDiscovery(sourceMeta) {
    try {
        const streamData = await testSource(sourceMeta.key);
        const rawUrl = streamData.url || (streamData.allUrls && streamData.allUrls[0] && streamData.allUrls[0].url);
        const headers = streamData.headers || {};
        const proxiedUrl = proxyStreamUrl(rawUrl, headers);
        localStorage.setItem('vyla_last_source', sourceMeta.key);
        return {
            key: sourceMeta.key,
            label: sourceMeta.label || sourceMeta.key,
            ok: true,
            url: proxiedUrl,
            rawUrl: rawUrl,
            headers: headers,
            allUrls: (streamData.allUrls || []).map(u => ({
                ...u,
                proxiedUrl: proxyStreamUrl(u.url, headers)
            }))
        };
    } catch (e) {
        return { key: sourceMeta.key, label: sourceMeta.label || sourceMeta.key, ok: false, error: e.message };
    }
}

async function isContentBlocked(videoId) {
    if (!videoId) return null;
    const paths = ['src/blocked-ids.json'];
    for (const path of paths) {
        try {
            const res = await fetch(path);
            if (res.ok) {
                const data = await res.json();
                if (data.blockedIds && data.blockedIds.some((id) => String(id) === String(videoId))) {
                    return data.dmcaMessage || 'DMCA takedown - this content can no longer be played';
                }
            }
        } catch (e) { }
    }
    return null;
}

function showBlockedScreen(message) {
    setSourceDiscoveryUiHidden(true);
    if (typeof setShouldHideLoader === 'function') setShouldHideLoader(true);
    if (typeof hideLoader === 'function') hideLoader();

    const loader = document.getElementById('loader');
    const bufferingSpinner = document.getElementById('buffering-spinner');
    if (loader) loader.style.display = 'none';
    if (bufferingSpinner) bufferingSpinner.style.display = 'none';

    const errText = document.querySelector('.err-text');
    let errSub = document.querySelector('.err-sub');
    if (errText) errText.textContent = 'Content Blocked';
    if (!errSub && errText) {
        errText.insertAdjacentHTML('afterend', '<div class="err-sub"></div>');
        errSub = document.querySelector('.err-sub');
    }
    if (errSub) errSub.textContent = message;
    const errScreen = document.getElementById('error-screen');
    if (errScreen) errScreen.classList.add('show');
}

async function startSourceDiscovery() {
    if (shouldSkipSourceDiscovery()) {
        if (typeof window.setShouldHideLoader === 'function') window.setShouldHideLoader(true);
        if (typeof window.hideLoader === 'function') window.hideLoader();
        return;
    }

    const blockedMessage = await isContentBlocked(store.id);
    if (blockedMessage) {
        showBlockedScreen(blockedMessage);
        return;
    }

    _sourceDiscoveryCancelled = false;
    setSourceDiscoveryUiHidden(true);
    store.sources = [];
    store.sourcesLoaded = false;

    const loaderLabel = document.getElementById('loader-spinner-label');
    if (loaderLabel) loaderLabel.textContent = 'Finding Sources...';

    loadTitleMeta();

    try {
        const sourceKeys = await fetchSourceKeys();
        if (_sourceDiscoveryCancelled) return;

        if (!sourceKeys.length) {
            showErrorScreen('No sources configured for this media type.');
            return;
        }

        let foundWorking = false;
        let pendingCount = sourceKeys.length;

        for (const sourceMeta of sourceKeys) {
            if (_sourceDiscoveryCancelled) break;

            testSourceForDiscovery(sourceMeta).then((result) => {
                pendingCount--;
                if (_sourceDiscoveryCancelled) return;

                if (result.ok) {
                    const src = {
                        key: result.key,
                        source: result.key,
                        label: result.label,
                        url: result.url,
                        rawUrl: result.rawUrl,
                        headers: result.headers,
                        allUrls: result.allUrls
                    };
                    store.sources.push(src);
                    store.sourcesLoaded = true;
                    if (typeof window.buildSourceList === 'function') window.buildSourceList();

                    if (!foundWorking) {
                        foundWorking = true;
                        store.currentSourceIndex = store.sources.length - 1;
                        if (loaderLabel) loaderLabel.textContent = `Starting ${src.label}`;
                        setShouldHideLoader(true);
                        window.hideLoader();
                        setSourceDiscoveryUiHidden(false);
                        window.play(src.url, store.id);
                    }
                }

                if (pendingCount === 0 && !foundWorking && !_sourceDiscoveryCancelled) {
                    showErrorScreen('No stream available from the providers.');
                }
            });
        }
    } catch (e) {
        if (!_sourceDiscoveryCancelled) {
            reportSourceDebug('Batched discovery error', { error: e.message });
            setSourceDiscoveryUiHidden(false);
            showErrorScreen(e);
        }
    }
}

document.addEventListener('click', async (e) => {
    const sourcesOpts = document.getElementById('sources-opts');
    if (sourcesOpts && sourcesOpts.contains(e.target)) {
        const item = e.target.closest('#sources-opts > div');
        if (item) {
            const idx = Array.from(sourcesOpts.children).indexOf(item);
            if (idx !== -1 && idx !== store.currentSourceIndex) {
                const source = store.sources[idx];
                if (!source.url) {
                    if (item.dataset.fetching) return;
                    item.dataset.fetching = "1";
                    const listView = document.getElementById('src-list-view');
                    const detailView = document.getElementById('src-detail-view');
                    const titleEl = document.getElementById('src-detail-title');
                    const loadingState = document.getElementById('src-loading-state');
                    const failedState = document.getElementById('src-failed-state');
                    if (titleEl) titleEl.textContent = source.label;
                    if (loadingState) loadingState.style.display = 'flex';
                    if (failedState) failedState.style.display = 'none';
                    if (listView) listView.style.display = 'none';
                    if (detailView) detailView.style.display = 'flex';
                    try {
                        const url = await testSource(source.key);
                        source.url = url;
                        item.removeAttribute('data-fetching');
                        if (listView) listView.style.display = 'flex';
                        if (detailView) detailView.style.display = 'none';
                        item.click();
                    } catch (err) {
                        item.removeAttribute('data-fetching');
                        loadingState.style.display = 'none';
                        failedState.style.display = 'flex';
                    }
                }
            }
        }
    }
}, true);

document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const v = document.getElementById('v');
    if (!v) return;
    if (e.key === 'ArrowLeft') { v.currentTime = Math.max(0, v.currentTime - 10); window.showUI(); }
    if (e.key === 'ArrowRight') { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); window.showUI(); }
    if ([' ', 'k', 'K'].includes(e.key)) { e.preventDefault(); haptic(10); v.paused ? v.play() : v.pause(); }
});

init();