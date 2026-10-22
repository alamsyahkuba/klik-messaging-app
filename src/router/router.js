/**
 * Hash router ringan (tanpa framework).
 * Route pattern: '/app/chat/:id'. Handler mengembalikan Node atau {node, cleanup}.
 */
import { closeModal, clearModalRoot } from '../components/modal.js';

const routes = [];
let container = null;
let activeCleanup = null;

export function route(pattern, handler) {
  routes.push({ pattern, handler });
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) location.replace(target);
  else location.hash = target;
}

export function currentLocation() {
  return parseHash();
}

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  return {
    path: pathPart || '/',
    query: Object.fromEntries(new URLSearchParams(queryPart || '')),
  };
}

export function matchRoute(pattern, path) {
  const patternSegs = pattern.split('/').filter(Boolean);
  const pathSegs = path.split('/').filter(Boolean);
  if (patternSegs.length !== pathSegs.length) return null;
  const params = {};
  for (let i = 0; i < patternSegs.length; i += 1) {
    const seg = patternSegs[i];
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(pathSegs[i]);
    else if (seg !== pathSegs[i]) return null;
  }
  return params;
}

function notFoundPage(path) {
  const div = document.createElement('div');
  div.className = 'auth-page';
  div.innerHTML = `
    <div class="auth-card text-center">
      <h1 class="text-display">404</h1>
      <p class="text-muted text-sm" style="margin-top:8px">Halaman <strong>${escapeHtml(path)}</strong> tidak ditemukan.</p>
      <p style="margin-top:16px"><a class="btn btn--primary" href="#/welcome">Kembali ke awal</a></p>
    </div>`;
  return div;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function renderRoute() {
  if (!container) return;
  const { path, query } = parseHash();

  // Tutup modal aktif + listener Escape agar tidak bocor antar route.
  try { closeModal(); } catch { /* abaikan */ }
  try { clearModalRoot(); } catch { /* abaikan */ }

  if (typeof activeCleanup === 'function') {
    try { activeCleanup(); } catch { /* abaikan cleanup */ }
  }
  activeCleanup = null;

  let result = null;
  for (const { pattern, handler } of routes) {
    const params = matchRoute(pattern, path);
    if (params) {
      result = handler({ params, query });
      break;
    }
  }
  if (!result) result = notFoundPage(path);

  const node = result instanceof Node ? result : result?.node;
  const cleanup = result instanceof Node ? null : result?.cleanup;

  while (container.firstChild) container.removeChild(container.firstChild);
  if (node) container.append(node);
  activeCleanup = cleanup || null;

  window.scrollTo(0, 0);
}

export function startRouter(root) {
  container = root;
  window.addEventListener('hashchange', renderRoute);
  // Cukup render sekali di sini; JANGAN dengarkan 'load' (render dobel
  // menghancurkan input yang sedang difokus user -> keyboard tertutup).
  renderRoute();
}
