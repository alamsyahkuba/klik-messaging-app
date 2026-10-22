import { el } from '../utils/dom.js';
import { icon } from '../components/icon.js';
import { getBadges, subscribe } from '../services/badge-store.js';

/**
 * Kerangka aplikasi: sidebar navigasi (desktop) + tab bar (mobile).
 * Halaman menyuntikkan kontennya ke area .app-content.
 * Badge navbar (Pesan/Teman) di-update live via badge-store.
 * @param {{active:'chats'|'friends'|'profile', fullscreen?:boolean}} options
 * @param {Node} pageNode
 */
export function renderShell({ active, fullscreen = false }, pageNode) {
  const badges = getBadges();

  const items = [
    { key: 'chats', label: 'Pesan', iconName: 'chat', href: '#/app/chats', badgeKey: 'unreadChats' },
    { key: 'friends', label: 'Teman', iconName: 'users', href: '#/app/friends', badgeKey: 'pendingFriends' },
    { key: 'profile', label: 'Profil', iconName: 'user', href: '#/app/profile', badgeKey: null },
  ];

  function badgeNode(key) {
    const n = badges[key] || 0;
    return n > 0 ? el('span', { class: 'badge-count', 'data-badge': key }, String(n)) : null;
  }

  function tabBadgeNode(key) {
    const n = badges[key] || 0;
    return n > 0 ? el('span', { class: 'badge-count tabbar__badge', 'data-badge': key }, String(n)) : null;
  }

  const navItems = items.map((item) => el('a', {
    class: `nav-item${item.key === active ? ' is-active' : ''}`,
    href: item.href,
    'aria-current': item.key === active ? 'page' : null,
  },
    icon(item.iconName),
    el('span', { class: 'nav-item__label' }, item.label),
    item.badgeKey ? badgeNode(item.badgeKey) : null,
  ));

  const tabItems = items.map((item) => el('a', {
    class: `tabbar__item${item.key === active ? ' is-active' : ''}`,
    href: item.href,
    'aria-current': item.key === active ? 'page' : null,
  },
    icon(item.iconName),
    el('span', { class: 'tabbar__label' }, item.label),
    item.badgeKey ? tabBadgeNode(item.badgeKey) : null,
  ));

  const shell = el('div', { class: 'app-shell' },
    el('nav', { class: 'app-nav', 'aria-label': 'Navigasi utama' },
      el('div', { class: 'app-nav__brand' },
        el('img', { src: 'src/assets/logo.svg', alt: '', width: '40', height: '40' }),
        el('span', { class: 'app-nav__brand-name' }, 'KLIK'),
      ),
      el('div', { class: 'app-nav__items' }, navItems),
      el('p', { class: 'text-xs text-muted', style: { padding: '8px' } }, 'v0.1.0 - Milestone 1'),
    ),
    el('main', { class: `app-content${fullscreen ? ' is-fullscreen' : ''}` }, pageNode),
    el('nav', { class: 'tabbar', 'aria-label': 'Navigasi bawah' }, tabItems),
  );

  // Update live: cari badge berdasarkan data-badge di nav & tabbar, tambah/hapus saat 0<->>0.
  const unsub = subscribe((next) => {
    for (const item of items) {
      if (!item.badgeKey) continue;
      const n = next[item.badgeKey] || 0;
      for (const scope of [shell.querySelector('.app-nav__items'), shell.querySelector('.tabbar')]) {
        if (!scope) continue;
        const existing = scope.querySelector(`[data-badge="${item.badgeKey}"]`);
        const link = scope.querySelector(`a[href="${item.href}"]`);
        if (!link) continue;
        if (n > 0 && !existing) {
          const cls = scope.classList.contains('tabbar')
            ? 'badge-count tabbar__badge'
            : 'badge-count';
          link.append(el('span', { class: cls, 'data-badge': item.badgeKey }, String(n)));
        } else if (n > 0 && existing) {
          existing.textContent = String(n);
        } else if (n <= 0 && existing) {
          existing.remove();
        }
      }
    }
  });

  // Auto-unsubscribe saat shell dilepas dari DOM (best-effort).
  const observer = new MutationObserver(() => {
    if (!document.body.contains(shell)) {
      unsub();
      observer.disconnect();
    }
  });
  if (typeof document !== 'undefined') {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return shell;
}
