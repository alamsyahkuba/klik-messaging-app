import { el } from '../utils/dom.js';
import { icon } from './icon.js';

/**
 * Toast non-blocking (pengganti alert()).
 * type: 'info' | 'success' | 'error'
 */
export function showToast(message, type = 'info', duration = 3000) {
  const host = document.getElementById('toast-host');
  if (!host) return;

  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert-circle' : 'info';
  const toast = el('div', { class: `toast toast--${type}` },
    icon(iconName),
    el('span', { class: 'grow text-sm' }, message),
  );

  host.append(toast);

  const remove = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 160);
  };
  const timer = setTimeout(remove, duration);

  toast.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });

  // Batasi jumlah toast agar tidak menumpuk
  while (host.children.length > 3) host.firstElementChild.remove();
}
