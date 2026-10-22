# 01 - Design System (Neobrutalism)

**Status: Implemented - Tested (otomatis via happy-dom) - Visual manual: belum**

## 1. Prinsip Neobrutalism yang Dipakai

1. **Border hitam tegas** - semua elemen interaktif/penting punya `2px-3px solid var(--color-border)`.
2. **Shadow keras tanpa blur** - `box-shadow: 4px 4px 0 var(--color-border)`; tidak ada blur/gradien halus.
3. **Sudut membulat sedang** - radius 8-14px (bukan pill penuh, bukan kotak tajam).
4. **Warna aksen berani** - kuning (utama), lime (positif), biru (informasi), coral (bahaya) di atas latar cream.
5. **Pressed state** - tombol bergeser `translate(4px, 4px)` dan shadow menghilang saat ditekan.
6. **Hierarki tipografi tegas** - judul `800`, uppercase untuk display, monospace untuk kode akun.
7. **Ikon stroke konsisten** - SVG 24x24, `stroke-width: 2.4`, satu sumber (`src/components/icon.js`).
8. **Animasi singkat & fungsional** - 120-200ms, hanya untuk masuk/keluar elemen; menghormati `prefers-reduced-motion`.
9. **Keterbacaan di atas kejutan warna** - kontras teks utama gelap di atas permukaan terang; warna aksen tidak dipakai untuk teks kecil di atas latar sejenis.

## 2. Design Tokens

Semua token di `src/styles/tokens.css`. **Ubah hanya di file itu.**

### Warna

| Token | Nilai | Peran |
|---|---|---|
| `--color-background` | `#f7f3e8` | Latar aplikasi (cream) |
| `--color-surface` | `#ffffff` | Kartu, panel, bubble lawan |
| `--color-surface-alt` | `#efe9da` | Sidebar, area sekunder |
| `--color-primary` | `#ffd93d` | Aksen utama, bubble milik sendiri, tab aktif |
| `--color-secondary` | `#9be15d` | Aksen positif (terima, switch aktif) |
| `--color-accent` | `#4d96ff` | Aksen informasi, focus outline |
| `--color-accent-2` | `#ff6b6b` | Aksen bahaya/kesalahan |
| `--color-text` | `#161616` | Teks utama |
| `--color-text-muted` | `#5f5a52` | Teks sekunder |
| `--color-border` | `#161616` | Semua border & shadow |
| `--color-status-pending/sent/read` | abu / biru / hijau | Status pesan |
| `--avatar-1..5` | kuning, lime, biru, coral, ungu | Warna avatar (deterministik dari id) |

### Elevation & bentuk

| Token | Nilai |
|---|---|
| `--border-width` / `--border-width-lg` | `2px` / `3px` |
| `--shadow-hard` | `4px 4px 0 var(--color-border)` |
| `--shadow-hard-sm` | `2px 2px 0 ...` |
| `--shadow-hard-lg` | `7px 7px 0 ...` |
| `--radius-card` / `--radius-btn` / `--radius-bubble` | `12px` / `10px` / `14px` |
| `--radius-pill` | `999px` (badge, switch) |

### Spacing (basis 8px)

`--space-1..7` = 4, 8, 12, 16, 24, 32, 48 px. Gunakan token, bukan angka acak.

### Tipografi

- Font: `--font-sans` = system stack (tanpa Google Fonts agar jalan offline di WebView).
- Skala: `--size-xs..3xl` = 0.75, 0.875, 1, 1.125, 1.5, 2, 2.75 rem.
- Bobot: `--weight-regular(500)`, `--weight-semibold(700)`, `--weight-bold(800)`.
- Kode akun & recovery key: `--font-mono`, letter-spacing lebar, latar `--color-primary`.

### Layout

| Token | Nilai | Peran |
|---|---|---|
| `--nav-width` | 248px | Sidebar desktop |
| `--list-width` | 340px | Kolom daftar chat |
| `--detail-width` | 320px | Drawer info room |
| `--topbar-height` | 64px | Tinggi header |
| `--tabbar-height` | 64px | Bottom nav mobile |
| `--hit-min` | 44px | Target sentuh minimum |
| `--app-height` | `100dvh` (di-update JS) | Tinggi aktif, tahan keyboard |

### Tema

- `data-theme="dark"` di `<html>` mengoverride token (dipilih di Profil -> Tema).
- `Auto` memakai `prefers-color-scheme` (lihat blok media query di `tokens.css`).

## 3. Komponen UI

File: `src/styles/components.css`. Implementasi JS: `src/components/`.

| Komponen | Kelas CSS | Implementasi |
|---|---|---|
| Tombol | `.btn`, `--primary/--secondary/--accent/--danger/--ghost`, `--icon`, `--sm`, `--lg`, `--block` | `el('button', {class:'btn btn--primary'})` |
| Kartu/panel | `.card`, `.panel`, `.panel__header/__title/__body` | - |
| Form | `.field`, `.field__label/__hint/__error`, `.input`, `.textarea`, `.input-group`, `.label-code` | - |
| Badge/pill | `.badge`, `--primary/--secondary/--accent/--danger`, `.badge-count`, `.pill` | - |
| Avatar | `.avatar`, `--sm/--lg/--round`, `.avatar__status` | `components/avatar.js` |
| Navigasi | `.app-shell`, `.app-nav`, `.nav-item`, `.tabbar`, `.tabbar__item` | `pages/_shell.js` |
| Daftar | `.list`, `.list-item`, `__main/__title/__preview/__side/__time` | `components/chat-list.js` |
| Tab | `.tabs`, `.tab`, `.is-active` | halaman friends |
| Bubble chat | `.messages`, `.day-divider`, `.msg-row`, `--mine`, `.bubble`, `__reply/__meta`, `.msg-status` | `components/message-bubble.js` |
| Composer | `.composer`, `.composer__input`, `.composer__reply` | `pages/chat.js` |
| Drawer info | `.drawer`, `.drawer-backdrop`, `.drawer__header/__body` | `pages/chat.js` |
| Modal | `.modal-backdrop`, `.modal`, `--wide`, `.modal__header/__title/__body/__footer` | `components/modal.js` |
| Toast | `.toast-host`, `.toast`, `--success/--error/--info` | `components/toast.js` (pengganti `alert()`) |
| State | `.state-view`, `__icon/__title/__desc`, `.skeleton*` | `components/state-view.js` |
| Switch | `.switch-row`, `.switch` (role="switch") | halaman chat/profile |
| Segmented | `.segmented`, `.segmented__btn` | pemilih tema |
| Ikon | `.icon`, `--lg/--xl` | `components/icon.js` |
| Notice | `.notice`, `--warn/--danger` | - |
| QR | `.qr-frame`, `.qr-placeholder` | `components/qr-preview.js` |

Aturan penggunaan:

- Selalu pakai `showToast()` untuk feedback; `alert/confirm/prompt` dilarang (terverifikasi via grep).
- Setiap tombol harus punya `type` dan handler yang benar-benar melakukan sesuatu (atau `disabled` + keterangan bila fitur menyusul).
- Ikon wajib lewat `icon('nama')`, jangan SVG tempelan.

## 4. Responsivitas

Breakpoint (`src/styles/responsive.css`):

| Breakpoint | Perilaku |
|---|---|
| `< 900px` (mobile) | Sidebar disembunyikan, bottom nav tampil, daftar & chat jadi halaman terpisah, tombol kembali tampil, drawer jadi sheet penuh, pencarian pindah baris penuh |
| `< 400px` | Padding dipadatkan, tombol & kode mengecil, tab bisa di-scroll |
| `>= 900px` (desktop) | Sidebar + daftar + panel chat (grid 340px + 1fr) |
| `>= 1200px` | Padding lebih lega |
| `pointer: coarse` | Target sentuh 48px |
| landscape pendek | Halaman auth mulai dari atas (tidak terpotong) |

Detail mobile:

- `env(safe-area-inset-*)` dipakai pada bottom nav, composer, toast, dan halaman auth.
- `--app-height` diupdate dari `visualViewport` (`src/utils/viewport.js`) supaya input chat tidak tertutup keyboard.
- Bottom nav disembunyikan di halaman chat (`is-fullscreen`) agar ruang pesan maksimal.

## 5. State UI (wajib di setiap halaman)

| State | Komponen | Cara memicu |
|---|---|---|
| Loading | `skeletonList/skeletonMessages` | Saat fetch berjalan; `?state=loading` untuk menahan selamanya |
| Error | `errorState({title,message,onRetry})` | `?state=error` |
| Kosong | `emptyState({iconName,title,desc,action})` | `?state=empty` atau data memang kosong |
| Sukses | data dirender | default |

Halaman yang mendukung preview: `#/app/chats`, `#/app/friends`, `#/app/profile`, `#/app/chat/:id`.

## 6. Panduan Menambah Halaman Baru

1. Buat `src/pages/nama-halaman.js` yang mengekspor fungsi menerima `({ params, query })` dan mengembalikan `Node` atau `{ node, cleanup }`.
2. Render isi halaman secara sinkron (langsung tampilkan skeleton), lalu isi data lewat service `async` - jangan menunggu fetch sebelum merender.
3. Daftarkan di `src/main.js`: `route('/path', namaHalaman)`.
4. Bungkus dengan `renderShell({ active }, node)` bila termasuk area login (`#/app/*`).
5. Untuk state loading/error/empty, pakai komponen dari `components/state-view.js` dan dukung `query.state`.
6. Tangani `cancelled` di closure bila ada async agar tidak menulis DOM setelah navigasi.
7. Tambahkan test di `tests/dom-smoke.test.js` (render + interaksi inti).

## 7. Menambah Warna/Komponen Baru

1. Tambahkan token baru di `tokens.css` (jangan hardcode warna di komponen).
2. Tambahkan kelas di `components.css` dengan border + shadow yang konsisten.
3. Pastikan mode gelap tetap kontras (uji dengan `data-theme="dark"`).
4. Jangan membuat varian tombol baru bila varian yang ada cukup.
