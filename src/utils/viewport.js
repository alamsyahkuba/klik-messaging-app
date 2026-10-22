/**
 * Tinggi aplikasi aktif.
 * Menggunakan visualViewport bila tersedia agar input chat
 * tidak tertutup keyboard di iOS/Android WebView.
 * Di-throttle via requestAnimationFrame + value-diff agar tidak
 * menulis --app-height ratusan kali saat IME animasi (WebView M139+).
 */
let lastHeight = 0;
let rafId = 0;

function applyHeight() {
  rafId = 0;
  const root = document.documentElement;
  const vv = window.visualViewport;
  const h = vv && vv.height ? Math.round(vv.height) : (window.innerHeight || 0);
  if (!h || h === lastHeight) return;
  lastHeight = h;
  root.style.setProperty('--app-height', `${h}px`);
}

export function setAppHeight() {
  if (rafId) return; // sudah terjadwal
  // requestAnimationFrame tidak ada di Node test environment — langsung apply.
  rafId = (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame(applyHeight)
    : (applyHeight(), 0);
}
