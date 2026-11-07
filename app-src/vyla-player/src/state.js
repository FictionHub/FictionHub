const p = new URLSearchParams(location.search);

let rawId = p.get('id') || '';
let season = p.get('season') || p.get('s') || null;
let episode = p.get('episode') || p.get('e') || null;

if (rawId && rawId.includes('/')) {
    const parts = rawId.split('/').filter(Boolean);
    rawId = parts[0];
    if (parts[1]) season = parts[1];
    if (parts[2]) episode = parts[2];
}

const pathParts = location.pathname.split('/').filter(Boolean);
if (pathParts.length >= 2 && (pathParts[0] === 'tv' || pathParts[0] === 'movie')) {
    rawId = pathParts[1];
    if (pathParts[0] === 'tv') {
        season = pathParts[2] || '1';
        episode = pathParts[3] || '1';
    }
}

export const store = {
    id: rawId || null,
    s: season,
    e: episode,
    ap: p.get('ap'),
    sources: [],
    currentSourceIndex: 0,
    sourcesLoaded: false,
    buildSourceList: null
};