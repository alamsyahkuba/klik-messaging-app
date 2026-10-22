import { el } from '../utils/dom.js';
import { formatListTime } from '../utils/format-time.js';
import { avatar } from './avatar.js';
import { icon } from './icon.js';
import { emptyState, errorState, skeletonList } from './state-view.js';

/**
 * Daftar percakapan (dipakai halaman Home dan panel kiri halaman Chat).
 * @param {{chats:Array, activeId?:string, onSelect:Function,
 *          state:'ok'|'loading'|'error', errorMessage?:string,
 *          onRetry?:Function, emptyAction?:Node}} options
 */
export function chatList({ chats = [], activeId = null, onSelect, state = 'ok', errorMessage = '', onRetry = null, emptyAction = null }) {
  if (state === 'loading') return skeletonList(6);
  if (state === 'error') return errorState({ title: 'Gagal memuat percakapan', message: errorMessage, onRetry });
  if (!chats.length) {
    return emptyState({
      iconName: 'chat',
      title: 'Belum ada percakapan',
      desc: 'Mulai obrolan dengan teman lewat kode akun atau QR.',
      action: emptyAction,
    });
  }

  const list = el('div', { class: 'list', role: 'list' });
  for (const chat of chats) {
    list.append(chatRow(chat, activeId, onSelect));
  }
  return list;
}

function chatRow(chat, activeId, onSelect) {
  const isGroup = chat.type === 'group';
  const isRoom = chat.type === 'room';
  const row = el('button', {
    class: `list-item${chat.id === activeId ? ' is-active' : ''}`,
    type: 'button',
    role: 'listitem',
    'aria-current': chat.id === activeId ? 'true' : null,
    onClick: () => onSelect?.(chat.id),
  },
    avatar({ name: chat.title, id: chat.peerId || chat.title, size: '', online: isGroup || isRoom ? null : chat.subtitle === 'Online' }),
    el('div', { class: 'list-item__main' },
      el('div', { class: 'list-item__title' },
        el('span', { class: 'text-ellipsis' }, chat.title),
        isGroup ? el('span', { class: 'badge badge--accent', title: 'Grup' }, icon('users')) : null,
        isRoom ? el('span', { class: 'badge', title: 'Room' }, icon('hash')) : null,
      ),
      el('div', { class: 'list-item__preview' }, chat.preview),
    ),
    el('div', { class: 'list-item__side' },
      el('span', { class: 'list-item__time' }, formatListTime(chat.lastAt)),
      chat.unread > 0
        ? el('span', { class: 'badge-count', 'aria-label': `${chat.unread} pesan belum dibaca` }, String(chat.unread))
        : null,
    ),
  );
  return row;
}
