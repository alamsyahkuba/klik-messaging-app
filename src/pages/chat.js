import { el, clear } from '../utils/dom.js';
import { icon } from '../components/icon.js';
import { avatar } from '../components/avatar.js';
import { messageBubble } from '../components/message-bubble.js';
import { chatList } from '../components/chat-list.js';
import { showToast } from '../components/toast.js';
import { emptyState, errorState, skeletonList, skeletonMessages } from '../components/state-view.js';
import { openModal, closeModal, confirmModal } from '../components/modal.js';
import { isSameDay, formatDayLabel, formatRelative } from '../utils/format-time.js';
import { localId } from '../utils/id.js';
import { me } from '../data/dummy.js';
import {
  getChat, listMessages, listChats, sendMessage, markChatRead,
  listMembers, userById, leaveGroup,
  addGroupMember, removeGroupMember, setMemberRole, isGroupAdmin, myRole,
  subscribeRoom, subscribeMessageFeed, withFreshPresence, peerSubtitle,
  proposeConversion, approveConversion, cancelConversion,
  flushOutbox,
} from '../services/chats-service.js';
import { isOnline, subscribePresence } from '../services/presence-service.js';
import { currentUserId } from '../services/auth-service.js';
import { listFriends } from '../services/friends-service.js';
import { ServiceError } from '../services/_fake.js';
import { renderShell } from './_shell.js';

/** Notifikasi dibisukan per room (sesi berjalan, Milestone 1). */
const mutedChats = new Set();

/**
 * Halaman F/G/H: Chat Room, Private Chat, dan Group Room.
 * Satu halaman melayani ketiga tipe karena alur pesan sama;
 * perbedaan tampilan lewat header, panel info, dan hak aksi.
 */
export function chatPage({ params, query }) {
  const chatId = params.id;
  const previewState = query.state || 'ok';

  let cancelled = false;
  let chat = null;
  let messages = [];
  let replyTarget = null;
  let loadState = 'loading';
  let errorMessage = '';
  let drawerRef = null;
  /** Id user sesi aktif (live: UUID Supabase; demo: id dummy me). */
  let myUid = me.id;
  let unsubscribeRoom = null;

  /** Cari info orang: prioritas member live dari getChat, fallback dummy. */
  function personById(id) {
    if (!id) return null;
    const fromChat = chat?.members?.find((m) => m.id === id);
    if (fromChat) {
      return { id, displayName: fromChat.displayName, publicCode: fromChat.publicCode, online: isOnline(id) };
    }
    return userById(id);
  }

  /* ---------------- Kolom kiri: daftar percakapan (desktop) ---------------- */
  let listCache = [];
  let listState = 'loading';
  const listBody = el('div', { class: 'panel__body scroll-y' });
  const listCol = el('section', { class: 'panel chat-page__list', 'aria-label': 'Daftar percakapan' },
    el('header', { class: 'panel__header' },
      el('h1', { class: 'panel__title' }, 'Pesan'),
      el('a', { class: 'btn btn--primary btn--icon', href: '#/app/chats', 'aria-label': 'Percakapan baru', title: 'Percakapan baru' }, icon('plus')),
    ),
    listBody,
  );

  /* ---------------- Kolom kanan: percakapan ---------------- */
  const titleEl = el('span', { class: 'chat-header__name' }, 'Memuat...');
  const statusEl = el('span', { class: 'chat-header__status' }, '');
  const headerAvatar = el('span', {}, avatar({ name: '...', id: chatId, size: 'sm' }));

  const connPill = el('span', { class: 'pill', role: 'status' },
    el('span', { class: 'pill__dot' }), 'Terhubung');

  const backBtn = el('a', {
    class: 'btn btn--ghost btn--icon chat-header__back',
    href: '#/app/chats', 'aria-label': 'Kembali ke daftar chat',
  }, icon('arrow-left'));

  const infoBtn = el('button', {
    class: 'btn btn--ghost btn--icon',
    type: 'button',
    'aria-label': 'Informasi percakapan',
    title: 'Info percakapan',
    onClick: () => (drawerRef ? closeInfo() : openInfo()),
  }, icon('info'));

  const header = el('header', { class: 'chat-header' },
    backBtn,
    el('button', {
      class: 'chat-header__identity', type: 'button',
      'aria-label': 'Buka info percakapan',
      onClick: () => openInfo(),
    },
      headerAvatar,
      el('span', { class: 'grow', style: { minWidth: '0', textAlign: 'left' } },
        titleEl,
        el('span', { class: 'chat-header__status', style: { display: 'block' } }, statusEl),
      ),
    ),
    connPill,
    infoBtn,
  );

  const messagesEl = el('div', { class: 'messages scroll-y', 'aria-live': 'polite' });

  const replyBar = el('div', { class: 'composer__reply hidden' });
  const textarea = el('textarea', {
    class: 'composer__input',
    rows: '1',
    placeholder: 'Tulis pesan...',
    'aria-label': 'Tulis pesan',
    enterkeyhint: 'send',
    onInput: () => autoGrow(),
    onKeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        handleSend();
      }
    },
  });

  const sendBtn = el('button', {
    class: 'btn btn--primary btn--icon',
    type: 'button',
    'aria-label': 'Kirim pesan',
    onClick: () => handleSend(),
  }, icon('send'));

  const composer = el('div', { class: 'composer' }, replyBar, textarea, sendBtn);

  const mainCol = el('section', { class: 'panel chat-page__main', 'aria-label': 'Ruang percakapan' },
    header, messagesEl, composer,
  );

  const root = el('div', { class: 'chat-page chat-page--with-list' }, listCol, mainCol);

  /* ---------------- Koneksi ---------------- */
  function renderConnection() {
    clear(connPill);
    const online = navigator.onLine;
    connPill.className = `pill${online ? '' : ' pill--offline'}`;
    connPill.append(
      el('span', { class: 'pill__dot' }),
      online ? 'Terhubung' : 'Offline',
    );
    connPill.setAttribute('aria-label', online ? 'Koneksi aktif' : 'Tidak ada koneksi');
  }

  function handleOnline() {
    clear(connPill);
    connPill.className = 'pill pill--warn';
    connPill.append(el('span', { class: 'pill__dot' }), 'Menghubungkan...');
    setTimeout(async () => {
      if (cancelled) return;
      renderConnection();
      try {
        const flushed = await flushOutbox();
        if (cancelled) return;
        if (flushed.length) showToast(`${flushed.length} pesan tertunda terkirim.`, 'success');
        else showToast('Koneksi pulih. Menyinkronkan...', 'success');
        await loadChat('ok');
        loadList();
      } catch {
        if (!cancelled) showToast('Koneksi pulih, tetapi sinkronisasi gagal.', 'error');
      }
    }, 700);
  }

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', renderConnection);
  renderConnection();

  /* ---------------- Render daftar ---------------- */
  function renderListBody() {
    clear(listBody);
    listBody.append(chatList({
      chats: listCache,
      activeId: chatId,
      state: listState,
      errorMessage: 'Gagal memuat daftar percakapan.',
      onSelect: (id) => { location.hash = `#/app/chat/${id}`; },
      onRetry: loadList,
    }));
  }

  async function loadList({ silent = false } = {}) {
    if (!silent) {
      listState = 'loading';
      renderListBody();
    }
    try {
      const data = await listChats({ state: silent ? 'ok' : previewState });
      if (cancelled) return;
      listCache = withFreshPresence(data);
      listState = 'ok';
    } catch {
      if (cancelled) return;
      if (silent) return; // refresh senyap: pertahankan daftar lama
      listState = 'error';
    }
    renderListBody();
  }

  /* ---------------- Realtime: feed pesan & presence online ---------------- */
  let feedTimer = 0;
  const unsubscribeFeed = subscribeMessageFeed(() => {
    // Pesan baru di room lain -> daftar kolom kiri ikut update tanpa keluar room.
    if (feedTimer) return;
    feedTimer = setTimeout(() => {
      feedTimer = 0;
      if (cancelled || listState === 'loading') return;
      loadList({ silent: true });
    }, 600);
  });

  const unsubscribePresence = subscribePresence(() => {
    if (cancelled) return;
    let changed = false;
    if (chat && chat.type !== 'group' && chat.peerId) {
      const next = peerSubtitle(chat.peerId);
      if (next && next !== chat.subtitle) {
        chat.subtitle = next;
        changed = true;
        renderHeader();
        if (drawerRef) fillDrawer(drawerRef.body);
      }
    }
    if (listState === 'ok') {
      const fresh = withFreshPresence(listCache);
      if (fresh.some((row, index) => row !== listCache[index])) {
        listCache = fresh;
        renderListBody();
      }
    }
    return changed;
  });

  /* ---------------- Render header & pesan ---------------- */
  function renderHeader() {
    if (!chat) {
      titleEl.textContent = 'Memuat percakapan...';
      statusEl.textContent = '';
      infoBtn.disabled = true;
      return;
    }
    infoBtn.disabled = false;
    titleEl.textContent = chat.title;
    statusEl.textContent = chat.type === 'group'
      ? `${chat.memberIds.length} anggota`
      : chat.subtitle;

    clear(headerAvatar);
    headerAvatar.append(avatar({
      name: chat.title,
      id: chat.peerId || chat.title,
      size: 'sm',
      online: chat.type === 'group' ? null : chat.subtitle === 'Online',
    }));
  }

  function renderMessages({ scrollToEnd = false } = {}) {
    clear(messagesEl);

    if (loadState === 'loading') {
      messagesEl.append(skeletonMessages(7));
      return;
    }
    if (loadState === 'error') {
      messagesEl.append(errorState({
        title: 'Gagal memuat pesan',
        message: errorMessage,
        onRetry: () => loadChat('ok'),
      }));
      return;
    }
    if (!messages.length) {
      messagesEl.append(emptyState({
        iconName: 'message-square',
        title: 'Belum ada pesan',
        desc: 'Mulai obrolan dengan mengirim pesan pertama.',
      }));
      return;
    }

    const byId = new Map(messages.map((m) => [m.id, m]));
    let previous = null;
    for (const message of messages) {
      if (!previous || !isSameDay(previous.at, message.at)) {
        messagesEl.append(el('div', { class: 'day-divider' }, formatDayLabel(message.at)));
      }
      const mine = message.senderId === myUid;
      const sender = personById(message.senderId);
      const target = message.replyTo ? byId.get(message.replyTo) : null;
      messagesEl.append(messageBubble(message, {
        mine,
        showSender: chat?.type === 'group',
        senderName: sender?.displayName || 'Anggota',
        replyTarget: target
          ? { senderName: personById(target.senderId)?.displayName || '', text: target.text }
          : null,
        onReply: startReply,
        onCopy: copyMessage,
      }));
      previous = message;
    }
    if (scrollToEnd) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /* ---------------- Muat data ---------------- */
  async function loadChat(state = 'ok') {
    loadState = 'loading';
    errorMessage = '';
    renderHeader();
    renderMessages();
    try {
      myUid = (await currentUserId()) || me.id;
      chat = await getChat(chatId, { state });
      if (cancelled) return;
      messages = await listMessages(chatId, { state: state === 'ok' ? 'ok' : state });
      if (cancelled) return;
      loadState = 'ok';
      markChatRead(chatId);
      renderHeader();
      renderMessages({ scrollToEnd: true });
      setupRealtime();
    } catch (error) {
      if (cancelled) return;
      chat = null;
      loadState = 'error';
      errorMessage = error instanceof ServiceError ? error.message : 'Terjadi kesalahan tak terduga.';
      renderHeader();
      renderMessages();
    }
  }

  /* ---------------- Realtime (pesan masuk + update room) ---------------- */
  function setupRealtime() {
    if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
    unsubscribeRoom = subscribeRoom(chatId, {
      onMessage: (message) => {
        if (cancelled || loadState !== 'ok') return;
        if (messages.some((m) => m.id === message.id)) return;
        messages.push(message);
        renderMessages({ scrollToEnd: true });
        markChatRead(chatId);
        renderListBodySafe();
      },
      onRoomChange: async () => {
        if (cancelled) return;
        try {
          const fresh = await getChat(chatId, { state: 'ok' });
          if (cancelled) return;
          const becamePrivate = chat?.type !== 'private' && fresh.type === 'private';
          chat = fresh;
          renderHeader();
          if (becamePrivate) {
            showToast('Percakapan resmi menjadi Chat Privat.', 'success');
          }
          if (drawerRef) fillDrawer(drawerRef.body);
        } catch { /* refresh gagal - abaikan */ }
      },
    });
  }

  /* ---------------- Kirim pesan ---------------- */
  let growRaf = 0;
  function autoGrow() {
    if (growRaf) return;
    const apply = () => {
      growRaf = 0;
      textarea.style.height = 'auto';
      const next = `${Math.min(textarea.scrollHeight, 132)}px`;
      if (textarea.style.height !== next) textarea.style.height = next;
    };
    growRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(apply) : (apply(), 0);
  }

  function startReply(message) {
    replyTarget = message;
    const sender = personById(message.senderId);
    clear(replyBar);
    replyBar.append(
      icon('reply'),
      el('span', { class: 'grow text-ellipsis' }, `Membalas ${sender?.displayName || ''}: ${message.text}`),
      el('button', {
        class: 'btn btn--ghost btn--icon', type: 'button',
        'aria-label': 'Batalkan balasan', onClick: clearReply,
      }, icon('x')),
    );
    replyBar.classList.remove('hidden');
    textarea.focus();
  }

  function clearReply() {
    replyTarget = null;
    replyBar.classList.add('hidden');
    clear(replyBar);
  }

  async function handleSend() {
    const text = textarea.value.trim();
    if (!text || loadState !== 'ok') return;

    const optimistic = {
      id: localId('opt'),
      senderId: myUid,
      text,
      at: new Date(),
      status: 'pending',
      replyTo: replyTarget?.id || null,
    };

    textarea.value = '';
    autoGrow();
    const pendingReply = replyTarget;
    clearReply();
    messages.push(optimistic);
    renderMessages({ scrollToEnd: true });

    try {
      const saved = await sendMessage(chatId, text, { replyTo: pendingReply?.id || null });
      if (cancelled) return;
      const index = messages.findIndex((m) => m.id === optimistic.id);
      if (index !== -1) messages[index] = { ...saved, replyTo: pendingReply?.id || null };
      renderMessages({ scrollToEnd: true });
      renderListBodySafe();
    } catch (error) {
      if (cancelled) return;
      const index = messages.findIndex((m) => m.id === optimistic.id);
      if (index !== -1) messages.splice(index, 1);
      textarea.value = text;
      if (pendingReply) startReply(pendingReply);
      autoGrow();
      renderMessages({ scrollToEnd: true });
      showToast(error instanceof ServiceError ? error.message : 'Pesan gagal terkirim.', 'error');
    }
  }

  function renderListBodySafe() {
    if (listState !== 'ok') return;
    const index = listCache.findIndex((c) => c.id === chatId);
    if (index === -1) return;
    const last = messages[messages.length - 1];
    const preview = previewForLast(last);
    listCache[index] = {
      ...listCache[index],
      ...(preview ? { preview } : {}),
      lastAt: last ? last.at : listCache[index].lastAt,
    };
    listCache.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    renderListBody();
  }

  /** Preview daftar utk pesan terakhir di room terbuka (ikut gaya RPC list_my_chats). */
  function previewForLast(last) {
    if (!last) return null;
    if (last.senderId === myUid) return `Kamu: ${last.text}`;
    if (chat?.type === 'group') {
      const sender = personById(last.senderId);
      const first = (sender?.displayName || 'Anggota').split(' ')[0];
      return `${first}: ${last.text}`;
    }
    return last.text;
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(message.text);
      showToast('Pesan disalin.', 'success');
    } catch {
      showToast('Gagal menyalin pesan.', 'error');
    }
  }

  /* ---------------- Panel info (drawer) ---------------- */
  function openInfo() {
    if (drawerRef || !chat) return;
    const host = root.closest('.app-content') || document.body;
    const backdrop = el('button', {
      class: 'drawer-backdrop', type: 'button',
      'aria-label': 'Tutup panel info', onClick: closeInfo,
    });
    const body = el('div', { class: 'drawer__body scroll-y' });
    const drawer = el('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Informasi percakapan' },
      el('div', { class: 'drawer__header' },
        el('h2', { class: 'panel__title' }, 'Info Percakapan'),
        el('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': 'Tutup', onClick: closeInfo }, icon('x')),
      ),
      body,
    );
    host.append(backdrop, drawer);
    drawerRef = { backdrop, drawer, body };
    infoBtn.setAttribute('aria-expanded', 'true');
    fillDrawer(body);
    document.addEventListener('keydown', onDrawerKey);
  }

  function onDrawerKey(event) {
    if (event.key === 'Escape' && drawerRef) closeInfo();
  }

  function closeInfo() {
    if (!drawerRef) return;
    drawerRef.backdrop.remove();
    drawerRef.drawer.remove();
    drawerRef = null;
    infoBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onDrawerKey);
    infoBtn.focus({ preventScroll: true });
  }

  function infoRow(key, value) {
    return el('div', { class: 'info-row' },
      el('span', { class: 'info-row__key' }, key),
      el('span', { class: 'info-row__value' }, value),
    );
  }

  function fillDrawer(body) {
    clear(body);
    if (!chat) return;

    const isGroup = chat.type === 'group';

    body.append(
      el('div', { class: 'stack-lg', style: { alignItems: 'center', textAlign: 'center' } },
        avatar({ name: chat.title, id: chat.peerId || chat.title, size: 'lg', round: isGroup ? false : true }),
        el('div', {},
          el('p', { class: 'text-lg' }, chat.title),
          el('p', { class: 'text-sm text-muted' },
            isGroup ? `${chat.memberIds.length} anggota` : chat.subtitle),
        ),
        el('span', { class: `badge ${chat.type === 'private' ? 'badge--primary' : isGroup ? 'badge--accent' : ''}` },
          chat.type === 'private' ? 'Chat Privat' : isGroup ? 'Grup' : 'Room Biasa'),
      ),
    );

    if (chat.type === 'group') fillGroup(body);
    else fillDirect(body);
  }

  function fillDirect(body) {
    const peer = chat.peerId ? personById(chat.peerId) : null;

    body.append(el('div', { class: 'info-grid' },
      peer ? infoRow('Kode akun', peer.publicCode) : null,
      infoRow('Status', chat.subtitle),
      infoRow('Anggota', `${chat.memberIds.length} orang`),
      chat.createdAt ? infoRow('Dibuat', formatRelative(chat.createdAt)) : null,
    ));

    body.append(el('div', { class: 'notice' }, icon('lock'),
      el('span', {},
        'Chat privat hanya dapat diakses dua anggota. Ini BUKAN enkripsi end-to-end - pesan tetap disimpan di server.')));

    body.append(el('div', { class: 'switch-row' },
      el('div', {},
        el('p', { class: 'switch-row__label' }, 'Bisukan notifikasi'),
        el('p', { class: 'switch-row__hint' }, 'Berlaku selama sesi ini'),
      ),
      switchControl(mutedChats.has(chat.id), (on) => {
        if (on) mutedChats.add(chat.id);
        else mutedChats.delete(chat.id);
        showToast(on ? 'Notifikasi dibisukan.' : 'Notifikasi diaktifkan.', 'info');
      }),
    ));

    if (chat.type === 'room') {
      const rule = (text, ok = true) => el('div', { class: 'feature' },
        el('span', { class: 'feature__mark', style: ok ? {} : { background: 'var(--color-accent-2)' } }, ok ? '✔' : '✕'),
        el('span', { class: 'text-sm' }, text),
      );

      const convState = chat.conversion?.state || 'none';
      const proposedByMe = chat.conversion?.proposedBy === myUid;
      let actionBtn = null;

      if (convState === 'proposed' && proposedByMe) {
        actionBtn = el('button', { class: 'btn btn--block', type: 'button' },
          icon('clock'), 'Menunggu persetujuan anggota lain');
        actionBtn.disabled = true;
        const cancelBtn = el('button', { class: 'btn btn--ghost btn--block', type: 'button', style: { marginTop: '8px' } },
          icon('x'), 'Batalkan usulan');
        cancelBtn.addEventListener('click', async () => {
          cancelBtn.disabled = true;
          try {
            await cancelConversion(chat.id);
            if (cancelled) return;
            chat = await getChat(chat.id, { state: 'ok' });
            renderHeader();
            showToast('Usulan konversi dibatalkan.', 'info');
            if (drawerRef) fillDrawer(drawerRef.body);
          } catch (error) {
            cancelBtn.disabled = false;
            showToast(error instanceof ServiceError ? error.message : 'Gagal membatalkan.', 'error');
          }
        });
        body.append(el('div', { class: 'section-title' }, 'Konversi ke Chat Privat'),
          el('div', { class: 'card card--flat stack' },
            el('p', { class: 'text-sm' }, 'Kamu sudah mengajukan konversi. Menunggu persetujuan anggota lain.'),
            actionBtn, cancelBtn,
          ));
      } else if (convState === 'proposed') {
        actionBtn = el('button', { class: 'btn btn--primary btn--block', type: 'button' },
          icon('shield'), 'Setujui konversi ke Chat Privat');
        actionBtn.addEventListener('click', async () => {
          actionBtn.disabled = true;
          clear(actionBtn);
          actionBtn.append(icon('loader', 'icon-spin'), 'Menyetujui...');
          try {
            await approveConversion(chat.id);
            if (cancelled) return;
            chat = await getChat(chat.id, { state: 'ok' });
            renderHeader();
            showToast('Percakapan resmi menjadi Chat Privat.', 'success');
            if (drawerRef) fillDrawer(drawerRef.body);
          } catch (error) {
            showToast(error instanceof ServiceError ? error.message : 'Konversi gagal.', 'error');
            clear(actionBtn);
            actionBtn.append(icon('shield'), 'Setujui konversi ke Chat Privat');
            actionBtn.disabled = false;
          }
        });
        body.append(el('div', { class: 'section-title' }, 'Konversi ke Chat Privat'),
          el('div', { class: 'card card--flat stack' },
            el('p', { class: 'text-sm' }, 'Anggota lain mengajukan konversi. Menyetujui akan mengubah room ini menjadi Chat Privat permanen.'),
            rule('Hanya room dengan tepat 2 anggota'),
            rule('Riwayat pesan lama tetap utuh dan tidak dipindah'),
            rule('Konversi bersifat permanen'),
            actionBtn,
          ));
      } else {
        const convertBtn = el('button', { class: 'btn btn--primary btn--block', type: 'button' },
          icon('shield'), 'Ajukan konversi ke Chat Privat');
        convertBtn.addEventListener('click', async () => {
          convertBtn.disabled = true;
          clear(convertBtn);
          convertBtn.append(icon('loader', 'icon-spin'), 'Mengajukan...');
          try {
            await proposeConversion(chat.id);
            if (cancelled) return;
            chat = await getChat(chat.id, { state: 'ok' });
            renderHeader();
            if (chat.type === 'private') {
              showToast('Percakapan resmi menjadi Chat Privat.', 'success');
            } else {
              showToast('Usulan konversi dikirim. Menunggu persetujuan anggota lain.', 'success');
            }
            if (drawerRef) fillDrawer(drawerRef.body);
          } catch (error) {
            showToast(error instanceof ServiceError ? error.message : 'Konversi gagal.', 'error');
            clear(convertBtn);
            convertBtn.append(icon('shield'), 'Ajukan konversi ke Chat Privat');
            convertBtn.disabled = false;
          }
        });
        body.append(el('div', { class: 'section-title' }, 'Konversi ke Chat Privat'),
          el('div', { class: 'card card--flat stack' },
            rule('Hanya room dengan tepat 2 anggota'),
            rule('Kedua anggota harus menyetujui'),
            rule('Riwayat pesan lama tetap utuh dan tidak dipindah'),
            rule('Konversi bersifat permanen'),
            convertBtn,
          ));
      }
    }
  }

  function fillGroup(body) {
    const admin = isGroupAdmin(chat.id);

    body.append(el('div', { class: 'info-grid' },
      infoRow('Role kamu', myRole(chat.id) === 'admin' ? 'Admin' : 'Anggota'),
      infoRow('Jumlah anggota', `${chat.memberIds.length} orang`),
      infoRow('Dibuat oleh', personById(chat.createdBy)?.displayName || 'Tidak diketahui'),
    ));

    body.append(el('div', { class: 'section-title' }, 'Anggota'));

    const membersHolder = el('div', { class: 'stack' }, skeletonList(3));
    body.append(membersHolder);

    listMembers(chat.id, { state: 'ok' }).then((members) => {
      if (cancelled || !drawerRef) return;
      clear(membersHolder);
      for (const member of members) {
        const isMeUser = member.isMe;
        const row = el('div', { class: 'row', style: { padding: '6px 0' } },
          avatar({ name: member.displayName, id: member.id, size: 'sm', online: member.online }),
          el('div', { class: 'grow', style: { minWidth: '0' } },
            el('p', { class: 'text-sm', style: { fontWeight: 'var(--weight-semibold)' } },
              member.displayName, isMeUser ? el('span', { class: 'text-muted' }, ' (Kamu)') : null),
            el('p', { class: 'text-xs text-muted' }, member.role === 'admin' ? 'Admin' : 'Anggota'),
          ),
          member.role === 'admin' ? el('span', { class: 'badge badge--primary' }, icon('crown'), 'Admin') : null,
          admin && !isMeUser
            ? el('div', { class: 'row', style: { gap: '4px' } },
                el('button', {
                  class: 'btn btn--sm', type: 'button', title: member.role === 'admin' ? 'Jadikan anggota biasa' : 'Jadikan admin',
                  onClick: () => runMemberAction(
                    () => setMemberRole(chat.id, member.id, member.role === 'admin' ? 'member' : 'admin'),
                    'Role anggota diperbarui.',
                  ),
                }, icon(member.role === 'admin' ? 'user' : 'crown')),
                el('button', {
                  class: 'btn btn--ghost btn--sm', type: 'button', title: 'Keluarkan dari grup',
                  onClick: async () => {
                    const ok = await confirmModal({
                      title: 'Keluarkan anggota?',
                      message: `${member.displayName} akan dikeluarkan dari grup. Anggota yang dikeluarkan tidak dapat membaca pesan baru.`,
                      confirmLabel: 'Keluarkan', danger: true,
                    });
                    if (ok) runMemberAction(() => removeGroupMember(chat.id, member.id), 'Anggota dikeluarkan.');
                  },
                }, icon('user-minus')),
              )
            : null,
        );
        membersHolder.append(row);
      }
    }).catch((error) => {
      if (cancelled || !drawerRef) return;
      clear(membersHolder);
      membersHolder.append(el('p', { class: 'text-sm text-danger' },
        error instanceof ServiceError ? error.message : 'Gagal memuat anggota.'));
    });

    if (admin) {
      body.append(
        el('button', {
          class: 'menu-item', type: 'button', style: { marginTop: '8px' },
          onClick: openAddMember,
        }, icon('user-plus'), 'Tambah anggota'),
        el('button', {
          class: 'menu-item', type: 'button', style: { marginTop: '8px' },
          onClick: openRenameGroup,
        }, icon('edit'), 'Ubah nama grup'),
      );
    }

    body.append(el('div', { class: 'section-title' }, 'Zona berbahaya'),
      el('button', {
        class: 'menu-item menu-item--danger', type: 'button',
        onClick: async () => {
          const ok = await confirmModal({
            title: 'Keluar dari grup?',
            message: admin
              ? 'Kamu admin. Hak admin akan dipindahkan ke anggota lain sebelum kamu keluar.'
              : 'Kamu tidak akan bisa membaca pesan grup setelah keluar.',
            confirmLabel: 'Keluar',
            danger: true,
          });
          if (!ok) return;
          try {
            await leaveGroup(chat.id);
            if (cancelled) return;
            showToast('Kamu keluar dari grup.', 'success');
            closeInfo();
            location.hash = '#/app/chats';
          } catch (error) {
            showToast(error instanceof ServiceError ? error.message : 'Gagal keluar dari grup.', 'error');
          }
        },
      }, icon('log-out'), 'Keluar dari grup'));
  }

  async function runMemberAction(action, successMessage) {
    try {
      await action();
      if (cancelled) return;
      showToast(successMessage, 'success');
      chat = await getChat(chat.id, { state: 'ok' });
      renderHeader();
      if (drawerRef) fillDrawer(drawerRef.body);
    } catch (error) {
      showToast(error instanceof ServiceError ? error.message : 'Operasi gagal.', 'error');
    }
  }

  function openAddMember() {
    let modalRef;
    const holder = el('div', { class: 'stack' }, skeletonList(3));
    modalRef = openModal({
      title: 'Tambah anggota',
      body: [holder, el('p', { class: 'text-xs text-muted' }, 'Hanya teman yang bisa ditambahkan ke grup.')],
      footer: [el('button', { class: 'btn', type: 'button', onClick: closeModal }, 'Tutup')],
    });

    listFriends().then((friends) => {
      clear(holder);
      const available = friends.filter((f) => !chat.memberIds.includes(f.id));
      if (!available.length) {
        holder.append(el('p', { class: 'text-sm text-muted' }, 'Semua teman sudah menjadi anggota grup.'));
        return;
      }
      for (const friend of available) {
        holder.append(el('button', {
          class: 'menu-item', type: 'button',
          onClick: async () => {
            try {
              await addGroupMember(chat.id, friend.id);
              if (cancelled) return;
              modalRef.close();
              showToast(`${friend.displayName} ditambahkan.`, 'success');
              chat = await getChat(chat.id, { state: 'ok' });
              renderHeader();
              if (drawerRef) fillDrawer(drawerRef.body);
            } catch (error) {
              showToast(error instanceof ServiceError ? error.message : 'Gagal menambah anggota.', 'error');
            }
          },
        },
          avatar({ name: friend.displayName, id: friend.id, size: 'sm', online: friend.online || isOnline(friend.id) }),
          el('span', { class: 'grow text-left' }, friend.displayName),
          icon('plus'),
        ));
      }
    }).catch(() => {
      clear(holder);
      holder.append(el('p', { class: 'text-sm text-danger' }, 'Gagal memuat daftar teman.'));
    });
  }

  function openRenameGroup() {
    const input = el('input', { class: 'input', type: 'text', value: chat.title, maxlength: '60' });
    const errorBox = el('p', { class: 'field__error hidden' });
    let modalRef;
    modalRef = openModal({
      title: 'Ubah nama grup',
      body: [
        el('div', { class: 'field' },
          el('label', { class: 'field__label' }, 'Nama grup'),
          input, errorBox,
        ),
      ],
      footer: [
        el('button', { class: 'btn', type: 'button', onClick: closeModal }, 'Batal'),
        el('button', {
          class: 'btn btn--primary', type: 'button',
          onClick: async () => {
            try {
              const { renameGroup } = await import('../services/chats-service.js');
              await renameGroup(chat.id, input.value);
              if (cancelled) return;
              modalRef.close();
              showToast('Nama grup diperbarui.', 'success');
              chat = await getChat(chat.id, { state: 'ok' });
              renderHeader();
              if (drawerRef) fillDrawer(drawerRef.body);
            } catch (error) {
              clear(errorBox);
              errorBox.classList.remove('hidden');
              errorBox.append(icon('alert-circle'), el('span', {},
                error instanceof ServiceError ? error.message : 'Gagal mengubah nama.'));
            }
          },
        }, 'Simpan'),
      ],
    });
  }

  function switchControl(checked, onChange) {
    const control = el('button', {
      class: 'switch', type: 'button', role: 'switch',
      'aria-checked': String(checked),
      onClick: () => {
        const next = control.getAttribute('aria-checked') !== 'true';
        control.setAttribute('aria-checked', String(next));
        onChange(next);
      },
    });
    return control;
  }

  /* ---------------- Mulai ---------------- */
  loadChat(previewState);
  loadList();

  return {
    node: renderShell({ active: 'chats', fullscreen: true }, root),
    cleanup: () => {
      cancelled = true;
      if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
      if (feedTimer) clearTimeout(feedTimer);
      unsubscribeFeed();
      unsubscribePresence();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', renderConnection);
      closeInfo();
    },
  };
}
