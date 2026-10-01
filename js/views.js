// DOM-Bausteine der Seite: Gesamtpreis, Preisliste, GPU-Auswahl, Lüfter-Plan, Kompatibilität.
// Alle Texte aus den Daten gehen als Textknoten ins DOM (siehe format.h).

import { historyOf, geizhalsUrl } from './data.js';
import { historyTable, lineChart } from './charts.js';
import { ago, dateTime, eur, eur0, h, link, num } from './format.js';
import { budgetState, isListable } from './model.js';
import { summarize } from './compat.js';

const safe = (url) => (typeof url === 'string' && /^https?:\/\//.test(url) ? url : null);
const AVAIL = {
  in_stock: ['lieferbar', 'good'],
  shortly: ['kurzfristig lieferbar', 'good'],
  unavailable: ['nicht lieferbar', 'bad'],
  unknown: ['Verfügbarkeit unbekannt', ''],
};
const SOURCE_NAMES = { geizhals: 'Geizhals', billiger: 'billiger.de', shopify: 'Hersteller-Shop', fixed: 'fest' };

export const availabilityBadge = (current) => {
  const [text, tone] = AVAIL[current.availability] ?? AVAIL.unknown;
  return h('span', { class: `badge${tone ? ` badge--${tone}` : ''}` }, text);
};

const placeholder = () => h('div', { class: 'row__img row__img--none', 'aria-hidden': 'true' }, 'kein Bild');
function image(part, cls) {
  const url = safe(part.image);
  if (!url) return placeholder();
  return h('img', { class: cls, src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', width: 64, height: 64,
    onerror: (event) => event.target.replaceWith(placeholder()) });
}

// ------------------------------------------------------------------ Gesamtpreis
export function heroView({ model, view, budget, handlers }) {
  const total = view === 'pc' ? model.totals.pc : model.totals.all;
  const state = budgetState(total, budget);
  const diff = total - budget;
  const scale = Math.max(total, budget) * 1.08;
  const tick = (budget / scale) * 100;
  const tone = { ok: 'good', warn: 'warn', bad: 'bad' }[state];
  const text = diff > 0 ? `${eur0(diff)} über dem Budget (+${num((diff / budget) * 100)} %)` : `${eur0(-diff)} unter dem Budget`;
  const seg = (id, label) => h('button', { type: 'button', 'aria-pressed': String(view === id), 'data-focus': `view-${id}`, onclick: () => handlers.onView(id) }, label);
  return h('div', { class: 'hero' },
    h('div', { class: 'hero__top' },
      h('div', null,
        h('div', { class: 'hero__label' }, view === 'pc' ? 'Gesamtpreis – PC ohne Monitor' : 'Gesamtpreis – PC + Monitor'),
        h('div', { class: 'hero__value', 'aria-live': 'polite' }, eur0(total)),
        h('div', { class: 'hero__delta' }, h('span', { class: `badge badge--${tone}` }, diff > 0 ? '▲' : '✓', ' ', text),
          h('span', { class: 'muted' }, `Budget-Ziel ${eur0(budget)} (darf etwas drüber gehen)`))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' }, seg('pc', 'PC allein'), seg('pcmon', 'PC + Monitor'))),
    h('div', { class: 'meter', role: 'img', 'aria-label': `${eur0(total)} von ${eur0(budget)} Budget` },
      h('div', { class: 'meter__track' },
        h('div', { class: `meter__fill${state === 'ok' ? '' : ` meter__fill--${state}`}`, style: `width:${Math.min(100, (total / scale) * 100)}%` }),
        h('div', { class: 'meter__tick', style: `left:${tick}%` })),
      h('div', { class: 'meter__labels', 'aria-hidden': 'true' },
        h('span', { class: 'l' }, eur0(0)), h('span', { style: `left:${tick}%` }, `Budget ${eur0(budget)}`))),
    h('div', { class: 'hero__parts' },
      h('span', null, 'PC: ', h('b', null, eur0(model.totals.pc))),
      h('span', null, 'Monitor: ', h('b', null, eur0(model.totals.monitor))),
      h('span', null, 'zusammen: ', h('b', null, eur0(model.totals.all))),
      model.missing.length ? h('span', { class: 'badge badge--warn' }, `ohne Preis: ${model.missing.join(', ')}`) : null));
}

// ------------------------------------------------------------------ Preisliste
function sortedOptions(data, categoryId) {
  const options = Object.values(data.catalog.parts).filter((p) => p.category === categoryId);
  const key = (p) => {
    const cur = data.prices.parts[p.id]?.current;
    return [cur && isListable(cur) ? 0 : cur ? 1 : 2, cur?.price ?? 1e9];
  };
  return categoryId === 'gpu' || categoryId === 'ssd' || categoryId === 'monitor'
    ? options.sort((a, b) => { const [ga, pa] = key(a); const [gb, pb] = key(b); return ga - gb || pa - pb; })
    : options;
}

function optionLabel(data, part) {
  const cur = part.fixed_price != null ? { price: 0, availability: 'in_stock' } : data.prices.parts[part.id]?.current;
  if (!cur) return `${part.name} – keine Angebote`;
  return `${part.name} – ${eur(cur.price)}${isListable(cur) ? '' : ' (nicht lieferbar)'}`;
}

function choiceCell(line, ctx) {
  const { data, selection, model, handlers } = ctx;
  const category = line.category;
  if (category.kind === 'fans') return h('span', { class: 'muted' }, 'siehe Lüfter-Plan');
  if (category.kind !== 'choice') return h('span', { class: 'muted' }, '–');
  const options = sortedOptions(data, category.id);
  if (options.length < 2) return h('span', { class: 'muted' }, 'fest');
  const hasAuto = category.default === 'auto';
  const current = selection[category.id] ?? (hasAuto ? 'auto' : category.default);
  const select = h('select', { 'aria-label': category.label, 'data-focus': `sel-${category.id}`, onchange: (e) => handlers.onSelect(category.id, e.target.value) },
    hasAuto ? h('option', { value: 'auto', selected: current === 'auto' || null }, 'Automatisch günstigste lieferbare') : null,
    options.map((p) => h('option', { value: p.id, selected: current === p.id || null }, optionLabel(data, p))));
  return select;
}

function priceCell(line, ctx) {
  const { data } = ctx;
  const cur = line.current;
  const part = line.part;
  if (!cur) {
    return h('div', null, h('div', { class: 'row__price muted' }, 'keine Angebote'),
      geizhalsUrl(part) ? link('im Preisvergleich ansehen', geizhalsUrl(part), { class: 'row__merchant' }) : null);
  }
  const target = data.targets.targets?.[part.id];
  const interval = data.status?.interval_minutes ?? 30;
  const checked = data.status?.parts?.[part.id]?.checked_at ?? cur.since;
  const stale = cur.source !== 'fixed' && Date.now() - Date.parse(checked) > Math.max(3 * 3600e3, interval * 4 * 60e3);
  const url = safe(cur.url);
  return h('div', null,
    h('div', { class: 'row__price' }, eur(line.unit), line.qty > 1 ? h('span', { class: 'row__qty' }, ` × ${line.qty} = ${eur(line.sum)}`) : null),
    cur.merchant ? h('div', { class: 'row__merchant' }, `bei ${cur.merchant}`) : null,
    h('div', { class: 'row__trend' }, cur.source === 'fixed' ? null : availabilityBadge(cur),
      stale ? h('span', { class: 'badge badge--warn', title: 'Der Preis wurde länger nicht aktualisiert.' }, `Stand ${ago(checked)}`) : null,
      url ? link('Zum Angebot', url, { class: 'row__merchant' }) : null),
    target != null ? h('div', { class: 'row__target' }, `Ziel ${eur(target)} `, line.unit <= target
      ? h('span', { class: 'badge badge--good' }, '✓ unter Ziel') : h('span', { class: 'badge' }, `+${eur(line.unit - target)}`)) : null);
}

function subline(line, ctx) {
  if (line.category.id === 'paste') {
    const aio = ctx.model.picks.aio;
    return aio.specs.paste_included
      ? h('div', { class: 'row__sub' }, `Hinweis: Dem ${aio.name.split(' (')[0]} liegt bereits Paste bei (vorab aufgetragen + ${aio.specs.paste_extra_g}-g-Tube).`)
      : null;
  }
  if (line.category.kind !== 'fans') return null;
  const blade = line.part.specs.blade;
  const labels = ctx.model.fans.positions.filter((p) => p.blade === blade && p.matrix > 0).map((p) => p.label.replace(' (AIO-Radiator)', ''));
  return h('div', { class: 'row__sub' }, `${blade === 'reverse' ? 'Intake' : 'Exhaust'} (${labels.join(' + ')}) · ${blade === 'reverse' ? 'Reverse' : 'Standard'}-Blade`);
}

function detailsBox(line, ctx) {
  const { data } = ctx;
  const part = line.part;
  const history = historyOf(data, part.id);
  const src = part.sources ?? {};
  const links = [
    safe(part.url) ? link('Hersteller / Info', part.url) : null,
    geizhalsUrl(part) ? link('Preisvergleich (Geizhals)', geizhalsUrl(part)) : null,
    safe(src.billiger) ? link('billiger.de', src.billiger) : null,
    ...(part.reviews ?? []).map((r) => link(`Test: ${r.name}`, r.url)),
  ].filter(Boolean);
  const cur = line.current;
  return h('div', { class: 'row__details' },
    part.notes?.length ? h('ul', null, part.notes.map((n) => h('li', null, n))) : null,
    links.length ? h('div', { class: 'linklist' }, links) : null,
    cur && cur.source !== 'fixed' ? h('p', { class: 'muted' }, `Preis seit ${dateTime(cur.since)} · Quelle: ${SOURCE_NAMES[cur.source] ?? cur.source}`) : null,
    h('h4', null, 'Preisverlauf'),
    history.length >= 2
      ? h('div', { class: 'history' }, h('div', { class: 'history__chart' }, lineChart(history, { width: 640, height: 190, axes: true, label: `Preisverlauf ${part.name}` })), historyTable(history))
      : h('p', { class: 'muted' }, history.length === 1
        ? 'Erst ein Datenpunkt – der Verlauf entsteht mit den nächsten Preisänderungen (der Checker speichert nur Änderungen).'
        : 'Noch keine Preisdaten.'));
}

function partRow(line, first, ctx) {
  const { expanded, handlers, data } = ctx;
  const part = line.part;
  const history = historyOf(data, part.id);
  const open = expanded.has(part.id);
  const row = h('li', { class: `row${first ? ' row--sep' : ''}` },
    image(part, 'row__img'),
    h('div', null,
      first ? h('div', { class: 'row__cat' }, line.category.label) : null,
      h('div', { class: 'row__name' }, part.name, line.qty > 1 ? h('span', { class: 'row__qty' }, ` × ${line.qty}`) : null),
      subline(line, ctx)),
    choiceCell(line, ctx),
    priceCell(line, ctx),
    h('div', { class: 'row__trend' },
      history.length >= 2 ? lineChart(history, { label: `Preisverlauf ${part.name}` }) : h('span', { class: 'muted' }, 'Verlauf baut sich auf'),
      h('button', { class: 'btn--link', type: 'button', 'aria-expanded': String(open), 'data-focus': `exp-${part.id}`, onclick: () => handlers.onExpand(part.id) },
        open ? 'weniger' : 'Details')),
    open ? detailsBox(line, ctx) : null);
  return row;
}

export function partsView(ctx) {
  const { model } = ctx;
  const seen = new Set();
  const items = model.lines.map((line) => {
    const first = !seen.has(line.category.id);
    seen.add(line.category.id);
    return partRow(line, first, ctx);
  });
  return [
    h('h2', { id: 'parts-h' }, 'Preisliste'),
    h('p', { class: 'sub' }, 'Günstigster lieferbarer Preis eines Händlers aus Deutschland, exklusive Versand. Teile mit Auswahlfeld lassen sich tauschen.'),
    h('ul', { class: 'bom' },
      h('li', { class: 'bom__head', 'aria-hidden': 'true' }, h('span'), h('span', null, 'Teil'), h('span', null, 'Auswahl'), h('span', null, 'Preis'), h('span', null, 'Verlauf')),
      items,
      h('li', { class: 'bom__total' },
        h('div', null, 'PC', h('span', null, eur(model.totals.pc))),
        h('div', null, 'Monitor', h('span', null, eur(model.totals.monitor))),
        h('div', null, 'Gesamt', h('span', null, eur(model.totals.all))))),
  ];
}

// ------------------------------------------------------------------ GPU-Auswahl
const slotText = (g) => `${num(g.thickness_mm)} mm (${num(g.slots)} Slots)`;

export function gpuView(ctx) {
  const { data, selection, model, handlers } = ctx;
  const picked = model.picks.gpu;
  const current = selection.gpu ?? 'auto';
  const options = sortedOptions(data, 'gpu');
  const card = (part) => {
    const cur = data.prices.parts[part.id]?.current;
    const g = part.specs;
    const incompatible = g.backside && !model.picks.board.specs.backside_connector;
    const checked = current === part.id;
    return h('button', { type: 'button', role: 'radio', 'aria-checked': String(checked), 'data-focus': `gpu-${part.id}`,
      class: `gpu${cur && isListable(cur) ? '' : ' gpu--off'}`, onclick: () => handlers.onSelect('gpu', part.id) },
      image(part, 'gpu__img'),
      h('div', { class: 'gpu__name' }, part.name),
      h('div', { class: 'gpu__price' }, cur ? eur(cur.price) : h('span', { class: 'muted' }, 'keine Angebote')),
      h('div', { class: 'gpu__tags' }, cur ? availabilityBadge(cur) : null, cur?.merchant ? h('span', { class: 'badge' }, cur.merchant) : null,
        incompatible ? h('span', { class: 'badge badge--bad' }, 'BTF – passt nicht zum Board') : null),
      h('ul', { class: 'gpu__facts' },
        h('li', null, 'Länge ', h('b', null, `${num(g.length_mm)} mm`)),
        h('li', null, 'Dicke ', h('b', null, slotText(g))),
        h('li', null, 'Anschluss ', h('b', null, g.power_connector)),
        h('li', null, 'Adapter ', h('b', null, g.backside ? '–' : `${g.adapter_8pin}× 8-Pin`))));
  };
  const autoCard = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === 'auto'), 'data-focus': 'gpu-auto', class: 'gpu gpu--auto',
    onclick: () => handlers.onSelect('gpu', 'auto') },
    h('div', { class: 'gpu__name' }, 'Automatisch günstigste lieferbare'),
    h('div', { class: 'muted' }, `aktuell: ${picked.name}`),
    h('div', { class: 'gpu__price' }, eur(data.prices.parts[picked.id]?.current?.price)));
  return [
    h('h2', { id: 'gpu-h' }, 'Grafikkarte – alle weißen RTX 5070 Ti'),
    h('p', { class: 'sub' }, 'Alle weißen Modelle bei Geizhals Deutschland. Die Karte beeinflusst Preis, Kompatibilität und Stromanschluss; Boden-Lüfter stören in diesem ATX-Gehäuse nicht.'),
    h('div', { class: 'gpus', role: 'radiogroup', 'aria-label': 'Grafikkarte' }, autoCard, options.map(card)),
  ];
}

// ------------------------------------------------------------------ Lüfter-Plan
export function fansView(ctx) {
  const { model, selection, handlers, data } = ctx;
  const { fans } = model;
  const arrow = (p) => (p.direction === 'intake' ? '↓ Intake' : '↑ Exhaust');
  const hub = model.picks.hub.specs;
  return [
    h('h2', { id: 'fans-h' }, `Lüfter-Plan – ${fans.total} × Asiahorse Matrix Pro White (120 mm)`),
    h('p', { class: 'sub' }, `${fans.intake} Intake + ${fans.exhaust} Exhaust: Seite und Boden blasen hinein (Reverse-Blade), Deckel und Heck blasen heraus (Standard-Blade).`),
    h('div', { class: 'fanplan' }, fans.positions.map((p) => h('div', { class: 'fanpos' },
      h('div', { class: 'fanpos__n' }, `${p.matrix || p.stock}×`),
      h('div', { class: 'row__name' }, p.label),
      h('div', { class: 'fanpos__dir' }, h('span', { class: 'fanpos__arrow', 'aria-hidden': 'true' }, p.direction === 'intake' ? '↓' : '↑'), `${arrow(p).slice(2)} · ${p.blade === 'reverse' ? 'Reverse' : 'Standard'}-Blade`),
      p.stock ? h('div', { class: 'badge badge--warn' }, 'Tryx-Serienlüfter') : null))),
    h('div', { class: 'fansum' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: selection.topFans === 'matrix' || null, 'data-focus': 'topfans',
        onchange: (e) => handlers.onTopFans(e.target.checked ? 'matrix' : 'tryx') }),
        'Auch auf dem AIO-Radiator Matrix Pro (statt der 3 mitgelieferten Tryx-Lüfter)'),
      h('span', { class: 'muted' }, `Hub: ${fans.total} von ${hub.pwm_ports} PWM-/ARGB-Ports am ${model.picks.hub.name.split(' (')[0]} belegt`),
      h('span', { class: 'muted' }, `Das Gehäuse hat keine Serienlüfter und zusätzlich ${data.catalog.parts[model.picks.case.id].specs.hubs.count} eingebaute Hubs.`)),
  ];
}

// ------------------------------------------------------------------ Kompatibilität
const STATUS = { ok: ['✓', 'Passt'], warn: ['!', 'Prüfen'], fail: ['✗', 'Passt nicht'] };

export function compatView(checks) {
  const sum = summarize(checks);
  return [
    h('h2', { id: 'compat-h' }, 'Kompatibilitäts-Check'),
    h('p', { class: 'sub' }, 'Berechnet aus den gewählten Teilen und den Herstellerdaten in data/parts.json.'),
    h('div', { class: 'checks__sum' },
      h('span', { class: 'badge badge--good' }, `✓ ${sum.ok} passt`),
      h('span', { class: 'badge badge--warn' }, `! ${sum.warn} prüfen`),
      h('span', { class: `badge${sum.fail ? ' badge--bad' : ''}` }, `✗ ${sum.fail} passt nicht`)),
    h('ul', { class: 'checks' }, checks.map((c) => h('li', { class: `check-row s-${c.status}` },
      h('span', { class: 'check-row__status' }, h('span', { class: 'check-row__icon', 'aria-hidden': 'true' }, STATUS[c.status][0]), STATUS[c.status][1]),
      h('div', null, h('h3', null, c.label), h('p', null, c.summary),
        c.details.length ? h('ul', null, c.details.map((d) => h('li', null, d))) : null,
        c.sources.length ? h('div', { class: 'linklist' }, c.sources.map((s) => (safe(s.url) ? link(s.name, s.url) : null))) : null)))),
  ];
}
