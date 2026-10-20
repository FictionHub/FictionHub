/* ===== Android Bridge: connects web app to native Capacitor plugins =====
   Automatically loads on Android, no-op on other platforms. */

(function() {
  'use strict';

  function isAndroid() {
    return /android/i.test(navigator.userAgent) && window.Capacitor !== undefined;
  }

  function isCapacitorReady() {
    return window.Capacitor && window.Capacitor.isPluginAvailable;
  }

  async function startNativeServer() {
    if (!isAndroid() || !isCapacitorReady()) return false;
    
    try {
      const { NodeJSServer } = Capacitor.Plugins;
      if (!NodeJSServer) return false;
      
      const result = await NodeJSServer.startServer();
      console.log('[android-bridge] Native server started:', result);
      return true;
    } catch (e) {
      console.warn('[android-bridge] Failed to start native server:', e);
      return false;
    }
  }

  async function stopNativeServer() {
    if (!isAndroid() || !isCapacitorReady()) return;
    
    try {
      const { NodeJSServer } = Capacitor.Plugins;
      if (!NodeJSServer) return;
      
      await NodeJSServer.stopServer();
      console.log('[android-bridge] Native server stopped');
    } catch (e) {
      console.warn('[android-bridge] Failed to stop native server:', e);
    }
  }

  async function getNativeServerStatus() {
    if (!isAndroid() || !isCapacitorReady()) return { running: false };
    
    try {
      const { NodeJSServer } = Capacitor.Plugins;
      if (!NodeJSServer) return { running: false };
      
      return await NodeJSServer.getStatus();
    } catch (e) {
      console.warn('[android-bridge] Failed to get server status:', e);
      return { running: false };
    }
  }

  // Override the server base URL on Android to use the native server
  function patchServerUrl() {
    if (!isAndroid()) return;
    
    // The native server runs on localhost:8787, same as desktop
    // But the web app loads from https://fictionhub.local (Capacitor server)
    // So we need to rewrite API requests to go to the Node.js server
    window.FH_ANDROID_NATIVE_SERVER = true;
    window.FH_NATIVE_SERVER_URL = 'http://localhost:8787';
    
    // List of API paths that should go to the Node.js server
    const API_PATHS = [
      '/__stream/',
      '/__proxy',
      '/__video/',
      '/__backup',
      '/__video/download/',
      '/__video/season-download/',
      '/__video/delete',
    ];

    function shouldProxyToNative(url) {
      try {
        const u = new URL(url, window.location.href);
        return API_PATHS.some(path => u.pathname.startsWith(path));
      } catch {
        return false;
      }
    }

    function rewriteUrl(url) {
      try {
        const u = new URL(url, window.location.href);
        return 'http://localhost:8787' + u.pathname + u.search;
      } catch {
        return url;
      }
    }

    // Patch fetch
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      let url = typeof input === 'string' ? input : input?.url;
      if (url && shouldProxyToNative(url)) {
        const newUrl = rewriteUrl(url);
        console.log('[android-bridge] Rewriting fetch:', url, '->', newUrl);
        if (typeof input === 'string') {
          input = newUrl;
        } else if (input && typeof input === 'object') {
          input = new Request(newUrl, input);
        }
      }
      return originalFetch.apply(this, arguments);
    };

    // Patch XMLHttpRequest (used by some libraries)
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      if (url && shouldProxyToNative(url)) {
        const newUrl = rewriteUrl(url);
        console.log('[android-bridge] Rewriting XHR:', url, '->', newUrl);
        url = newUrl;
      }
      return originalXHROpen.call(this, method, url, ...args);
    };

    // Also patch the global server base if used anywhere
    window.FH_SERVER_BASE = 'http://localhost:8787';
  }

  // Initialize on load
  document.addEventListener('DOMContentLoaded', async () => {
    if (!isAndroid()) return;
    
    console.log('[android-bridge] Android detected, initializing native bridge...');
    patchServerUrl();
    
    // Wait for Capacitor to be ready
    if (window.Capacitor) {
      // Already ready
    } else {
      await new Promise(r => {
        const check = setInterval(() => {
          if (window.Capacitor) {
            clearInterval(check);
            r();
          }
        }, 100);
      });
    }
    
    // Auto-start the server
    await startNativeServer();
    
    // Listen for app state changes
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        const status = await getNativeServerStatus();
        if (!status.running) {
          await startNativeServer();
        }
      }
    });
    
    console.log('[android-bridge] Android bridge initialized');
  });

  // Expose for debugging
  window.FHAndroidBridge = {
    startServer: startNativeServer,
    stopServer: stopNativeServer,
    getStatus: getNativeServerStatus,
    isAndroid: isAndroid,
  };
})();
