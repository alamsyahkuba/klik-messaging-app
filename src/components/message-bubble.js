import { el } from '../utils/dom.js';
import { formatClock } from '../utils/format-time.js';
import { icon } from './icon.js';

const STATUS = {
  pending: { name: 'clock', label: 'Tertunda', cls: 'msg-status--pending' },
  sent: { name: 'check', label: 'Terkirim', cls: '' },
  read: { name: 'checks', label: 'Dibaca', cls: 'msg-status--read' },
};

/**
 * Gelembung pesan Neobrutalism.
 * @param {{id,text,at,status,senderId,replyTo}} message
 * @param {{mine:boolean, senderName?:string, showSender?:boolean,
 *          replyTarget?:{senderName:string,text:string}|null,
 *          onReply?:Function, onCopy?:Function, system?:boolean}} options
 */
export function messageBubble(message, options = {}) {
  const { mine = false, senderName = '', showSender = false, replyTarget = null, onReply, onCopy, system = false } = options;

  if (system) {
    return el('div', { class: 'bubble bubble--system' }, message.text);
  }

  const metaParts = [el('span', {}, formatClock(message.at))];
  if (mine && message.status && STATUS[message.status]) {
    const st = STATUS[message.status];
    metaParts.push(
      el('span', { class: `msg-status ${st.cls}`, title: st.label, 'aria-label': st.label }, icon(st.name)),
    );
  }

  const actions = (onReply || onCopy)
    ? el('div', { class: 'msg-actions' },
        onReply ? el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Balas pesan',
          onClick: () => onReply(message),
        }, icon('reply'), 'Balas') : null,
        onCopy ? el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Salin pesan',
          onClick: () => onCopy(message),
        }, icon('copy'), 'Salin') : null,
      )
    : null;

  return el('div', {
    class: `msg-row${mine ? ' msg-row--mine' : ''}`,
    dataset: { messageId: message.id },
  },
    showSender && senderName && !mine
      ? el('span', { class: 'text-xs text-muted', style: { fontWeight: 'var(--weight-semibold)' } }, senderName)
      : null,
    el('div', { class: 'bubble' },
      replyTarget
        ? el('span', { class: 'bubble__reply' }, `${replyTarget.senderName}: ${replyTarget.text}`)
        : null,
      el('span', { class: 'bubble__text' }, message.text),
      el('div', { class: 'bubble__meta' }, metaParts),
    ),
    actions,
  );
}
