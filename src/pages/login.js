import { el, clear } from '../utils/dom.js';
import { icon } from '../components/icon.js';
import { showToast } from '../components/toast.js';
import { openModal } from '../components/modal.js';
import { ServiceError } from '../services/_fake.js';
import { normalizeAccountCode } from '../utils/id.js';
import { loginWithPassphrase, recoverAccount } from '../services/auth-service.js';
import { isLive } from '../services/supabase.js';

/**
 * Halaman C: Login / Account Recovery.
 * Kredensial: kode akun publik + passphrase (bukan kode akun saja).
 * Milestone 3: verifikasi nyata oleh Edge Function auth-login (PBKDF2).
 */
export function loginPage() {
  const errorBox = el('p', { class: 'field__error hidden', role: 'alert' });

  const codeInput = el('input', {
    class: 'input text-mono', type: 'text', id: 'login-code',
    placeholder: 'KLIK-XXXX-XXXX', autocomplete: 'username',
    autocapitalize: 'characters', spellcheck: 'false',
  });

  const passInput = el('input', {
    class: 'input', type: 'password', id: 'login-pass',
    placeholder: 'Passphrase kamu', autocomplete: 'current-password',
  });

  const revealBtn = el('button', {
    class: 'btn btn--ghost btn--icon', type: 'button',
    'aria-label': 'Tampilkan passphrase', 'aria-pressed': 'false',
    onClick: () => {
      const shown = passInput.type === 'text';
      passInput.type = shown ? 'password' : 'text';
      revealBtn.setAttribute('aria-pressed', String(!shown));
      revealBtn.setAttribute('aria-label', shown ? 'Tampilkan passphrase' : 'Sembunyikan passphrase');
      clear(revealBtn).append(icon(shown ? 'eye' : 'lock'));
    },
  }, icon('eye'));

  const submitBtn = el('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' },
    icon('log-in'), 'Masuk',
  );

  const form = el('form', { class: 'stack-lg', novalidate: true, onSubmit: handleSubmit },
    el('div', { class: 'text-center' },
      el('img', { class: 'hero-logo', src: 'src/assets/logo.svg', alt: '', width: '96', height: '96' }),
      el('h1', { class: 'text-display' }, 'Masuk'),
      el('p', { class: 'text-sm text-muted', style: { marginTop: '8px' } },
        'Gunakan kode akun dan passphrase. Tanpa email, tanpa nomor telepon.',
      ),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'login-code' }, 'Kode akun'),
      codeInput,
      el('span', { class: 'field__hint' }, 'Kode publik hanya untuk identifikasi. Kombinasikan dengan passphrase.'),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'login-pass' }, 'Passphrase'),
      el('div', { class: 'input-group' }, passInput, revealBtn),
      errorBox,
    ),
    submitBtn,
    el('button', {
      class: 'btn btn--ghost btn--block', type: 'button',
      onClick: openRecoveryHelp,
    }, icon('key'), 'Lupa passphrase? Cara memulihkan akun'),
    el('a', { class: 'btn btn--ghost btn--block', href: '#/create-account' }, 'Belum punya akun? Buat akun'),
    el('div', { class: 'notice' },
      icon('info'),
      el('span', {},
        isLive()
          ? 'Kode akun dipakai untuk dikenali; passphrase yang membuka akun. Verifikasi oleh Edge Function auth-login (PBKDF2).'
          : 'Mode demo: masukkan kode berformat KLIK-XXXX-XXXX dan passphrase minimal 8 karakter. Verifikasi nyata oleh Edge Function auth-login.',
      ),
    ),
  );

  function showError(message) {
    clear(errorBox);
    errorBox.append(icon('alert-circle'), el('span', {}, message));
    errorBox.classList.remove('hidden');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    errorBox.classList.add('hidden');
    codeInput.removeAttribute('aria-invalid');
    passInput.removeAttribute('aria-invalid');

    const code = normalizeAccountCode(codeInput.value);
    const passphrase = passInput.value;

    if (!/^KLIK[A-Z0-9]{8}$/.test(code)) {
      showError('Format kode akun tidak valid. Contoh: KLIK-7Q2M-9X4D.');
      codeInput.setAttribute('aria-invalid', 'true');
      codeInput.focus();
      return;
    }
    if (passphrase.length < 8) {
      showError('Passphrase minimal 8 karakter.');
      passInput.setAttribute('aria-invalid', 'true');
      passInput.focus();
      return;
    }

    submitBtn.disabled = true;
    clear(submitBtn);
    submitBtn.append(icon('loader', 'icon-spin'), 'Memverifikasi...');

    try {
      await loginWithPassphrase({ publicCode: code, passphrase });
      passInput.value = '';
      showToast(isLive() ? 'Berhasil masuk.' : 'Berhasil masuk (mode demo).', 'success');
      location.hash = '#/app/chats';
    } catch (error) {
      showError(error instanceof ServiceError ? error.message : 'Gagal masuk. Coba lagi.');
    } finally {
      submitBtn.disabled = false;
      clear(submitBtn);
      submitBtn.append(icon('log-in'), 'Masuk');
    }
  }

  return el('div', { class: 'auth-page' }, el('section', { class: 'auth-card' }, form));
}

function openRecoveryHelp() {
  const step = (n, text) => el('div', { class: 'row', style: { alignItems: 'flex-start' } },
    el('span', { class: 'badge badge--primary', style: { minWidth: '26px', justifyContent: 'center' } }, String(n)),
    el('span', { class: 'text-sm' }, text),
  );

  const errorBox = el('p', { class: 'field__error hidden', role: 'alert' });

  const codeInput = el('input', {
    class: 'input text-mono', type: 'text', id: 'recover-code',
    placeholder: 'KLIK-XXXX-XXXX', autocapitalize: 'characters', spellcheck: 'false',
  });
  const keyInput = el('input', {
    class: 'input text-mono', type: 'text', id: 'recover-key',
    placeholder: 'RCV-XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters', spellcheck: 'false',
  });
  const passInput = el('input', { class: 'input', type: 'password', id: 'recover-pass', placeholder: 'Passphrase baru (min. 8)' });
  const passConfirmInput = el('input', { class: 'input', type: 'password', id: 'recover-pass-confirm', placeholder: 'Ulangi passphrase baru' });

  const submitBtn = el('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' },
    icon('key'), 'Pulihkan Akun',
  );

  const form = el('form', { class: 'stack', novalidate: true, onSubmit: handleRecover },
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'recover-code' }, 'Kode akun'), codeInput),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'recover-key' }, 'Recovery key'), keyInput),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'recover-pass' }, 'Passphrase baru'), passInput),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'recover-pass-confirm' }, 'Ulangi passphrase baru'),
      passConfirmInput,
      errorBox),
    submitBtn,
  );

  function showRecoveryError(message) {
    clear(errorBox);
    errorBox.append(icon('alert-circle'), el('span', {}, message));
    errorBox.classList.remove('hidden');
  }

  async function handleRecover(event) {
    event.preventDefault();
    errorBox.classList.add('hidden');
    const passphrase = passInput.value;
    if (passphrase.length < 8) {
      showRecoveryError('Passphrase baru minimal 8 karakter.');
      return;
    }
    if (passphrase !== passConfirmInput.value) {
      showRecoveryError('Passphrase baru dan ulangannya tidak sama.');
      return;
    }
    submitBtn.disabled = true;
    clear(submitBtn);
    submitBtn.append(icon('loader', 'icon-spin'), 'Memulihkan...');
    try {
      await recoverAccount({
        publicCode: codeInput.value,
        recoveryKey: keyInput.value,
        newPassphrase: passphrase,
      });
      import('../components/modal.js').then((m) => m.closeModal());
      showToast('Akun dipulihkan. Gunakan passphrase baru untuk masuk.', 'success');
      location.hash = '#/app/chats';
    } catch (error) {
      showRecoveryError(error instanceof ServiceError ? error.message : 'Gagal memulihkan akun. Coba lagi.');
      submitBtn.disabled = false;
      clear(submitBtn);
      submitBtn.append(icon('key'), 'Pulihkan Akun');
    }
  }

  openModal({
    title: 'Pemulihan akun',
    body: [
      el('div', { class: 'stack' },
        step(1, 'Siapkan kode akun publik DAN recovery key yang kamu simpan saat mendaftar.'),
        step(2, 'Buat passphrase baru di bawah ini. Passphrase lama tidak berlaku lagi.'),
        form,
      ),
      el('div', { class: 'notice notice--danger' },
        icon('alert-triangle'),
        el('span', {},
          'Jika kode akun, passphrase, dan recovery key hilang bersamaan, akun TIDAK dapat dipulihkan. Tidak ada email atau nomor telepon yang bisa kami gunakan untuk verifikasi.',
        ),
      ),
    ],
    footer: [el('button', { class: 'btn btn--primary', type: 'button', onClick: () => import('../components/modal.js').then((m) => m.closeModal()) }, 'Mengerti')],
  });
}
