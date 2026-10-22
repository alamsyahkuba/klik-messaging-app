import { el } from '../utils/dom.js';
import { icon } from '../components/icon.js';

/** Halaman A: Welcome / Onboarding. */
export function welcomePage() {
  const feature = (mark, text) => el('div', { class: 'feature' },
    el('span', { class: 'feature__mark' }, mark),
    el('span', {}, text),
  );

  return el('div', { class: 'auth-page' },
    el('section', { class: 'auth-card text-center' },
      el('img', { class: 'hero-logo', src: 'src/assets/logo.svg', alt: 'Logo KLIK', width: '96', height: '96' }),
      el('h1', { class: 'text-display' }, 'KLIK'),
      el('p', { class: 'text-sm text-muted', style: { marginTop: '8px' } },
        'Aplikasi chat tegas dan cepat. Temukan teman lewat QR atau kode akun.',
      ),

      el('div', { class: 'card card--flat text-left', style: { marginTop: 'var(--space-5)' } },
        el('div', { class: 'feature-list' },
          feature('✔', 'Tanpa email dan nomor telepon - cukup nama tampilan.'),
          feature('✔', 'Akun dikenali lewat kode akun unik dan QR code.'),
          feature('✔', 'Pesan real-time, chat privat, dan grup.'),
        ),
      ),

      el('div', { class: 'stack', style: { marginTop: '24px' } },
        el('a', { class: 'btn btn--primary btn--lg btn--block', href: '#/create-account' },
          icon('user-plus'),
          'Buat Akun Baru',
        ),
        el('a', { class: 'btn btn--block', href: '#/login' },
          icon('log-in'),
          'Masuk ke Akun',
        ),
      ),

      el('p', { class: 'text-xs text-muted', style: { marginTop: '16px' } },
        'Kamu tidak perlu email atau nomor telepon. Simpan passphrase dan recovery key yang diberikan saat mendaftar - keduanya dibutuhkan untuk masuk dan memulihkan akun.',
      ),
    ),
  );
}
