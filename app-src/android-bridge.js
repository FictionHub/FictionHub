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
    // But we need to ensure we're not using the Capacitor HTTP server
    window.FH_ANDROID_NATIVE_SERVER = true;
    
    // Patch fetch to handle cleartext traffic
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      let url = typeof input === 'string' ? input : input.url;
      if (url && url.startsWith('http://localhost:8787')) {
        // On Android, we might need to use 10.0.2.2 for the emulator
        // or localhost for real devices. Capacitor handles this.
      }
      return originalFetch.apply(this, arguments);
    };
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
