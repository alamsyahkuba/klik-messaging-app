/**
 * Data dummy untuk Milestone 1 (desain + UI).
 * Sumber data TEMPORARY: akan diganti oleh service Supabase pada Milestone 2+.
 * Semua waktu relatif terhadap saat module dimuat agar tampilan tetap masuk akal.
 */

const NOW = Date.now();
const menit = (n) => new Date(NOW - n * 60000);
const jam = (n) => new Date(NOW - n * 600000);
const hari = (n) => new Date(NOW - n * 86400000);

export const me = {
  id: 'u_me',
  displayName: 'Alya Putri',
  publicCode: 'KLIK-7Q2M-9X4D',
  recoveryKey: 'RCV-4TK9-ZP2M-7XDQ-LB6W',
  createdAt: hari(42),
  status: 'Halo, saya pakai KLIK 👋',
};

export const users = [
  { id: 'u_bima', displayName: 'Bima Saputra', publicCode: 'KLIK-3H8P-2M7Q', online: true, lastSeenAt: menit(1), friendSince: hari(38) },
  { id: 'u_dewi', displayName: 'Dewi Anggraini', publicCode: 'KLIK-9K4L-6R2T', online: false, lastSeenAt: jam(3), friendSince: hari(30) },
  { id: 'u_rizky', displayName: 'Rizky Pratama', publicCode: 'KLIK-5N1D-8W3C', online: true, lastSeenAt: menit(2), friendSince: hari(21) },
  { id: 'u_sari', displayName: 'Sari Melati', publicCode: 'KLIK-2F6V-4Y9B', online: false, lastSeenAt: hari(1), friendSince: hari(14) },
  { id: 'u_nadia', displayName: 'Nadia Yusuf', publicCode: 'KLIK-8T3J-7P5X', online: false, lastSeenAt: jam(8), friendSince: hari(7) },
  { id: 'u_dimas', displayName: 'Dimas Aryo', publicCode: 'KLIK-6B4W-5V9Z', online: true, lastSeenAt: menit(5) },
  { id: 'u_gilang', displayName: 'Gilang Ramadhan', publicCode: 'KLIK-6C9R-1H2M', online: false, lastSeenAt: jam(2), mutual: 3 },
  { id: 'u_putri', displayName: 'Putri Ayu', publicCode: 'KLIK-4M7B-9Q2W', online: true, lastSeenAt: menit(9), mutual: 1 },
  { id: 'u_fajar', displayName: 'Fajar Nugroho', publicCode: 'KLIK-1D5S-3K8L', online: false, lastSeenAt: hari(2) },
];

export const friendIds = ['u_bima', 'u_dewi', 'u_rizky', 'u_sari', 'u_nadia'];

export const incomingRequests = [
  { id: 'fr_in_1', from: 'u_gilang', at: hari(1) },
  { id: 'fr_in_2', from: 'u_putri', at: menit(45) },
];

export const outgoingRequests = [
  { id: 'fr_out_1', to: 'u_fajar', at: hari(2) },
];

/**
 * Percakapan. Tipe:
 * - private : dua orang, sudah dikonversi / memang private
 * - room    : ruang percakapan biasa (bisa dikonversi menjadi private bila tepat 2 anggota)
 * - group   : grup dengan anggota & admin
 */
export const chats = [
  { id: 'c_bima', type: 'private', memberIds: ['u_me', 'u_bima'], unread: 2, createdAt: hari(30) },
  { id: 'c_kantor', type: 'group', name: 'Tim Kantor', memberIds: ['u_me', 'u_bima', 'u_dewi', 'u_rizky', 'u_sari'], unread: 5, createdAt: hari(60), createdBy: 'u_me' },
  { id: 'c_dewi', type: 'private', memberIds: ['u_me', 'u_dewi'], unread: 0, createdAt: hari(21) },
  { id: 'c_rizky', type: 'private', memberIds: ['u_me', 'u_rizky'], unread: 1, createdAt: hari(12) },
  { id: 'c_trip', type: 'group', name: 'Rencana Trip', memberIds: ['u_me', 'u_rizky', 'u_sari', 'u_nadia'], unread: 0, createdAt: hari(9), createdBy: 'u_rizky' },
  { id: 'c_nadia', type: 'room', memberIds: ['u_me', 'u_nadia'], unread: 0, createdAt: hari(2), createdBy: 'u_me' },
];

/** Role admin grup (hanya untuk tipe 'group'). */
export const groupRoles = {
  c_kantor: { u_me: 'admin', u_bima: 'admin', u_dewi: 'member', u_rizky: 'member', u_sari: 'member' },
  c_trip: { u_rizky: 'admin', u_me: 'member', u_sari: 'member', u_nadia: 'member' },
};

let seq = 0;
function msg(senderId, text, at, status = null, replyTo = null) {
  seq += 1;
  return { id: `m_${seq}`, senderId, text, at, status, replyTo };
}

export const messagesByChat = {
  c_bima: [
    msg('u_bima', 'Eh, kamu udah lihat desain barunya belum?', hari(1) + 3600000 * 9),
    msg('u_me', 'Belum, tadi pagi masih sibuk rapat 😅', hari(1) + 3600000 * 9.2, 'read'),
    msg('u_bima', 'Nih aku kirim screenshot-nya', hari(1) + 3600000 * 9.3),
    msg('u_bima', 'Warna kuningnya cocok banget buat tombol utama', hari(1) + 3600000 * 9.31),
    msg('u_me', 'Wah iya, kelihatan tegas. Suka sama bordernya yang tebal', hari(1) + 3600000 * 9.5, 'read'),
    msg('u_bima', 'Haha iya, gaya neobrutalism emang segitu ciri khasnya', hari(1) + 3600000 * 9.6),
    msg('u_me', 'Besok kita bahas di kantor aja ya, jam 10?', hari(1) + 3600000 * 10, 'read'),
    msg('u_bima', 'Oke, dicatat 👍', hari(1) + 3600000 * 10.1),
    msg('u_bima', 'Oh iya, jangan lupa bawa laptop charger kamu yang tipis itu', jam(5)),
    msg('u_me', 'Siap, udah aku taruh di tas', jam(4.8), 'read'),
    msg('u_bima', 'Sip. Aku berangkat duluan ya besok, macet katanya', jam(2)),
    msg('u_bima', 'Sampai ketemu!', menit(12)),
    msg('u_me', 'Oke, nanti kabarin kalau udah sampai', menit(9), 'sent'),
    msg('u_bima', '👍', menit(8)),
  ].sort((a, b) => a.at - b.at),

  c_kantor: [
    msg('u_dewi', 'Selamat pagi semua, hari ini ada sprint review jam 3', hari(1) + 3600000 * 8),
    msg('u_rizky', 'Pagi! Aku sudah update progress di board', hari(1) + 3600000 * 8.2),
    msg('u_sari', 'Aku bisa ikut, tapi mungkin telat 5 menit', hari(1) + 3600000 * 8.4),
    msg('u_bima', 'Noted. Jangan lupa time sheet hari Jumat ya', hari(1) + 3600000 * 17),
    msg('u_me', 'Sudah aku isi kemarin malam', hari(1) + 3600000 * 17.5, 'read'),
    msg('u_dewi', 'Makasih! Tinggal 2 orang lagi', hari(1) + 3600000 * 17.6),
    msg('u_rizky', 'Sudah aku isi juga barusan', jam(6)),
    msg('u_bima', 'Sprint review dipindah ke ruang tengah ya', jam(3)),
    msg('u_dewi', 'Oke, aku update kalender', jam(3)),
    msg('u_sari', 'Siap 👌', jam(2.5)),
    msg('u_bima', 'Semua mohon join 5 menit sebelum mulai', menit(40)),
    msg('u_dewi', 'Slide final sudah di share di folder bersama', menit(25)),
  ].sort((a, b) => a.at - b.at),

  c_dewi: [
    msg('u_dewi', 'Terima kasih atas file laporannya ya', hari(2)),
    msg('u_me', 'Sama-sama, semoga membantu', hari(2) + 600000, 'read'),
    msg('u_dewi', 'Sangat membantu. Nanti aku kasih catatan tambahannya', hari(2) + 900000),
    msg('u_me', 'Siap, kabari saja lewat sini', hari(2) + 1200000, 'read'),
    msg('u_dewi', 'Oke!', hari(1)),
    msg('u_me', 'Halo Dewi, ada yang bisa kubantu?', jam(7), 'read'),
  ].sort((a, b) => a.at - b.at),

  c_rizky: [
    msg('u_rizky', 'Bro, file design system-nya udah di-commit?', jam(9)),
    msg('u_me', 'Udah, tinggal review aja', jam(8.7), 'read'),
    msg('u_rizky', 'Mantap, nanti aku baca malam ini', jam(8.5)),
    msg('u_rizky', 'Satu lagi, token warna dark mode udah lengkap?', menit(50)),
    msg('u_me', 'Lengkap, tinggal kamu cek kontrasnya', menit(45), 'sent'),
  ].sort((a, b) => a.at - b.at),

  c_trip: [
    msg('u_sari', 'Menurut kita berangkat tanggal berapa?', hari(3)),
    msg('u_rizky', 'Tanggal 20 enaknya, akhir pekan panjang', hari(3) + 600000),
    msg('u_nadia', 'Setuju! Aku sudah cek libur', hari(3) + 1200000),
    msg('u_me', 'Oke, aku booking penginapan dulu ya', hari(3) + 1800000, 'read'),
    msg('u_sari', 'Tolong yang dekat pantai 🙏', hari(2)),
    msg('u_rizky', 'Nanti aku bikin daftar barang bawaan', jam(11)),
  ].sort((a, b) => a.at - b.at),

  c_nadia: [
    msg('u_me', 'Halo Nadia! Ini aku dari kode akun ya', hari(2), 'read'),
    msg('u_nadia', 'Halo Alya, ketemu! Maaf baru balas', hari(2) + 1800000),
    msg('u_me', 'Gapapa. Kapan kita ngobrol soal acara kemarin?', hari(2) + 2400000, 'read'),
  ].sort((a, b) => a.at - b.at),
};

/** Nama file simulasi untuk placeholder lampiran (bukan file nyata). */
export const demoAttachments = [];
