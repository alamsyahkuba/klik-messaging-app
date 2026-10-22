import { el, clear } from '../utils/dom.js';
import { icon } from '../components/icon.js';
import { chatList } from '../components/chat-list.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { avatar } from '../components/avatar.js';
import {
  listChats, startChatWith, createGroup, subscribeMessageFeed, withFreshPresence,
} from '../services/chats-service.js';
import { subscribePresence, isOnline } from '../services/presence-service.js';
import { listFriends } from '../services/friends-service.js';
import { setBadges } from '../services/badge-store.js';
import { ServiceError } from '../services/_fake.js';
import { renderShell } from './_shell.js';

/** Halaman D: Home / Chat List. */
export function homePage({ query }) {
  let cancelled = false;
  let chats = [];
  let loadState = 'loading';
  let errorMessage = '';
  let keyword = query.q || '';

  const searchInput = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Cari percakapan...',
    'aria-label': 'Cari percakapan',
    value: keyword,
    onInput: (event) => {
      keyword = event.target.value;
      renderList();
    },
  });

  const listBody = el('div', { class: 'panel__body scroll-y' });

  const listPanel = el('section', { class: 'panel' },
    el('header', { class: 'panel__header' },
      el('h1', { class: 'panel__title' }, 'Pesan'),
      el('button', {
        class: 'btn btn--primary btn--icon',
        type: 'button',
        'aria-label': 'Percakapan baru',
        title: 'Percakapan baru',
        onClick: openNewChat,
      }, icon('plus')),
    ),
    el('div', { style: { padding: '0 var(--space-4) var(--space-3)' } }, searchInput),
    listBody,
  );

  const detailPanel = el('section', { class: 'home-page__detail panel', 'aria-hidden': 'true' },
    el('div', { class: 'detail-placeholder' },
      el('div', { class: 'state-view__icon' }, icon('chat', 'icon--lg')),
      el('p', { class: 'state-view__title' }, 'Pilih percakapan'),
      el('p', { class: 'state-view__desc' }, 'Klik salah satu di kiri untuk membuka riwayat pesan.'),
    ),
  );

  const pageNode = el('div', { class: 'home-page' }, listPanel, detailPanel);

  function visibleChats() {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return chats;
    return chats.filter((c) => c.title.toLowerCase().includes(kw) || c.preview.toLowerCase().includes(kw));
  }

  function renderList() {
    clear(listBody);
    const filtered = visibleChats();
    listBody.append(chatList({
      chats: filtered,
      state: loadState,
      errorMessage,
      onSelect: (chatId) => { location.hash = `#/app/chat/${chatId}`; },
      onRetry: () => load('ok'),
      emptyAction: keyword.trim()
        ? el('button', { class: 'btn', type: 'button', onClick: () => { keyword = ''; searchInput.value = ''; renderList(); } }, 'Bersihkan pencarian')
        : el('button', { class: 'btn btn--primary', type: 'button', onClick: openNewChat }, icon('plus'), 'Mulai percakapan'),
    }));
  }

  async function load(state = query.state || 'ok', { silent = false } = {}) {
    if (!silent) {
      loadState = 'loading';
      renderList();
    }
    try {
      const data = await listChats({ state });
      if (cancelled) return;
      chats = data;
      loadState = 'ok';
      errorMessage = '';
      // Badge navbar "Pesan" = total unread dari listChats (live).
      const unreadTotal = data.reduce((sum, c) => sum + (c.unread || 0), 0);
      setBadges({ unreadChats: unreadTotal });
    } catch (error) {
      if (cancelled) return;
      // Refresh senyap (realtime): biarkan daftar lama tetap tampil.
      if (silent) return;
      loadState = 'error';
      errorMessage = error instanceof ServiceError ? error.message : 'Terjadi kesalahan tak terduga.';
    }
    renderList();
  }

  /* ---------------- Realtime: pesan masuk & presence online ---------------- */
  let refreshTimer = 0;
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      if (cancelled || loadState === 'loading') return;
      load('ok', { silent: true }); // pesan baru -> preview/unread urutan list ikut update
    }, 600);
  }
  const unsubscribeFeed = subscribeMessageFeed(scheduleRefresh);
  const unsubscribePresence = subscribePresence(() => {
    if (cancelled || loadState !== 'ok') return;
    chats = withFreshPresence(chats); // subtitle Online/Offline direct-chat ikut terkini
    renderList();
  });

  function openNewChat() {
    let modalRef;
    modalRef = openModal({
      title: 'Percakapan baru',
      body: el('div', { class: 'stack' },
        el('p', { class: 'text-sm text-muted' }, 'Mau mulai percakapan seperti apa?'),
        el('button', {
          class: 'menu-item', type: 'button',
          onClick: () => { modalRef.close(); openOneOnOne(); },
        }, icon('chat'), 'Chat 1:1 dengan teman'),
        el('button', {
          class: 'menu-item', type: 'button',
          onClick: () => { modalRef.close(); openCreateGroup(); },
        }, icon('users'), 'Buat grup baru'),
      ),
    });
  }

  function openOneOnOne() {
    let modalRef;
    const body = el('div', { class: 'stack' },
      el('p', { class: 'text-sm text-muted' }, 'Pilih teman untuk memulai percakapan.'),
      el('div', { class: 'stack', id: 'friend-picker' },
        el('div', { class: 'skeleton' },
          el('div', { class: 'skeleton__block skeleton__line' }),
          el('div', { class: 'skeleton__block skeleton__line skeleton__line--mid' }),
        ),
      ),
    );
    modalRef = openModal({ title: 'Percakapan 1:1', body });

    listFriends({ state: query.state === 'empty' ? 'empty' : 'ok' }).then((friends) => {
      const holder = body.querySelector('#friend-picker');
      if (!holder) return;
      clear(holder);
      if (!friends.length) {
        holder.append(
          el('p', { class: 'text-sm text-muted' }, 'Belum ada teman. Tambah teman lewat kode akun atau QR.'),
          el('a', { class: 'btn btn--primary', href: '#/app/friends', onClick: () => modalRef.close() }, icon('user-plus'), 'Buka Teman'),
        );
        return;
      }
      for (const friend of friends) {
        holder.append(el('button', {
          class: 'list-item list-item--card',
          type: 'button',
          onClick: async () => {
            modalRef.close();
            try {
              const chatId = await startChatWith(friend.id);
              location.hash = `#/app/chat/${chatId}`;
            } catch (error) {
              showToast(error instanceof ServiceError ? error.message : 'Gagal membuat percakapan.', 'error');
            }
          },
        },
          avatar({ name: friend.displayName, id: friend.id, size: 'sm', online: friend.online || isOnline(friend.id) }),
          el('div', { class: 'list-item__main' },
            el('div', { class: 'list-item__title' }, friend.displayName),
            el('div', { class: 'list-item__preview' }, friend.publicCode),
          ),
          icon('chevron-right'),
        ));
      }
    }).catch((error) => {
      const holder = body.querySelector('#friend-picker');
      if (holder) {
        clear(holder);
        holder.append(el('p', { class: 'text-sm text-danger' },
          error instanceof ServiceError ? error.message : 'Gagal memuat teman.'));
      }
    });
  }

  function openCreateGroup() {
    let modalRef;
    const selected = new Set();
    const nameInput = el('input', {
      class: 'input', type: 'text', maxlength: '60',
      placeholder: 'Nama grup (3-60 karakter)', 'aria-label': 'Nama grup',
    });
    const errorBox = el('p', { class: 'field__error hidden' });
    const pickerHolder = el('div', { class: 'stack' },
      el('div', { class: 'skeleton' },
        el('div', { class: 'skeleton__block skeleton__line' }),
        el('div', { class: 'skeleton__block skeleton__line skeleton__line--mid' }),
      ),
    );
    const countLabel = el('p', { class: 'text-xs text-muted' }, '0 teman dipilih');
    const submitBtn = el('button', { class: 'btn btn--primary btn--block', type: 'button', disabled: true },
      icon('users'), 'Buat Grup');

    function refreshSubmit() {
      const nameOk = nameInput.value.trim().length >= 3;
      submitBtn.disabled = !nameOk || selected.size < 1;
      countLabel.textContent = `${selected.size} teman dipilih`;
    }
    nameInput.addEventListener('input', refreshSubmit);

    modalRef = openModal({
      title: 'Buat grup baru',
      body: [
        el('div', { class: 'field' },
          el('label', { class: 'field__label' }, 'Nama grup'),
          nameInput, errorBox,
        ),
        el('p', { class: 'field__label' }, 'Pilih anggota (minimal 1 teman)'),
        countLabel,
        pickerHolder,
      ],
      footer: [
        el('button', { class: 'btn', type: 'button', onClick: () => modalRef.close() }, 'Batal'),
        submitBtn,
      ],
    });

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      errorBox.classList.add('hidden');
      if (name.length < 3) {
        clear(errorBox);
        errorBox.classList.remove('hidden');
        errorBox.append(icon('alert-circle'), el('span', {}, 'Nama grup minimal 3 karakter.'));
        return;
      }
      if (selected.size < 1) {
        clear(errorBox);
        errorBox.classList.remove('hidden');
        errorBox.append(icon('alert-circle'), el('span', {}, 'Pilih minimal satu anggota.'));
        return;
      }
      submitBtn.disabled = true;
      try {
        const groupId = await createGroup(name, [...selected]);
        modalRef.close();
        showToast('Grup berhasil dibuat.', 'success');
        location.hash = `#/app/chat/${groupId}`;
      } catch (error) {
        submitBtn.disabled = false;
        clear(errorBox);
        errorBox.classList.remove('hidden');
        errorBox.append(icon('alert-circle'), el('span', {},
          error instanceof ServiceError ? error.message : 'Gagal membuat grup.'));
      }
    });

    listFriends({ state: query.state === 'empty' ? 'empty' : 'ok' }).then((friends) => {
      clear(pickerHolder);
      if (!friends.length) {
        pickerHolder.append(
          el('p', { class: 'text-sm text-muted' }, 'Belum ada teman. Tambah teman dulu lewat kode akun atau QR.'),
          el('a', { class: 'btn', href: '#/app/friends', onClick: () => modalRef.close() }, icon('user-plus'), 'Buka Teman'),
        );
        return;
      }
      for (const friend of friends) {
        const check = el('span', { class: 'badge', 'aria-hidden': 'true' }, icon('plus'));
        const row = el('button', {
          class: 'list-item list-item--card', type: 'button', 'aria-pressed': 'false',
          onClick: () => {
            if (selected.has(friend.id)) {
              selected.delete(friend.id);
              row.setAttribute('aria-pressed', 'false');
              row.classList.remove('is-selected');
              clear(check);
              check.append(icon('plus'));
              check.className = 'badge';
            } else {
              selected.add(friend.id);
              row.setAttribute('aria-pressed', 'true');
              row.classList.add('is-selected');
              clear(check);
              check.append(icon('check'));
              check.className = 'badge badge--primary';
            }
            refreshSubmit();
          },
        },
          avatar({ name: friend.displayName, id: friend.id, size: 'sm', online: friend.online || isOnline(friend.id) }),
          el('div', { class: 'list-item__main' },
            el('div', { class: 'list-item__title' }, friend.displayName),
            el('div', { class: 'list-item__preview' }, friend.publicCode),
          ),
          check,
        );
        pickerHolder.append(row);
      }
    }).catch((error) => {
      clear(pickerHolder);
      pickerHolder.append(el('p', { class: 'text-sm text-danger' },
        error instanceof ServiceError ? error.message : 'Gagal memuat teman.'));
    });
  }

  load();
  return {
    node: renderShell({ active: 'chats' }, pageNode),
    cleanup: () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribeFeed();
      unsubscribePresence();
    },
  };
}
