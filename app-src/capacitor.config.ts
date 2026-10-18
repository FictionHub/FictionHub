import type { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
  appId: 'com.fictionhub.app',
  appName: 'FictionHub',
  webDir: '.',
  bundledWebResource: false,
  server: {
    // Android WebView cannot connect to the desktop's local server (127.0.0.1:8787).
    // On desktop (Electron), the local Node.js server is used. On Android, the
    // renderer must fetch media sources directly (bypassing the local proxy) or
    // via a Capacitor plugin.
    allowNavigation: ['*'],
    cleartext: true,
  },
  android: {
    buildOptions: {
      release: {
        keystorePath: '',
        keystoreAlias: '',
        keystorePasswords: '',
        keyPasswords: '',
      },
    },
  },
};

export default config;