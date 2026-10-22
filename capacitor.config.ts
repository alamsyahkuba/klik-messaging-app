import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Konfigurasi Capacitor (Milestone 6).
 * - webDir menunjuk ke hasil build statis (npm run build:dist -> dist/)
 * - Platform Android/iOS ditambahkan dengan:
 *     npx cap add android
 *     npx cap add ios
 * Lihat docs/10-capacitor-android.md
 */
const config: CapacitorConfig = {
  appId: 'app.klik.chat',
  appName: 'KLIK',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
