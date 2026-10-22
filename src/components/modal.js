import { clear, el } from '../utils/dom.js';
import { icon } from './icon.js';

let activeModal = null;

/**
 * Modal Neobrutalism dengan backdrop, Escape-to-close, dan fokus awal.
 * @param {{title: string, body: Node|Node[], footer?: Node|Node[], wide?: boolean, onClose?: () => void}} options
 * @returns {{close: () => void, root: HTMLElement}}
 */
export function openModal({ title, body, footer = null, wide = false, onClose = null }) {
  closeModal();

  const root = document.getElementById('modal-root');
  const previousFocus = document.activeElement;

  const dialog = el('div', {
    class: `modal${wide ? ' modal--wide' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  });

  const close = () => {
    if (activeModal?.dialog !== dialog) return;
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    activeModal = null;
    onClose?.();
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  };

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  const closeButton = el('button', {
    class: 'btn btn--ghost btn--icon',
    type: 'button',
    'aria-label': 'Tutup',
    onClick: close,
  }, icon('x'));

  const header = el('div', { class: 'modal__header' },
    el('h2', { class: 'modal__title' }, title),
    closeButton,
  );

  const bodyNode = Array.isArray(body) ? el('div', { class: 'modal__body' }, body) : el('div', { class: 'modal__body' }, body);
  dialog.append(header, bodyNode);
  if (footer) dialog.append(el('div', { class: 'modal__footer' }, footer));

  const backdrop = el('div', {
    class: 'modal-backdrop',
    onClick: (event) => {
      if (event.target === backdrop) close();
    },
  }, dialog);

  root.append(backdrop);
  document.addEventListener('keydown', onKeydown);
  activeModal = { dialog, close };

  // Fokus aman di Android: hanya fokus elemen yang minta (data-autofocus) atau tombol.
  // Input/textarea tanpa data-autofocus TIDAK di-auto-focus supaya keyboard tidak langsung muncul.
  const focusTarget = dialog.querySelector('[data-autofocus]') || dialog.querySelector('button:not([aria-label="Tutup"])');
  (focusTarget || closeButton).focus({ preventScroll: true });

  return { close, root: dialog };
}

export function closeModal() {
  activeModal?.close();
}

export function confirmModal({ title, message, confirmLabel = 'Lanjutkan', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const modal = openModal({
      title,
      body: el('p', { class: 'text-sm' }, message),
      footer: [
        el('button', {
          class: 'btn', type: 'button',
          onClick: () => { decided = true; modal.close(); resolve(false); },
        }, 'Batal'),
        el('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button',
          onClick: () => { decided = true; modal.close(); resolve(true); },
        }, confirmLabel),
      ],
      onClose: () => { if (!decided) resolve(false); },
    });
  });
}

export function clearModalRoot() {
  const root = document.getElementById('modal-root');
  if (root) clear(root);
}
