/**
 * Preload for the FictionHub window. Exposes a tiny bridge so the renderer
 * can tell the main process which domain the player <iframe> is *supposed*
 * to be showing — used to block ad/redirect hijacks of the whole player
 * frame (see electron-main.js's "will-frame-navigate" handler) without
 * blocking legitimate server switches.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fictionhub", {
  setEmbedHost: (host) => ipcRenderer.send("set-embed-host", host),

  // In-app auto-update window (update-ui.js) → main-process updater (updater.js).
  updater: {
    getVersion: () => ipcRenderer.invoke("update:version"),
    getState: () => ipcRenderer.invoke("update:state"),
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    defer: () => ipcRenderer.invoke("update:defer"),
    // Subscribe to update:event pushes from main. Returns an unsubscribe fn.
    onEvent: (cb) => {
      const handler = (_event, payload) => { if (typeof cb === "function") cb(payload); };
      ipcRenderer.on("update:event", handler);
      return () => ipcRenderer.removeListener("update:event", handler);
    },
  },
});
