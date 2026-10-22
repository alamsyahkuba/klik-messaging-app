import { el } from '../utils/dom.js';
import { icon } from './icon.js';

/** Status kosong dengan ikon, judul, deskripsi, dan aksi opsional. */
export function emptyState({ iconName = 'inbox', title, desc = '', action = null } = {}) {
  return el('div', { class: 'state-view' },
    el('div', { class: 'state-view__icon' }, icon(iconName, 'icon--lg')),
    el('p', { class: 'state-view__title' }, title),
    desc ? el('p', { class: 'state-view__desc' }, desc) : null,
    action,
  );
}

/** Status error dengan tombol coba lagi. */
export function errorState({ title = 'Terjadi kesalahan', message = '', onRetry = null } = {}) {
  return el('div', { class: 'state-view state-view--error' },
    el('div', { class: 'state-view__icon' }, icon('alert-triangle', 'icon--lg')),
    el('p', { class: 'state-view__title' }, title),
    el('p', { class: 'state-view__desc' }, message),
    onRetry
      ? el('button', { class: 'btn btn--primary', type: 'button', onClick: onRetry },
          icon('refresh'),
          'Coba lagi')
      : null,
  );
}

/** Skeleton baris daftar (avatar + dua baris teks). */
export function skeletonList(rows = 5) {
  const items = [];
  for (let i = 0; i < rows; i += 1) {
    items.push(el('div', { class: 'skeleton__row' },
      el('div', { class: 'skeleton__block skeleton__avatar' }),
      el('div', { class: 'skeleton__lines' },
        el('div', { class: 'skeleton__block skeleton__line skeleton__line--mid' }),
        el('div', { class: 'skeleton__block skeleton__line skeleton__line--short' }),
      ),
    ));
  }
  return el('div', { class: 'skeleton', 'aria-hidden': 'true' }, items);
}

/** Skeleton gelembung percakapan. */
export function skeletonMessages(rows = 6) {
  const items = [];
  for (let i = 0; i < rows; i += 1) {
    const mine = i % 3 === 1;
    items.push(el('div', {
      class: 'skeleton__block',
      style: {
        alignSelf: mine ? 'flex-end' : 'flex-start',
        width: `${45 + ((i * 13) % 35)}%`,
        height: `${38 + ((i * 7) % 26)}px`,
        borderRadius: '14px',
      },
    }));
  }
  return el('div', { class: 'skeleton', style: { flex: '1', justifyContent: 'flex-start' }, 'aria-hidden': 'true' }, items);
}

/** Membungkus tampilan state di dalam area konten. */
export function stateOrData(stateNode, dataNode) {
  return dataNode || stateNode;
}
