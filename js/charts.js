// Preisverlauf als Stufenlinie (der Preis gilt bis zur nächsten Änderung) plus ein gemeinsames Tooltip.
// Marker: 2-px-Linie, Endpunkt r=4 mit 2-px-Ring in Flächenfarbe, Fläche 10 % – siehe css/style.css.

import { dateTime, eur, eur0, h, shortDate, svg } from './format.js';

// ---------- Tooltip (eine Instanz für alle Diagramme; Inhalt immer als Textknoten) ----------
const tip = () => document.getElementById('tooltip');

export function showTip(event, nodes) {
  const el = tip();
  el.replaceChildren(...nodes);
  el.hidden = false;
  moveTip(event);
}

export function moveTip(event) {
  const el = tip();
  const gap = 14;
  const { innerWidth: vw, innerHeight: vh } = window;
  const rect = el.getBoundingClientRect();
  const x = event.clientX + gap + rect.width > vw ? event.clientX - gap - rect.width : event.clientX + gap;
  const y = event.clientY + gap + rect.height > vh ? event.clientY - gap - rect.height : event.clientY + gap;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

export const hideTip = () => { tip().hidden = true; };

// ---------- Liniendiagramm ----------
const SOURCES = { geizhals: 'Geizhals', billiger: 'billiger.de', shopify: 'Hersteller-Shop' };

export function lineChart(history, { width = 120, height = 34, axes = false, label = 'Preisverlauf' } = {}) {
  const points = history.map(([t, p, s]) => ({ t: Date.parse(t), p, s }));
  const last = points[points.length - 1];
  const series = [...points, { t: Math.max(Date.now(), last.t + 1), p: last.p, s: last.s }];
  const prices = points.map((x) => x.p);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (lo === hi) { lo *= 0.97; hi *= 1.03; } else { const pad = (hi - lo) * 0.12; lo -= pad; hi += pad; }
  const pad = axes ? { l: 58, r: 14, t: 10, b: 26 } : { l: 4, r: 8, t: 5, b: 5 };
  const x0 = points[0].t, x1 = series[series.length - 1].t;
  const sx = (t) => pad.l + ((t - x0) / Math.max(1, x1 - x0)) * (width - pad.l - pad.r);
  const sy = (p) => pad.t + (1 - (p - lo) / (hi - lo)) * (height - pad.t - pad.b);

  let d = `M${sx(series[0].t)},${sy(series[0].p)}`;
  for (let i = 1; i < series.length; i++) d += ` H${sx(series[i].t)} V${sy(series[i].p)}`;
  const baseline = height - pad.b;

  const root = svg('svg', {
    class: 'spark', viewBox: `0 0 ${width} ${height}`, width: axes ? '100%' : width, height: axes ? null : height,
    role: 'img', 'aria-label': `${label}: von ${eur(points[0].p)} auf ${eur(last.p)} (${points.length} Datenpunkte)`, tabindex: 0,
  });
  if (axes) {
    for (const value of [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1]) {
      root.append(svg('line', { x1: pad.l, x2: width - pad.r, y1: sy(value), y2: sy(value), stroke: 'var(--grid)', 'stroke-width': 1 }),
        svg('text', { x: pad.l - 8, y: sy(value) + 4, 'text-anchor': 'end', fill: 'var(--ink-3)', 'font-size': 11 }, eur0(value)));
    }
    root.append(svg('text', { x: pad.l, y: height - 6, fill: 'var(--ink-3)', 'font-size': 11 }, shortDate(new Date(x0).toISOString())),
      svg('text', { x: width - pad.r, y: height - 6, 'text-anchor': 'end', fill: 'var(--ink-3)', 'font-size': 11 }, shortDate(new Date(x1).toISOString())));
  }
  root.append(
    svg('path', { class: 'spark__area', d: `${d} V${baseline} H${sx(series[0].t)} Z` }),
    svg('path', { class: 'spark__line', d, 'vector-effect': 'non-scaling-stroke' }),
  );
  const cursor = svg('line', { class: 'spark__cursor', y1: pad.t, y2: baseline, visibility: 'hidden' });
  const hover = svg('circle', { class: 'spark__dot', r: 4, visibility: 'hidden' });
  const end = svg('circle', { class: 'spark__dot', r: 4, cx: sx(x1), cy: sy(last.p) });
  const hit = svg('rect', { class: 'spark__hit', x: 0, y: 0, width, height });
  root.append(cursor, hover, end, hit);

  const at = (clientX) => {
    const box = root.getBoundingClientRect();
    const t = x0 + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * (x1 - x0);
    return points.filter((x) => x.t <= t).pop() ?? points[0];
  };
  const show = (event, point) => {
    const cx = sx(Math.max(point.t, x0));
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
    hover.setAttribute('cx', cx); hover.setAttribute('cy', sy(point.p)); hover.setAttribute('visibility', 'visible');
    showTip(event, [
      h('div', null, h('span', { class: 'key', style: 'border-color:var(--series-1)' }), h('b', null, eur(point.p))),
      h('div', { class: 't2' }, `seit ${dateTime(new Date(point.t).toISOString())}`),
      h('div', { class: 't2' }, `Quelle: ${SOURCES[point.s] ?? point.s}`),
    ]);
  };
  const leave = () => { cursor.setAttribute('visibility', 'hidden'); hover.setAttribute('visibility', 'hidden'); hideTip(); };
  hit.addEventListener('pointermove', (e) => show(e, at(e.clientX)));
  hit.addEventListener('pointerleave', leave);
  root.addEventListener('focus', () => {
    const box = root.getBoundingClientRect();
    show({ clientX: box.right, clientY: box.top }, last);
  });
  root.addEventListener('blur', leave);
  return root;
}

/** Tabellenansicht zum Diagramm (die Werte sind nie nur per Tooltip erreichbar). */
export function historyTable(history, limit = 20) {
  const rows = history.slice(-limit).reverse();
  return h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Zeitpunkt'), h('th', null, 'Preis'), h('th', null, 'Quelle'))),
    h('tbody', null, rows.map(([t, p, s]) => h('tr', null, h('td', null, dateTime(t)), h('td', null, eur(p)), h('td', null, SOURCES[s] ?? s)))));
}
