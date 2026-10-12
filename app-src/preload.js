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
});
