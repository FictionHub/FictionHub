export const TMDB_KEY = '3f6703f3e2a0b2b40fe4fbb3e1546244';

// FictionHub patch: on Android the app (and this player, in its iframe) is
// served by Capacitor from https://fictionhub.local, while the /api/* routes
// live on the embedded Node server at http://localhost:8787. The host page
// publishes that origin as FH_NATIVE_SERVER_URL; on desktop it's unset and
// the API is same-origin.
export const baseURL = (() => {
    try {
        return (window.parent && window.parent.FH_NATIVE_SERVER_URL) || window.FH_NATIVE_SERVER_URL || '';
    } catch (e) {
        return '';
    }
})();
