import { el, clear } from '../utils/dom.js';
import { icon } from '../components/icon.js';
import { avatar } from '../components/avatar.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal, confirmModal } from '../components/modal.js';
import { errorState, skeletonList } from '../components/state-view.js';
import { qrFrame } from '../components/qr-preview.js';
import { getProfile, updateDisplayName, recoveryInfo } from '../services/profile-service.js';
import { ServiceError } from '../services/_fake.js';
import { logout } from '../services/auth-service.js';
import { pushStatus, syncPushSettings } from '../services/push-service.js';
import { isLive } from '../services/supabase.js';
import { getTheme, setTheme, getNotificationPrefs, setNotificationPrefs } from '../utils/preferences.js';
import { formatListTime } from '../utils/format-time.js';
import { renderShell } from './_shell.js';

/** Halaman I: Profile & Settings. */
export function profilePage({ query }) {
  let cancelled = false;
  let profile = null;
  let loadState = 'loading';
  let errorMessage = '';

  const body = el('div', { class: 'panel__body panel__body--pad scroll-y stack-lg' });

  const panel = el('section', { class: 'panel panel--fill' },
    el('header', { class: 'panel__header' },
      el('h1', { class: 'panel__title' }, 'Profil & Pengaturan'),
      el('span', { class: 'badge badge--secondary' }, icon('shield'), 'Akun KLIK'),
    ),
    body,
  );

  function sectionTitle(text) {
    return el('div', { class: 'section-title' }, text);
  }

  /** Kelompok judul seksi + kartu isinya (ridentik dengan halaman lain). */
  function sectionBlock(title, ...nodes) {
    return el('div', { class: 'section-block' },
      ...(title ? [sectionTitle(title)] : []),
      ...nodes,
    );
  }

  function infoRow(key, value) {
    return el('div', { class: 'info-row' },
      el('span', { class: 'info-row__key' }, key),
      el('span', { class: 'info-row__value' }, value),
    );
  }

  function render() {
    clear(body);
    if (loadState === 'loading') {
      body.append(skeletonList(5));
      return;
    }
    if (loadState === 'error') {
      body.append(errorState({
        title: 'Gagal memuat profil',
        message: errorMessage,
        onRetry: () => load('ok'),
      }));
      return;
    }

    const recovery = recoveryInfo();

    /* --- Profil --- */
    body.append(el('div', { class: 'card' },
      el('div', { class: 'profile-hero' },
        avatar({ name: profile.displayName, id: profile.id, size: 'lg' }),
        el('div', { class: 'grow' },
          el('p', { class: 'text-sm text-muted' }, 'Nama tampilan'),
          el('p', { class: 'text-lg' }, profile.displayName),
          el('span', { class: 'badge badge--secondary', style: { marginTop: 'var(--space-2)' } }, icon('check'), 'Online'),
        ),
        el('button', {
          class: 'btn btn--icon', type: 'button',
          'aria-label': 'Ubah nama tampilan', title: 'Ubah nama tampilan',
          onClick: openEditName,
        }, icon('edit')),
      ),
      el('p', { class: 'text-sm text-muted', style: { marginTop: 'var(--space-3)' } }, profile.status),
    ));

    /* --- Kode akun & QR --- */
    body.append(sectionBlock('Kode akun publik',
      el('div', { class: 'card stack' },
        el('p', { class: 'label-code' }, profile.publicCode),
        el('div', { class: 'row' },
          el('button', { class: 'btn grow', type: 'button', onClick: () => copyText(profile.publicCode, 'Kode akun disalin.') },
            icon('copy'), 'Salin Kode'),
          el('button', { class: 'btn grow', type: 'button', onClick: () => shareCode(profile.publicCode) },
            icon('share'), 'Bagikan'),
        ),
        qrFrame(profile.publicCode, { real: true }),
        el('p', { class: 'field__hint' },
          'Kode akun dipakai untuk dikenali dan ditambahkan sebagai teman. Kode ini BUKAN password dan tidak bisa dipakai masuk sendirian.'),
      ),
    ));

    /* --- Pemulihan akun --- */
    const helpCard = el('div', { class: 'card stack' },
      el('button', { class: 'btn btn--primary btn--block', type: 'button', onClick: openRecoveryHelp },
        icon('key'), 'Cara memulihkan akun'),
      el('div', { class: 'notice notice--danger' }, icon('alert-triangle'),
        el('span', {}, recovery.warning)),
    );

    if (recovery.recoveryKey) {
      const revealBtn = el('button', {
        class: 'btn btn--ghost btn--icon', type: 'button',
        'aria-label': 'Tampilkan recovery key', 'aria-pressed': 'false',
      }, icon('eye'));
      const recoveryLabel = el('p', { class: 'label-code label-code--sm' },
        maskRecovery(recovery.recoveryKey));

      let revealed = false;
      revealBtn.addEventListener('click', () => {
        revealed = !revealed;
        recoveryLabel.textContent = revealed ? recovery.recoveryKey : maskRecovery(recovery.recoveryKey);
        revealBtn.setAttribute('aria-pressed', String(revealed));
        revealBtn.setAttribute('aria-label', revealed ? 'Sembunyikan recovery key' : 'Tampilkan recovery key');
        clear(revealBtn).append(icon(revealed ? 'lock' : 'eye'));
      });

      body.append(sectionBlock('Pemulihan akun',
        el('div', { class: 'card stack' },
          el('div', { class: 'row' },
            el('div', { class: 'grow' }, recoveryLabel),
            revealBtn,
          ),
          el('button', { class: 'btn btn--block', type: 'button', onClick: () => copyText(recovery.recoveryKey, 'Recovery key disalin.') },
            icon('copy'), 'Salin Recovery Key'),
        ),
        helpCard,
      ));
    } else {
      body.append(sectionBlock('Pemulihan akun',
        el('div', { class: 'card stack' },
          el('p', { class: 'text-sm text-muted' },
            'Recovery key ditampilkan hanya saat dibuat atau dipulihkan di perangkat ini. Server menyimpan hash-nya saja - key asli tidak bisa dikirim ulang. Jika hilang, akun baru harus dibuat.'),
        ),
        helpCard,
      ));
    }

    /* --- Tema --- */
    const theme = getTheme();
    const segmented = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Pilih tema' });
    for (const option of [
      { key: 'auto', label: 'Auto' },
      { key: 'light', label: 'Terang' },
      { key: 'dark', label: 'Gelap' },
    ]) {
      segmented.append(el('button', {
        class: `segmented__btn${theme === option.key ? ' is-active' : ''}`,
        type: 'button',
        'aria-pressed': String(theme === option.key),
        onClick: (event) => {
          setTheme(option.key);
          for (const btn of segmented.children) {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
          }
          event.currentTarget.classList.add('is-active');
          event.currentTarget.setAttribute('aria-pressed', 'true');
          showToast(`Tema: ${option.label}.`, 'info');
        },
      }, option.label));
    }

    body.append(
      sectionBlock('Tampilan',
        el('div', { class: 'card' }, segmented),
      ),
    );

    /* --- Notifikasi --- */
    const prefs = getNotificationPrefs();
    const pushRow = el('p', { class: 'text-xs text-muted', style: { padding: 'var(--space-3) 0' } },
      'Memeriksa status push native...');
    pushStatus().then((status) => {
      pushRow.textContent = status.reason;
    }).catch(() => { pushRow.textContent = 'Status push tidak tersedia.'; });
    body.append(
      sectionBlock('Notifikasi',
        el('div', { class: 'card' },
          switchRow('Pratinjau pesan', 'Tampilkan isi pesan di notifikasi', prefs.messagePreview, (on) => {
            setNotificationPrefs({ ...prefs, messagePreview: on });
            prefs.messagePreview = on;
            syncPushSettings(prefs);
            showToast(on ? 'Pratinjau pesan diaktifkan.' : 'Pratinjau pesan dimatikan.', 'info');
          }),
          switchRow('Suara', 'Bunyi saat pesan masuk', prefs.sound, (on) => {
            setNotificationPrefs({ ...prefs, sound: on });
            prefs.sound = on;
            syncPushSettings(prefs);
            showToast(on ? 'Suara diaktifkan.' : 'Suara dimatikan.', 'info');
          }),
          pushRow,
        ),
      ),
    );

    /* --- Info akun & logout --- */
    body.append(
      sectionBlock('Akun',
        el('div', { class: 'card stack' },
          el('div', { class: 'info-grid' },
            infoRow('ID internal', maskId(profile.id)),
            infoRow('Dibuat', formatListTime(profile.createdAt)),
            infoRow('Kode akun', profile.publicCode),
          ),
          el('button', {
            class: 'menu-item menu-item--danger', type: 'button',
            onClick: handleLogout,
          }, icon('log-out'), 'Keluar dari akun'),
          el('p', { class: 'text-xs text-muted' },
            'Keluar hanya menghapus sesi lokal. Masuk kembali membutuhkan passphrase atau recovery key.'),
        ),
      ),
    );
  }

  function switchRow(label, hint, checked, onChange) {
    const control = el('button', {
      class: 'switch', type: 'button', role: 'switch',
      'aria-checked': String(checked),
      'aria-label': label,
      onClick: () => {
        const next = control.getAttribute('aria-checked') !== 'true';
        control.setAttribute('aria-checked', String(next));
        onChange(next);
      },
    });
    return el('div', { class: 'switch-row' },
      el('div', {},
        el('p', { class: 'switch-row__label' }, label),
        el('p', { class: 'switch-row__hint' }, hint),
      ),
      control,
    );
  }

  function openEditName() {
    const input = el('input', {
      class: 'input', type: 'text', value: profile.displayName,
      maxlength: '30', 'aria-label': 'Nama tampilan baru',
    });
    const errorBox = el('p', { class: 'field__error hidden' });
    let modalRef;
    modalRef = openModal({
      title: 'Ubah nama tampilan',
      body: [
        el('div', { class: 'field' },
          el('label', { class: 'field__label' }, 'Nama tampilan'),
          input,
          el('span', { class: 'field__hint' }, 'Bukan identitas unik. Teman tetap mengenali kamu lewat kode akun.'),
          errorBox,
        ),
      ],
      footer: [
        el('button', { class: 'btn', type: 'button', onClick: closeModal }, 'Batal'),
        el('button', {
          class: 'btn btn--primary', type: 'button',
          onClick: async () => {
            try {
              profile = await updateDisplayName(input.value);
              if (cancelled) return;
              modalRef.close();
              showToast('Nama tampilan diperbarui.', 'success');
              render();
            } catch (error) {
              clear(errorBox);
              errorBox.classList.remove('hidden');
              errorBox.append(icon('alert-circle'), el('span', {},
                error instanceof ServiceError ? error.message : 'Gagal memperbarui nama.'));
            }
          },
        }, 'Simpan'),
      ],
    });
  }

  function openRecoveryHelp() {
    const step = (n, text) => el('div', { class: 'row', style: { alignItems: 'flex-start' } },
      el('span', { class: 'badge badge--primary', style: { minWidth: '26px', justifyContent: 'center' } }, String(n)),
      el('span', { class: 'text-sm' }, text),
    );
    openModal({
      title: 'Cara memulihkan akun',
      body: [
        el('div', { class: 'stack' },
          step(1, 'Buka halaman Masuk, lalu pilih "Lupa passphrase?".'),
          step(2, 'Masukkan kode akun publik DAN recovery key kamu.'),
          step(3, 'Buat passphrase baru setelah recovery key terverifikasi.'),
          step(4, 'Passphrase lama otomatis tidak berlaku lagi.'),
        ),
        el('div', { class: 'notice notice--danger' }, icon('alert-triangle'),
          el('span', {},
            'Tanpa passphrase DAN tanpa recovery key, akun tidak dapat dipulihkan. KLIK tidak punya email/telepon untuk verifikasi.')),
        el('p', { class: 'text-xs text-muted' },
          'Formulir pemulihan ada di halaman Masuk ("Lupa passphrase?").'),
      ],
      footer: [el('button', { class: 'btn btn--primary', type: 'button', onClick: closeModal }, 'Mengerti')],
    });
  }

  async function handleLogout() {
    const ok = await confirmModal({
      title: 'Keluar dari akun?',
      message: 'Sesi lokal akan dihapus. Kamu butuh passphrase atau recovery key untuk masuk kembali.',
      confirmLabel: 'Keluar',
      danger: true,
    });
    if (!ok) return;
    await logout();
    showToast(isLive() ? 'Kamu telah keluar.' : 'Kamu telah keluar (mode demo).', 'info');
    location.hash = '#/welcome';
  }

  async function load(state = query.state || 'ok') {
    loadState = 'loading';
    render();
    try {
      profile = await getProfile({ state });
      if (cancelled) return;
      loadState = 'ok';
    } catch (error) {
      if (cancelled) return;
      loadState = 'error';
      errorMessage = error instanceof ServiceError ? error.message : 'Terjadi kesalahan.';
    }
    render();
  }

  load();

  return {
    node: renderShell({ active: 'profile' }, panel),
    cleanup: () => { cancelled = true; },
  };
}

function maskRecovery(key) {
  return `${key.slice(0, 4)}-${'•'.repeat(11)}-${'•'.repeat(11)}`;
}

function maskId(id) {
  return `${String(id).slice(0, 10)}...${String(id).slice(-4)}`;
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, 'success');
  } catch {
    showToast('Gagal menyalin. Salin manual.', 'error');
  }
}

async function shareCode(code) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Kode akun KLIK saya', text: code });
    } catch { /* dibatalkan */ }
  } else {
    copyText(code, 'Browser tidak mendukung berbagi - kode disalin.');
  }
}
