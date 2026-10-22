import { el, clear } from '../utils/dom.js';
import { icon } from '../components/icon.js';
import { avatar } from '../components/avatar.js';
import { showToast } from '../components/toast.js';
import { ServiceError } from '../services/_fake.js';
import { qrFrame } from '../components/qr-preview.js';
import { registerAccount } from '../services/auth-service.js';

/**
 * Halaman B: Create Account.
 * Langkah 1: nama tampilan + passphrase -> langkah 2: identitas + kode akun + QR + recovery key.
 * Milestone 3: pembuatan akun nyata lewat Edge Function auth-register.
 */
export function createAccountPage() {
  const card = el('section', { class: 'auth-card' });
  renderForm(card);
  return el('div', { class: 'auth-page' }, card);
}

function renderForm(card) {
  clear(card);
  const errorBox = el('p', { class: 'field__error hidden', role: 'alert' }, icon('alert-circle'), el('span', {}));

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'display-name',
    name: 'displayname',
    autocomplete: 'nickname',
    maxlength: '30',
    placeholder: 'Contoh: Alya Putri',
    required: true,
  });

  const passInput = el('input', {
    class: 'input',
    type: 'password',
    id: 'passphrase',
    name: 'passphrase',
    autocomplete: 'new-password',
    placeholder: 'Minimal 8 karakter',
    required: true,
  });

  const passConfirmInput = el('input', {
    class: 'input',
    type: 'password',
    id: 'passphrase-confirm',
    name: 'passphrase-confirm',
    autocomplete: 'new-password',
    placeholder: 'Ulangi passphrase',
    required: true,
  });

  const submitBtn = el('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' },
    icon('arrow-right'),
    'Buat Akun',
  );

  const form = el('form', { class: 'stack-lg', novalidate: true, onSubmit: handleSubmit },
    el('div', { class: 'text-center' },
      el('img', { class: 'hero-logo', src: 'src/assets/logo.svg', alt: '', width: '96', height: '96' }),
      el('h1', { class: 'text-display' }, 'Buat Akun'),
      el('p', { class: 'text-sm text-muted', style: { marginTop: '8px' } },
        'Cukup nama tampilan dan passphrase. Tanpa email, tanpa nomor telepon.',
      ),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'display-name' }, 'Nama tampilan'),
      nameInput,
      el('span', { class: 'field__hint' }, 'Nama ini bisa dilihat teman dan bisa diubah kapan saja. Bukan identitas unik.'),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'passphrase' }, 'Passphrase'),
      passInput,
      el('span', { class: 'field__hint' }, 'Satu-satunya rahasia untuk masuk. Minimal 8 karakter. Tidak bisa dipulihkan oleh siapa pun.'),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'passphrase-confirm' }, 'Ulangi passphrase'),
      passConfirmInput,
      errorBox,
    ),
    submitBtn,
    el('a', { class: 'btn btn--ghost btn--block', href: '#/login' }, 'Sudah punya akun? Masuk'),
    el('div', { class: 'notice' },
      icon('shield'),
      el('span', {},
        'Saat membuat akun, sistem membuat identitas internal acak, kode akun publik, serta recovery key. Catat recovery key - in satu-satunya jalan memulihkan akun tanpa email.',
      ),
    ),
  );

  card.append(form);

  async function handleSubmit(event) {
    event.preventDefault();
    errorBox.classList.add('hidden');
    for (const input of [nameInput, passInput, passConfirmInput]) input.removeAttribute('aria-invalid');

    const name = nameInput.value.trim();
    const passphrase = passInput.value;
    const confirm = passConfirmInput.value;

    if (name.length < 2) {
      showError('Nama tampilan minimal 2 karakter.');
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }
    if (passphrase.length < 8) {
      showError('Passphrase minimal 8 karakter.');
      passInput.setAttribute('aria-invalid', 'true');
      passInput.focus();
      return;
    }
    if (passphrase !== confirm) {
      showError('Passphrase dan ulangannya tidak sama.');
      passConfirmInput.setAttribute('aria-invalid', 'true');
      passConfirmInput.focus();
      return;
    }

    submitBtn.disabled = true;
    clear(submitBtn);
    submitBtn.append(icon('loader', 'icon-spin'), 'Membuat akun...');

    try {
      const result = await registerAccount({ displayName: name, passphrase });
      passInput.value = '';
      passConfirmInput.value = '';
      renderResult(card, {
        internalId: result.profile.id,
        displayName: result.profile.displayName,
        publicCode: result.profile.publicCode,
        recoveryKey: result.recoveryKey,
      });
    } catch (error) {
      showError(error instanceof ServiceError ? error.message : 'Gagal membuat akun. Coba lagi.');
      submitBtn.disabled = false;
      clear(submitBtn);
      submitBtn.append(icon('arrow-right'), 'Buat Akun');
    }
  }

  function showError(message) {
    clear(errorBox);
    errorBox.append(icon('alert-circle'), el('span', {}, message));
    errorBox.classList.remove('hidden');
  }
}

function renderResult(card, identity) {
  clear(card);

  const codeLabel = el('p', { class: 'label-code', id: 'public-code' }, identity.publicCode);
  const recoveryLabel = el('p', { class: 'label-code label-code--sm', id: 'recovery-key' }, identity.recoveryKey);

  card.classList.add('auth-card--wide');
  card.append(
    el('div', { class: 'text-center' },
      el('h1', { class: 'text-display' }, 'Akun Dibuat'),
      el('p', { class: 'text-sm text-muted', style: { marginTop: 'var(--space-2)' } }, 'Simpan dua hal di bawah ini sekarang juga.'),
    ),

    el('div', { class: 'row', style: { marginTop: '16px', justifyContent: 'center' } },
      avatar({ name: identity.displayName, id: identity.internalId, size: 'lg' }),
      el('div', { class: 'text-left' },
        el('p', { class: 'text-sm text-muted' }, 'Nama tampilan'),
        el('p', { class: 'text-lg' }, identity.displayName),
        el('p', { class: 'text-xs text-muted text-mono' }, `ID internal: ${maskId(identity.internalId)}`),
      ),
    ),

    el('div', { class: 'section-title' }, 'Kode akun publik'),
    codeLabel,
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', {
        class: 'btn btn--block grow', type: 'button',
        onClick: () => copyText(identity.publicCode, 'Kode akun disalin.'),
      }, icon('copy'), 'Salin Kode'),
      el('button', {
        class: 'btn btn--block grow', type: 'button',
        onClick: () => shareCode(identity.publicCode),
      }, icon('share'), 'Bagikan'),
    ),
    el('p', { class: 'field__hint', style: { marginTop: '6px' } },
      'Kode ini hanya untuk dikenali orang lain dan menambah teman. Bukan password.',
    ),

    el('div', { class: 'section-title' }, 'QR code akun'),
    qrFrame(identity.publicCode, {
      real: true,
      caption: 'QR berisi kode akun publik. Pindai dengan KLIK atau kamera apa pun.',
    }),

    el('div', { class: 'section-title' }, 'Recovery key (RAHASIA)'),
    recoveryLabel,
    el('div', { class: 'notice notice--warn', style: { marginTop: '8px' } },
      icon('alert-triangle'),
      el('span', {},
        'Tulis recovery key ini di tempat aman. In satu-satunya cara memulihkan akun jika passphrase hilang. Jika kode akun DAN recovery key hilang bersamaan, akun tidak dapat dipulihkan.',
      ),
    ),
    el('button', {
      class: 'btn btn--block', type: 'button', style: { marginTop: '8px' },
      onClick: () => copyText(identity.recoveryKey, 'Recovery key disalin. Simpan di tempat aman!'),
    }, icon('copy'), 'Salin Recovery Key'),

    el('div', { class: 'stack', style: { marginTop: '24px' } },
      el('a', { class: 'btn btn--primary btn--lg btn--block', href: '#/login' },
        icon('log-in'), 'Lanjut ke Halaman Masuk'),
      el('button', {
        class: 'btn btn--ghost btn--block', type: 'button',
        onClick: () => { card.classList.remove('auth-card--wide'); renderForm(card); },
      }, 'Buat akun lain'),
    ),
  );
}

function maskId(id) {
  const text = String(id ?? '');
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

async function copyText(text, successMessage) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast(successMessage, 'success');
  } catch {
    showToast('Gagal menyalin. Salin manual dari layar.', 'error');
  }
}

async function shareCode(code) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Kode akun KLIK saya', text: code });
      showToast('Berhasil dibagikan.', 'success');
    } catch {
      /* pengguna membatalkan share */
    }
  } else {
    copyText(code, 'Browser tidak mendukung berbagi langsung - kode disalin.');
  }
}
