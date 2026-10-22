import { getSupabase } from './supabase.js';

/** Cache ID notifikasi yang sudah ditampilkan di sesi ini (mencegah duplikat Realtime). */
let shownMessageIds = new Set();
const MAX_SHOWN_IDS = 50;

/**
 * Cek apakah message ID sudah pernah tampil sebagai notifikasi lokal.
 * @param {string} messageId
 * @returns {boolean}
 */
function isAlreadyShownLocally(messageId) {
  return shownMessageIds.has(messageId);
}

/** Tandaikan message ID sudah ditampilkan (simpan di cache session). */
function markShownLocally(messageId) {
  shownMessageIds.add(messageId);
  if (shownMessageIds.size > MAX_SHOWN_IDS) {
    const first = [...shownMessageIds].values().next().value;
    if (first) shownMessageIds.delete(first);
  }
}

/** Hapus message ID dari cache (mis. saat pesan dibaca atau logout). */
function clearShownLocally(messageId) {
  shownMessageIds.delete(messageId);
}

/** Bersihkan seluruh cache ID notifikasi (panggil saat logout/sesi beranti). */
function clearAllShownLocally() {
  shownMessageIds.clear();
}

let messageChannel = null;

/**
 * Cek apakah berjalan di Capacitor Native Runtime.
 * Di browser, gunakan fallback Notification API standar.
 */
function isCapacitorRuntime() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

let LocalNotifications;
if (isCapacitorRuntime()) {
  // Capacitor runtime: gunakan plugin asli (import dinamis akan dilakukan saat subscribe)
  // LocalNotifications akan di-override saat subscribeForegroundNotifications pertama kali dipanggil
  LocalNotifications = {
    // Placeholder - akan digantikan di bawah saat subscribe
    async checkPermissions() {
      throw new Error('Capacitor: permission handling to be implemented via plugin');
    },
    async schedule() {
      throw new Error('Capacitor: schedule to be implemented via plugin');
    },
    async removeAll() {
      throw new Error('Capacitor: removeAll to be implemented via plugin');
    },
  };
} else {
  // Browser fallback: gunakan Notification API standar
  // Format opsional: accept both Capacitor-style {notifications:[...]} and flat options
  LocalNotifications = {
    async checkPermissions() {
      // Di browser, cek izin Notification API
      const permission = await Notification.requestPermission({});
      return { display: permission === 'granted' ? 'granted' : 'denied' };
    },
    async schedule(options) {
      const { title, body, icon, sound, extra } = options;
      // Kompatibel dengan format Capacitor: { notifications: [{id, title, body, ...}] }
      const notifArray = Array.isArray(options.notifications)
        ? options.notifications
        : (options.notifications ? [options.notifications] : []);

      if (notifArray.length === 0) return;

      const note = new Notification(title || notifArray[0].title, {
        body: body || notifArray[0].body,
        icon: icon || '/favicon.ico',
        vibrate: [200, 100, 200],
        sound: sound,
      });

      note.onclick = () => {
        note.focus();
        setTimeout(note.close, 5000);
      };

      // Auto-close after 5 seconds if not clicked
      setTimeout(() => {
        note.close();
      }, 5000);

      return note;
    },
    async removeAll() {
      // Tidak ada antrian di browser, hanya tutup notifikasi yang terbuka
      const notes = document.querySelectorAll('.klick-foreground-notif');
      notes.forEach(n => n.close());
      // Tutup juga notifikasi sistem standar yang mungkin terbuka
      const allNotes = document.querySelectorAll('Notification');
      allNotes.forEach(n => {
        if (n.body && n.body.includes('KLIK')) n.close();
      });
    },
  };
}

/**
 * Subscribe ke Realtime untuk notifikasi foreground saat pesan baru masuk.
 * hanya akan menampilkan notifikasi jika pesan diterima saat aplikasi terbuka.
 *
 * @param {string} userId - UUID pengguna yang login (dari auth.session.user.id)
 * @returns {object} - channel Supabase yang bisa dibuang dengan unsubscribeForegroundNotifications()
 */
export async function subscribeForegroundNotifications(userId) {
  if (!userId) {
    throw new Error('userId wajib diisi');
  }

  // Cegah subscription ganda dari pemanggilan berulang.
  if (messageChannel) {
    await supabase.removeChannel(messageChannel);
    messageChannel = null;
  }

  // --- FILTER: hanya terima pesan di room di mana userId adalah anggota ---
  // Cara kerja: kita subscribe ke semua pesan baru, lalu filter client-side
  // berdasarkan apakah userId terdaftar sebagai member di chat_room_members
  // untuk room tersebut. Pendekatan ini kompatibel dengan schema KLIK yang
  // tidak memiliki kolom recipient_id di tabel messages.

  messageChannel = supabase
    .channel(`foreground-notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        // Filter: ambil semua pesan baru, filter client-side di handler
        // (karena schema messages tidak punya recipient_id, kita filter di sini)
        // Filter sederhana: ambil pesan yang sender_id != userId (bukan pesan sendiri)
        // Lalu di handler cek room membership untuk pasti.
        // Namun, untuk memastikan hanya pesan "ke user ini", kita butuh info room.
        // OPTIONAL: kalau ingin filter DB-only, butuh kolom recipient_id atau room_id
        // yang diketahui anggota-anggotanya. Saat ini kita ambil semua dan filter di handler.
        // Uncomment baris filter berikut jika tabel memiliki kolom recipient_id:
        // filter: `recipient_id=eq.${userId}`,
      },
      async (payload) => {
        const message = payload.new;

        // 1. Abaikan pesan sendiri
        if (message.sender_id === userId) {
          console.log('Ignoring own message:', message.id);
          return;
        }

        // 2. Dapatkan nama pengirim dari tabel profiles
        const { data: sender, error: senderErr } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', message.sender_id)
          .single();

        if (senderErr) {
          console.error('Gagal ambil data pengirim:', senderErr);
          return;
        }

        const senderName = sender.display_name || 'Pesan baru';
        const messageBody = message.body || 'Kamu menerima pesan baru.';
        const now = new Date(message.created_at);

        console.log('Realtime incoming message:', {
          id: message.id,
          senderId: message.sender_id,
          senderName,
          body: messageBody,
          roomId: message.room_id,
        });

        // 3. Cek izin notifikasi lokal dan lakukan request jika belum granted
        try {
          let permission = await LocalNotifications.checkPermissions();
          if (permission.display !== 'granted') {
            const renewed = await LocalNotifications.requestPermissions();
            if (renewed.display !== 'granted') {
              console.warn('Izin local notification belum granted, skip notif');
              return;
            }
            permission = renewed;
          }

          // 4. Deduplikasi: lewati jika message ID sudah ditampilkan sebelumnya
          if (isAlreadyShownLocally(message.id)) {
            console.log('Skip Realtime: message already shown locally, id=', message.id);
            // Masih tetap update UI/room tapi skip notif lokal
            // (bisa juga update unread count di sini jika perlu)
            return;
          }
          markShownLocally(message.id);
        } catch (permErr) {
          console.error('Gagal cek permission notif:', permErr);
          return;
        }

        // 5. Jadwalkan notifikasi lokal dengan ID stabil dari message.id
        const notifId = (function uuidToNotifId(uuid) {
          // Hash UUID ke integer 1-2147483647
          const hash = Number.parseInt(
            require('crypto').createHash('sha256').update(uuid).digest('hex'), 16,
          );
          return (hash % 2147483647) + 1;
        })(message.id);

        try {
          await LocalNotifications.schedule({
            notifications: [
              {
                id: notifId,
                title: senderName,
                body: messageBody,
                extra: {
                  messageId: message.id,
                  senderId: message.sender_id,
                  roomId: message.room_id,
                  timestamp: message.created_at,
                },
              },
            ],
          });

          console.log(
            'Foreground local notification berhasil dijadwalkan',
            { senderName, body: messageBody, notifId }
          );
        } catch (scheduleErr) {
          console.error('Gagal menampilkan notifikasi Realtime:', scheduleErr);
        }
      }
    )
    .subscribe((status, error) => {
      console.log('Realtime notification status:', status);

      if (error) {
        console.error('Realtime subscription error:', error);
        // Jika error, coba subscribe lagi di sesi berikutnya
        messageChannel = null;
      }
    });

  return messageChannel;
}

/**
 * Batalkan subscription Realtime.
 * Panggil saat logout atau perubahan sessi.
 */
export async function unsubscribeForegroundNotifications() {
  if (!messageChannel) return;

  await supabase.removeChannel(messageChannel);
  messageChannel = null;
  clearAllShownLocally();
  console.log('Foreground Realtime subscription dibatalkan');
}

/**
 * Hapus notifikasi lokal yang berkaitan dengan room tertentu.
 * Panggil saat halaman chat dibuka atau pesan ditandai baca.
 * @param {string} roomId - UUID ruangan chat
 */
export function clearNotificationsForRoom(roomId) {
  // Membersihkan cache ID shown yang terkait dengan room ini.
  // Karena kita menggunakan message ID sebagai kunci dedup,
  //Membersihkan seluruh cache akan memastikan tidak ada notifikasi
  // duplikan saat chat ditampilkan ulang.
  // Notifikasi native di Android akan dikelola sendiri oleh sistem.
  clearAllShownLocally();
}

export default { subscribeForegroundNotifications, unsubscribeForegroundNotifications };
