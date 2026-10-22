/**
 * Pemindai QR (Milestone 6) - progresif:
 * 1. Capacitor ML Kit (`@capacitor-mlkit/barcode-scanning`) di Android/iOS.
 *    Diakses via window.Capacitor.Plugins.BarcodeScanner (bridge native),
 *    tanpa dynamic import npm package (proyek tanpa bundler).
 * 2. Barcode Detector API (Chrome/Android browser) di web modern.
 * 3. Tidak tersedia -> kembalikan null; halaman menampilkan input kode manual.
 */

/** true bila berjalan di runtime Capacitor (WebView native). */
export function isCapacitorRuntime() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

/** Ambil plugin BarcodeScanner dari bridge Capacitor (native). null bila tidak ada. */
function nativeBarcodeScanner() {
  return window.Capacitor?.Plugins?.BarcodeScanner || null;
}

/**
 * Coba API pemindai yang tersedia di lingkungan ini.
 * @returns {Promise<'mlkit'|'barcode-detector'|null>}
 */
export async function detectScanner() {
  if (isCapacitorRuntime() && nativeBarcodeScanner()) return 'mlkit';
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) return 'barcode-detector';
  return null;
}

/**
 * Mulai pindai satu kali.
 * @param {{ onResult: (text: string) => void, videoHost?: HTMLElement }} options
 * @returns {Promise<{ stop: () => void } | null>} null bila scanner tidak tersedia.
 * @throws Error('IZIN_DITOLAK') bila izin kamera ditolak pengguna.
 */
export async function startScan({ onResult, videoHost = null } = {}) {
  const kind = await detectScanner();
  if (!kind) return null;

  if (kind === 'mlkit') {
    const BarcodeScanner = nativeBarcodeScanner();
    if (!BarcodeScanner) throw new Error('PLUGIN_TIDAK_TERSEDIA');
    const perm = await BarcodeScanner.checkPermissions();
    if (perm?.camera !== 'granted') {
      const req = await BarcodeScanner.requestPermissions();
      if (req?.camera !== 'granted') throw new Error('IZIN_DITOLAK');
    }
    const result = await BarcodeScanner.scan();
    const value = result?.barcodes?.[0]?.rawValue || '';
    await BarcodeScanner.removeAllListeners?.().catch?.(() => {});
    if (value) onResult(value);
    return { stop: () => { BarcodeScanner.removeAllListeners?.().catch?.(() => {}); } };
  }

  // Barcode Detector API (web)
  if (!videoHost) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.width = '100%';
  video.style.borderRadius = 'var(--radius-btn)';
  video.srcObject = stream;
  videoHost.append(video);

  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        const value = codes[0].rawValue || '';
        stop();
        if (value) onResult(value);
        return;
      }
    } catch { /* frame belum siap - coba lagi */ }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function stop() {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.remove();
  }

  return { stop };
}
