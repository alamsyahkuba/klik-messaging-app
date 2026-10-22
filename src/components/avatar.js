import { el } from '../utils/dom.js';
import { initials, hashString } from '../utils/id.js';

const COLORS = ['var(--avatar-1)', 'var(--avatar-2)', 'var(--avatar-3)', 'var(--avatar-4)', 'var(--avatar-5)'];

/** Avatar inisial dengan warna deterministik dari nama/id. */
export function avatar({ name = '?', id = name, size = '', online = null, round = false } = {}) {
  const color = COLORS[hashString(String(id)) % COLORS.length];
  const node = el('span', {
    class: ['avatar', size ? `avatar--${size}` : '', round ? 'avatar--round' : ''].filter(Boolean).join(' '),
    style: { background: color },
    'aria-hidden': 'true',
  }, initials(name));
  if (online !== null) {
    node.append(el('span', { class: `avatar__status${online ? '' : ' avatar__status--offline'}` }));
  }
  return node;
}
