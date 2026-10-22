import { el } from '../utils/dom.js';

/**
 * QR preview.
 * - Pola deterministik (placeholder) selalu dirender lebih dulu.
 * - Opsi `real: true`: render QR asli dari kode akun memakai pustaka `qrcode`
 *   (dimuat dari CDN lewat dynamic import; bila gagal/offline, pola cadangan
 *   tetap tampil - bukan QR yang bisa dipindai).
 */
export function qrPlaceholder(seed) {
  const wrap = el('div', { class: 'qr-placeholder', 'aria-hidden': 'true', title: 'Pratinjau QR (dummy)' });
  const total = 121;
  let hash = 0;
  for (let i = 0; i < String(seed).length; i += 1) {
    hash = (hash * 31 + String(seed).charCodeAt(i)) >>> 0;
  }

  const finder = (index) => {
    const r = Math.floor(index / 11);
    const c = index % 11;
    const inBox = (r0, c0) => r >= r0 && r < r0 + 3 && c >= c0 && c < c0 + 3;
    const ring = (r0, c0) => {
      const rr = r - r0;
      const cc = c - c0;
      return rr === 0 || rr === 2 || cc === 0 || cc === 2 || (rr === 1 && cc === 1);
    };
    for (const [r0, c0] of [[0, 0], [0, 8], [8, 0]]) {
      if (inBox(r0, c0)) return ring(r0, c0);
    }
    return null;
  };

  for (let i = 0; i < total; i += 1) {
    const fixed = finder(i);
    const on = fixed !== null ? fixed : ((hash >>> (i % 24)) ^ (i * 2654435761)) % 3 !== 0;
    wrap.append(el('span', { style: on ? {} : { background: 'transparent' } }));
  }
  return wrap;
}

/** Render QR asli ke dalam frame (progressive enhancement). */
async function renderRealQr(frame, text, captionEl) {
  try {
    const { toCanvas } = await import('https://esm.sh/qrcode@1.5.4');
    const canvas = document.createElement('canvas');
    await toCanvas(canvas, text, {
      margin: 1,
      width: 168,
      color: { dark: '#111111', light: '#FFFFFF' },
    });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `QR code berisi ${text}`);
    canvas.style.display = 'block';
    canvas.style.imageRendering = 'pixelated';
    frame.replaceChildren(canvas);
    frame.classList.remove('qr-placeholder');
    frame.removeAttribute('aria-hidden');
    if (captionEl) captionEl.textContent = 'QR kode akun. Pindai untuk menambahkan teman.';
  } catch {
    /* offline / CDN gagal - placeholder tetap tampil, caption jujur */
    if (captionEl) captionEl.textContent = 'QR asli gagal dimuat (offline?). Pola di atas bukan QR yang bisa dipindai.';
  }
}

/** Bingkai QR + caption status. */
export function qrFrame(seed, { caption = 'Pratinjau QR (dummy).', real = false } = {}) {
  const frame = el('div', { class: 'qr-frame' }, qrPlaceholder(seed));
  const captionEl = caption ? el('p', { class: 'field__hint text-center' }, caption) : null;
  if (real) renderRealQr(frame, seed, captionEl);
  return el('div', { class: 'stack', style: { alignItems: 'center' } },
    frame,
    captionEl,
  );
}
