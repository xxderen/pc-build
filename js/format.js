// Formatierung und winziger DOM-Helfer. Texte landen immer über Textknoten im DOM (nie innerHTML).

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const DEC = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });

export const eur = (v) => (v == null ? '–' : EUR.format(v));
export const eur0 = (v) => (v == null ? '–' : EUR0.format(v));
export const num = (v) => DEC.format(v);
export const dateTime = (iso) => DATE.format(new Date(iso));
export const shortDate = (iso) => DAY.format(new Date(iso));

export function ago(iso, now = Date.now()) {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 2) return 'gerade eben';
  if (min < 90) return `vor ${min} Min.`;
  const hours = Math.round(min / 60);
  if (hours < 36) return `vor ${hours} Std.`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, kids);
  return el;
}

export function svg(tag, props, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(props || {})) if (value != null) el.setAttribute(key, value);
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

export const link = (text, href, props = {}) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', ...props }, text);

/** Ersetzt den Inhalt eines Containers und stellt den Fokus (per data-focus) wieder her. */
export function mount(container, ...nodes) {
  const focused = document.activeElement?.dataset?.focus;
  container.replaceChildren(...nodes);
  if (focused) container.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
