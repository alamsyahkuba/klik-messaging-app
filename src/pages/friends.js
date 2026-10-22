import { el, clear } from '../utils/dom.js';
import { icon } from '../components/icon.js';
import { avatar } from '../components/avatar.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { emptyState, errorState, skeletonList } from '../components/state-view.js';
import { formatDayLabel } from '../utils/format-time.js';
import {
  listFriends, listIncoming, listOutgoing,
  findByCode, sendRequest, cancelRequest, acceptRequest, rejectRequest,
  removeFriend,
} from '../services/friends-service.js';
import { startChatWith } from '../services/chats-service.js';
import { detectScanner, startScan } from '../services/scanner-service.js';
import { isOnline, subscribePresence } from '../services/presence-service.js';
import { setBadges } from '../services/badge-store.js';
import { ServiceError } from '../services/_fake.js';
import { renderShell } from './_shell.js';

/** Halaman E: Friends. */
export function friendsPage({ query }) {
  let cancelled = false;
  let activeTab = query.tab || 'friends';
  let firstLoadState = query.state || 'ok';
  /** Data tab yang sedang tampil (untuk re-render saat presence berubah). */
  let lastData = null;

  const tabsDef = [
    { key: 'friends', label: 'Teman' },
    { key: 'incoming', label: 'Masuk' },
    { key: 'outgoing', label: 'Keluar' },
  ];

  const tabButtons = tabsDef.map((tab) => el('button', {
    class: 'tab',
    type: 'button',
    dataset: { tab: tab.key },
    'aria-pressed': String(tab.key === activeTab),
    onClick: () => switchTab(tab.key),
  }, tab.label));

  const body = el('div', { class: 'panel__body scroll-y' });

  const header = el('header', { class: 'panel__header' },
    el('h1', { class: 'panel__title' }, 'Teman'),
    el('span', { class: 'topbar__spacer' }),
    el('button', {
      class: 'btn btn--icon', type: 'button', title: 'Pindai QR', 'aria-label': 'Pindai QR teman',
      onClick: () => openAddModal({ mode: 'scan' }),
    }, icon('qr')),
    el('button', {
      class: 'btn btn--primary', type: 'button', onClick: () => openAddModal({ mode: 'manual' }),
    }, icon('user-plus'), 'Tambah'),
  );

  const panel = el('section', { class: 'panel panel--fill' },
    header,
    el('div', { style: { padding: '0 var(--space-4) var(--space-3)' } }, el('div', { class: 'tabs' }, tabButtons)),
    body,
  );

  function switchTab(key) {
    activeTab = key;
    for (const btn of tabButtons) {
      const isActive = btn.dataset.tab === key;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    }
    load(firstLoadState);
    firstLoadState = 'ok';
  }

  async function load(state = 'ok') {
    lastData = null; // cegah re-render presence memakai data tab lama saat masih loading
    clear(body);
    body.append(skeletonList(5));
    try {
      if (cancelled) return;
      let data;
      if (activeTab === 'friends') data = await listFriends({ state });
      else if (activeTab === 'incoming') data = await listIncoming({ state });
      else data = await listOutgoing({ state });
      if (cancelled) return;
      // Badge navbar "Teman" = jumlah permintaan masuk (live).
      if (activeTab === 'incoming' && state === 'ok') {
        setBadges({ pendingFriends: data.length });
      }
      lastData = data;
      renderTab(data);
    } catch (error) {
      if (cancelled) return;
      clear(body);
      body.append(errorState({
        title: 'Gagal memuat data teman',
        message: error instanceof ServiceError ? error.message : 'Terjadi kesalahan.',
        onRetry: () => load('ok'),
      }));
    }
  }

  function renderTab(data) {
    clear(body);
    if (!data.length) {
      body.append(emptyStateFor(activeTab));
      return;
    }
    const list = el('div', { class: 'list' });
    for (const item of data) {
      list.append(activeTab === 'friends' ? friendRow(item) : requestRow(item));
    }
    body.append(list);
  }

  /** Status online terkini utk seorang teman (presence live; demo pakai dummy). */
  function friendOnline(user) {
    return Boolean(user?.online) || isOnline(user?.id);
  }

  // Presence berubah (teman online/offline) -> render ulang tab aktif dgn status terkini.
  const unsubscribePresence = subscribePresence(() => {
    if (cancelled || !lastData) return;
    renderTab(lastData);
  });

  function emptyStateFor(tab) {
    if (tab === 'friends') {
      return emptyState({
        iconName: 'users',
        title: 'Belum ada teman',
        desc: 'Tambahkan teman memakai kode akun atau dengan memindai QR mereka.',
        action: el('button', { class: 'btn btn--primary', type: 'button', onClick: () => openAddModal({ mode: 'manual' }) },
          icon('user-plus'), 'Tambah teman'),
      });
    }
    if (tab === 'incoming') {
      return emptyState({ iconName: 'inbox', title: 'Tidak ada permintaan masuk', desc: 'Permintaan pertemanan dari orang lain akan muncul di sini.' });
    }
    return emptyState({ iconName: 'send', title: 'Tidak ada permintaan keluar', desc: 'Permintaan yang kamu kirim dan menunggu jawaban ada di sini.' });
  }

  function friendRow(friend) {
    return el('div', { class: 'list-item list-item--static' },
      avatar({ name: friend.displayName, id: friend.id, online: friendOnline(friend) }),
      el('div', { class: 'list-item__main' },
        el('div', { class: 'list-item__title' }, friend.displayName),
        el('div', { class: 'list-item__preview text-mono' }, friend.publicCode),
      ),
      el('div', { class: 'row', style: { gap: '6px' } },
        el('button', {
          class: 'btn btn--primary btn--sm', type: 'button',
          title: 'Mulai chat',
          onClick: async () => {
            try {
              const chatId = await startChatWith(friend.id);
              location.hash = `#/app/chat/${chatId}`;
            } catch (error) {
              showToast(error instanceof ServiceError ? error.message : 'Gagal memulai chat.', 'error');
            }
          },
        }, icon('chat'), 'Chat'),
        el('button', {
          class: 'btn btn--sm', type: 'button', 'aria-label': `Profil ${friend.displayName}`,
          onClick: () => openFriendProfile(friend),
        }, icon('info')),
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Hapus ${friend.displayName}`,
          onClick: () => confirmRemoveFriend(friend),
        }, icon('trash')),
      ),
    );
  }

  function requestRow(item) {
    const isIncoming = activeTab === 'incoming';
    return el('div', { class: 'list-item list-item--static' },
      avatar({ name: item.user.displayName, id: item.user.id, online: friendOnline(item.user) }),
      el('div', { class: 'list-item__main' },
        el('div', { class: 'list-item__title' }, item.user.displayName),
        el('div', { class: 'list-item__preview' },
          isIncoming
            ? (item.user.mutual ? `${item.user.mutual} teman bersama` : 'Ingin berteman denganmu')
            : 'Menunggu jawaban',
        ),
      ),
      isIncoming
        ? el('div', { class: 'row', style: { gap: '6px' } },
            el('button', {
              class: 'btn btn--secondary btn--sm', type: 'button',
              onClick: () => runAction(() => acceptRequest(item.id), 'Permintaan diterima.'),
            }, icon('check'), 'Terima'),
            el('button', {
              class: 'btn btn--sm', type: 'button',
              onClick: () => runAction(() => rejectRequest(item.id), 'Permintaan ditolak.'),
            }, icon('x'), 'Tolak'),
          )
        : el('button', {
            class: 'btn btn--sm', type: 'button',
            onClick: () => runAction(() => cancelRequest(item.id), 'Permintaan dibatalkan.'),
          }, icon('x'), 'Batalkan'),
    );
  }

  async function runAction(action, successMessage) {
    try {
      await action();
      showToast(successMessage, 'success');
      load('ok');
      refreshShellSoon();
    } catch (error) {
      showToast(error instanceof ServiceError ? error.message : 'Operasi gagal.', 'error');
    }
  }

  function refreshShellSoon() {
    // Badge navigasi dihitung dari data dummy saat shell berikutnya dirender.
  }

  async function confirmRemoveFriend(friend) {
    const { confirmModal } = await import('../components/modal.js');
    const ok = await confirmModal({
      title: 'Hapus teman?',
      message: `${friend.displayName} akan dihapus dari daftar teman. Riwayat percakapan yang sudah ada tidak ikut terhapus.`,
      confirmLabel: 'Hapus',
      danger: true,
    });
    if (ok) runAction(() => removeFriend(friend.id), 'Teman dihapus.');
  }

  function openFriendProfile(friend) {
    let modalRef;
    const infoRow = (key, value) => el('div', { class: 'info-row' },
      el('span', { class: 'info-row__key' }, key),
      el('span', { class: 'info-row__value' }, value),
    );
    const onlineNow = () => friendOnline(friend);
    const avatarNode = avatar({ name: friend.displayName, id: friend.id, size: 'lg', online: onlineNow() });
    const statusText = el('p', { class: 'text-sm text-muted' }, onlineNow() ? 'Online' : 'Sedang offline');
    const sinceText = friend.friendSince
      ? formatDayLabel(friend.friendSince)
      : (friend.isFriend !== false ? 'Sudah berteman' : 'Belum berteman');
    // Status online di modal ikut perubahan presence selama modal terbuka.
    const unsubscribe = subscribePresence(() => {
      if (!statusText.isConnected) { unsubscribe(); return; }
      const on = onlineNow();
      statusText.textContent = on ? 'Online' : 'Sedang offline';
      const dot = avatarNode.querySelector('.avatar__status');
      if (dot) dot.classList.toggle('avatar__status--offline', !on);
    });
    modalRef = openModal({
      title: 'Profil teman',
      onClose: () => unsubscribe(),
      body: [
        el('div', { class: 'row', style: { justifyContent: 'center' } }, avatarNode),
        el('div', { class: 'text-center' },
          el('p', { class: 'text-lg' }, friend.displayName),
          statusText,
        ),
        el('div', { class: 'info-grid' },
          infoRow('Kode akun', friend.publicCode),
          infoRow('Teman sejak', sinceText),
        ),
        el('div', { class: 'notice' }, icon('lock'),
          el('span', {}, 'Kode akun bersifat publik. Kredensial login (passphrase) tidak pernah ditampilkan di sini.')),
      ],
      footer: [
        el('button', { class: 'btn', type: 'button', onClick: () => { modalRef.close(); confirmRemoveFriend(friend); } }, 'Hapus teman'),
        el('button', {
          class: 'btn btn--primary', type: 'button',
          onClick: async () => {
            modalRef.close();
            try {
              const chatId = await startChatWith(friend.id);
              location.hash = `#/app/chat/${chatId}`;
            } catch (error) {
              showToast(error instanceof ServiceError ? error.message : 'Gagal memulai chat.', 'error');
            }
          },
        }, icon('chat'), 'Mulai chat'),
      ],
    });
  }

  /** Modal tambah teman: input kode manual + jalur pemindaian QR. */
  function openAddModal({ mode = 'manual' }) {
    let modalRef;
    const input = el('input', {
      class: 'input text-mono', type: 'text',
      placeholder: 'KLIK-XXXX-XXXX',
      'aria-label': 'Kode akun teman',
      autocapitalize: 'characters', spellcheck: 'false',
    });
    const resultBox = el('div', { class: 'stack hidden', id: 'lookup-result' });
    const errorBox = el('p', { class: 'field__error hidden', role: 'alert' });

    async function lookup() {
      errorBox.classList.add('hidden');
      resultBox.classList.add('hidden');
      try {
        const user = await findByCode(input.value);
        clear(resultBox);
        resultBox.append(
          el('div', { class: 'card', style: { display: 'flex', gap: '12px', alignItems: 'center' } },
            avatar({ name: user.displayName, id: user.id, online: friendOnline(user) }),
            el('div', { class: 'grow' },
              el('p', { class: 'text-lg' }, user.displayName),
              el('p', { class: 'text-xs text-muted text-mono' }, user.publicCode),
              user.mutual ? el('p', { class: 'text-xs text-muted' }, `${user.mutual} teman bersama`) : null,
            ),
            el('button', {
              class: 'btn btn--primary btn--sm', type: 'button',
              onClick: async () => {
                try {
                  await sendRequest(user.id);
                  showToast('Permintaan pertemanan dikirim.', 'success');
                  closeModal();
                  switchTab('outgoing');
                } catch (error) {
                  showError(error instanceof ServiceError ? error.message : 'Gagal mengirim permintaan.');
                }
              },
            }, 'Kirim'),
          ),
        );
        resultBox.classList.remove('hidden');
      } catch (error) {
        showError(error instanceof ServiceError ? error.message : 'Pencarian gagal.');
      }
    }

    function showError(message) {
      clear(errorBox);
      errorBox.append(icon('alert-circle'), el('span', {}, message));
      errorBox.classList.remove('hidden');
    }

    let scanHandle = null;
    const scanHost = el('div', { class: 'stack', style: { marginBottom: 'var(--space-2)' } });

    function showManualScanButton() {
      if (mode === 'scan') return; // mode scan sudah auto-start di setupScan()
      clear(scanHost);
      scanHost.append(
        el('button', {
          class: 'btn btn--sm', type: 'button',
          onClick: () => { clear(scanHost); setupScan(); },
        }, icon('qr'), 'Pindai QR'),
      );
    }

    /** Tampilkan tombol "Scan ulang" + pesan (cancel/izin/gagal). */
    function showScanStopped(message) {
      clear(scanHost);
      scanHost.append(
        el('div', { class: 'notice' }, icon('camera'), el('span', {}, message)),
        el('button', {
          class: 'btn btn--sm', type: 'button',
          onClick: () => { clear(scanHost); setupScan(); },
        }, icon('qr'), 'Scan ulang'),
      );
    }

    async function setupScan() {
      if (mode !== 'scan') return;
      const kind = await detectScanner();
      if (cancelled) return;
      if (!kind) {
        scanHost.append(el('div', { class: 'notice' }, icon('camera'),
          el('span', {}, 'Kamera/pemindai tidak tersedia di lingkungan ini. Gunakan input kode manual di bawah - QR berisi kode akun publik yang sama.')));
        return;
      }
      // ML Kit memakai UI native sendiri (punya tombol close); stopBtn hanya untuk jalur BarcodeDetector.
      const stopBtn = kind === 'barcode-detector'
        ? el('button', { class: 'btn btn--sm', type: 'button' }, icon('x'), 'Berhenti memindai')
        : null;
      const status = el('p', { class: 'text-xs text-muted' },
        kind === 'mlkit' ? 'Membuka kamera perangkat...' : 'Arahkan kamera ke QR kode akun teman...');
      scanHost.append(status, ...(stopBtn ? [stopBtn] : []));
      try {
        scanHandle = await startScan({
          onResult: (text) => {
            input.value = text.trim();
            lookup();
          },
          videoHost: kind === 'barcode-detector' ? scanHost : null,
        });
      } catch (error) {
        if (cancelled) return;
        const msgRaw = String(error?.message || '');
        if (/cancel/i.test(msgRaw)) {
          showScanStopped('Pemindaian dibatalkan. Tekan "Scan ulang" untuk mencoba lagi, atau gunakan input kode manual di bawah.');
        } else if (msgRaw === 'IZIN_DITOLAK') {
          showScanStopped('Izin kamera ditolak. Aktifkan izin kamera di Pengaturan aplikasi, atau gunakan input kode manual di bawah.');
        } else {
          showScanStopped('Gagal membuka kamera. Tekan "Scan ulang" atau gunakan input kode manual di bawah.');
        }
        return;
      }
      stopBtn?.addEventListener('click', () => {
        scanHandle?.stop?.();
        scanHandle = null;
        clear(scanHost);
        scanHost.append(
          el('p', { class: 'text-xs text-muted' }, 'Pemindaian dihentikan.'),
          el('button', {
            class: 'btn btn--sm', type: 'button',
            onClick: () => { clear(scanHost); setupScan(); },
          }, icon('qr'), 'Scan ulang'),
        );
      });
    }

    const scanNote = null; // digantikan scanHost dinamis

    modalRef = openModal({
      title: mode === 'scan' ? 'Pindai QR teman' : 'Tambah teman',
      body: [
        scanHost,
        el('div', { class: 'field' },
          el('label', { class: 'field__label' }, 'Kode akun'),
          el('div', { class: 'input-group' },
            input,
            el('button', { class: 'btn btn--primary', type: 'button', onClick: lookup }, icon('search'), 'Cari'),
          ),
          el('span', { class: 'field__hint' }, 'Contoh: KLIK-7Q2M-9X4D. Kode bersifat publik dan bukan password.'),
          errorBox,
        ),
        resultBox,
      ],
      footer: [el('button', { class: 'btn', type: 'button', onClick: () => { scanHandle?.stop?.(); closeModal(); } }, 'Tutup')],
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); lookup(); }
    });

    if (mode === 'scan') {
      setupScan();
    } else {
      showManualScanButton();
    }
  }

  switchTab(activeTab);

  return {
    node: renderShell({ active: 'friends' }, panel),
    cleanup: () => {
      cancelled = true;
      unsubscribePresence();
    },
  };
}
