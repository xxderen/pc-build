// FPS-Übersicht: waagerechte Balken je Spiel (Nativ / DLSS Quality / DLSS Quality + Frame Generation),
// senkrechte Linie bei der Bildwiederholrate des gewählten Monitors, Tabellenansicht als Zwilling.
// Werte stehen in data/fps.json (gemessen oder Schätzung, jeweils mit Quelle).

import { h, link, mount, num } from './format.js';
import { hideTip, moveTip, showTip } from './charts.js';

const COLORS = { native: 'var(--series-1)', dlss_q: 'var(--series-2)', dlss_q_fg: 'var(--series-3)' };
const AXIS_STEPS = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200];
const KIND = { measured: 'gemessen', estimate: 'Schätzung' };

let tableView = false;

const effective = (value, game) => (game.cap_fps ? Math.min(value.fps, game.cap_fps) : value.fps);
const axisMax = (games, hz) => {
  const top = Math.max(hz * 1.05, ...games.flatMap((g) => Object.values(g.values).filter((v) => v.fps).map((v) => v.fps)));
  return AXIS_STEPS.find((step) => step >= top) ?? Math.ceil(top / 100) * 100;
};

function tipFor(event, game, mode, value, hz) {
  const eff = effective(value, game);
  showTip(event, [
    h('div', null, h('span', { class: 'key', style: `border-color:${COLORS[mode.id]}` }), h('b', null, `${num(value.fps)} FPS`)),
    h('div', { class: 't2' }, `${game.name} · ${mode.label}`),
    h('div', { class: 't2' }, `${KIND[value.kind]} · ${game.settings}`),
    h('div', { class: 't2' }, eff >= hz ? `Erreicht ${hz} Hz` : `Erreicht ${hz} Hz nicht${game.cap_fps && value.fps >= hz ? ` (Spiel-Limit ${game.cap_fps} FPS)` : ''}`),
    value.note ? h('div', { class: 't2' }, value.note) : null,
    h('div', { class: 't2' }, `Quelle: ${value.source.name}`),
  ]);
}

function barRow(game, mode, value, max, hz) {
  const eff = effective(value, game);
  const reaches = eff >= hz;
  const estimate = value.kind === 'estimate';
  const text = `${mode.label}: ${value.fps} FPS (${KIND[value.kind]})${reaches ? `, erreicht ${hz} Hz` : `, erreicht ${hz} Hz nicht`}`;
  const row = h('div', { class: `bar${estimate ? ' bar--est' : ''}`, tabindex: 0, role: 'img', 'aria-label': text },
    h('div', { class: 'bar__track' }, h('div', { class: 'bar__fill', style: `width:${Math.min(100, (value.fps / max) * 100)}%;background:${COLORS[mode.id]}` })),
    h('div', { class: 'bar__val' }, `${estimate ? '~' : ''}${num(value.fps)} FPS`,
      reaches ? h('span', { class: 'ok', 'aria-hidden': 'true' }, '✓') : null,
      game.cap_fps && value.fps > game.cap_fps ? h('span', { class: 'cap' }, `Limit ${game.cap_fps}`) : null));
  row.addEventListener('pointermove', (event) => (document.getElementById('tooltip').hidden ? tipFor(event, game, mode, value, hz) : moveTip(event)));
  row.addEventListener('pointerleave', hideTip);
  row.addEventListener('focus', () => { const box = row.getBoundingClientRect(); tipFor({ clientX: box.left + 40, clientY: box.bottom }, game, mode, value, hz); });
  row.addEventListener('blur', hideTip);
  return row;
}

function gameRow(game, modes, max, hz) {
  const bars = [];
  const naByReason = new Map();
  for (const mode of modes) {
    const value = game.values[mode.id];
    if (value?.fps != null) bars.push(barRow(game, mode, value, max, hz));
    else if (value?.na) naByReason.set(value.na, [...(naByReason.get(value.na) ?? []), mode.short]);
  }
  for (const [reason, shorts] of naByReason) bars.push(h('div', { class: 'na' }, `${shorts.join(' / ')}: ${reason}`));
  return h('div', { class: 'game' },
    h('div', { class: 'game__name' }, game.name, h('span', { class: 'game__meta' }, game.settings)),
    h('div', { class: 'bars' }, bars));
}

function groupPlot(group, modes, hz) {
  const max = axisMax(group.games, hz);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  return h('div', { class: 'fps__group' },
    h('h3', null, group.label),
    h('div', { class: 'fps__plot' },
      ticks.slice(1).map((t) => h('div', { class: 'vline vline--grid', style: `--p:${t / max}` })),
      h('div', { class: 'vline vline--hz', style: `--p:${hz / max}` }, h('span', { class: 'vline__label' }, `${hz} Hz`)),
      group.games.map((game) => gameRow(game, modes, max, hz)),
      h('div', { class: 'fps__axis', 'aria-hidden': 'true' }, ticks.map((t) => h('span', { style: `left:${(t / max) * 100}%` }, `${t}`)))));
}

function table(fps, hz) {
  const rows = fps.groups.flatMap((g) => g.games.map((game) => [g, game]));
  const cell = (game, mode) => {
    const v = game.values[mode.id];
    if (!v) return '–';
    if (v.na) return h('span', { class: 'muted' }, 'n. v.');
    const eff = effective(v, game);
    return [`${v.kind === 'estimate' ? '~' : ''}${num(v.fps)} FPS`, ' ', h('span', { class: 'muted' }, `(${KIND[v.kind]}${eff >= hz ? `, ≥ ${hz} Hz` : ''}) `), link(v.source.name, v.source.url)];
  };
  return h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Spiel'), h('th', null, 'Einstellungen'), fps.modes.map((m) => h('th', null, m.label)))),
    h('tbody', null, rows.map(([, game]) => h('tr', null, h('td', null, game.name), h('td', { class: 'muted' }, game.settings),
      fps.modes.map((mode) => h('td', null, cell(game, mode))))))));
}

export function renderFps(container, fps, hz, monitorName) {
  const legend = h('div', { class: 'legend' },
    fps.modes.map((m) => h('span', null, h('i', { style: `border-color:${COLORS[m.id]}` }), m.label)),
    h('span', null, '~ = Schätzung, ✓ = erreicht die Bildwiederholrate'));
  const toggle = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(tableView), 'data-focus': 'fps-table',
    onclick: () => { tableView = !tableView; renderFps(container, fps, hz, monitorName); } }, tableView ? 'Diagramm anzeigen' : 'Tabelle anzeigen');
  const methods = fps.meta.estimate_factors;
  mount(container,
    h('h2', { id: 'fps-h' }, 'FPS-Übersicht (1440p)'),
    h('p', { class: 'sub' }, `${fps.meta.system} · ${fps.meta.resolution} · Monitor: ${hz} Hz (${monitorName}). Werte aus öffentlichen Tests; Schätzungen sind gekennzeichnet.`),
    h('div', { class: 'fps__controls' }, legend, toggle),
    ...(tableView ? [table(fps, hz)] : fps.groups.map((g) => groupPlot(g, fps.modes, hz))),
    h('details', { class: 'srcs' },
      h('summary', null, 'Quellen und Schätzmethode'),
      h('ul', null, Object.values(fps.meta.sources).map((s) => h('li', null, link(s.name, s.url), h('span', { class: 'muted' }, ` – ${s.system}`)))),
      h('p', null, `Schätzung: DLSS Quality = ${methods.dlss_q}; Frame Generation = ${methods.frame_generation}.`),
      h('p', null, methods.begruendung),
      h('p', { class: 'muted' }, `Stand: ${fps.meta.updated}. Daten in data/fps.json editierbar.`)));
}
