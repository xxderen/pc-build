// Einstieg: Daten laden, Auswahl verwalten (im Browser gemerkt) und alle Bereiche neu zeichnen.

import { runChecks } from './compat.js';
import { loadAll } from './data.js';
import { ago, dateTime, h, mount } from './format.js';
import { renderFps } from './fps.js';
import { DEFAULT_SELECTION, build } from './model.js';
import { compatView, fansView, gpuView, heroView, partsView } from './views.js';

const STORAGE_KEY = 'pc-build-v1';
const $ = (id) => document.getElementById(id);

let data;
let selection = { ...DEFAULT_SELECTION };
let view = 'pc';
const expanded = new Set();

// ---------- Auswahl merken (nur ein Komfort: ohne Speicher läuft alles weiter) ----------
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const parts = data.catalog.parts;
    for (const key of Object.keys(DEFAULT_SELECTION)) {
      const value = saved.selection?.[key];
      if (key === 'topFans' ? ['matrix', 'tryx'].includes(value) : value === 'auto' || parts[value]?.category === key) selection[key] = value;
    }
    if (['pc', 'pcmon'].includes(saved.view)) view = saved.view;
  } catch { /* gespeicherte Auswahl unlesbar – Standard bleibt */ }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ selection, view })); } catch { /* Speicher gesperrt */ }
}

const handlers = {
  onSelect(category, value) { selection[category] = value; persist(); render(); },
  onView(next) { view = next; persist(); render(); },
  onTopFans(value) { selection.topFans = value; persist(); render(); },
  onExpand(id) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); },
};

// ---------- Prüfstatus (Kopfzeile und Hinweisbalken) ----------
function health() {
  const status = data.status;
  const interval = status?.interval_minutes ?? 30;
  const lastRun = status?.generated_at ?? data.prices.updated_at;
  const ageMin = lastRun ? (Date.now() - Date.parse(lastRun)) / 60000 : Infinity;
  const blocked = Object.entries(status?.sources ?? {}).filter(([, s]) => s.blocked_until && Date.parse(s.blocked_until) > Date.now());
  const level = ageMin > interval * 6 ? 'bad' : ageMin > interval * 2.5 || blocked.length ? 'warn' : 'ok';
  return { status, interval, lastRun, ageMin, blocked, level };
}

function renderStatus() {
  const { status, lastRun, level } = health();
  const text = !lastRun ? 'Noch keine Preise' : status
    ? `Preise geprüft ${ago(lastRun)} (${dateTime(lastRun)})`
    : `Preisstand ${ago(lastRun)} (${dateTime(lastRun)})`;
  mount($('status'), h('span', { class: `dot${level === 'ok' ? '' : ` dot--${level}`}`, 'aria-hidden': 'true' }), h('span', null, text));

  const { blocked, ageMin, interval } = health();
  const notes = [];
  if (blocked.length) notes.push(`Preisquelle ${blocked.map(([name, s]) => `${name} (${s.last_error ?? 'blockiert'})`).join(', ')} pausiert – betroffene Preise können veraltet sein.`);
  if (ageMin > interval * 2.5 && Number.isFinite(ageMin)) notes.push(`Die letzte Prüfung liegt ${ago(lastRun)} zurück (Intervall: ${interval} Min.).`);
  if (status?.summary?.failed > 0) notes.push(`${status.summary.failed} Teile konnten im letzten Lauf nicht geprüft werden.`);
  mount($('banner'), notes.length ? h('div', { class: 'banner', role: 'status' }, h('strong', null, 'Hinweis: '), notes.join(' ')) : '');
}

// ---------- Zeichnen ----------
function render() {
  const { catalog } = data;
  const model = build(data, selection);
  const ctx = { data, selection, model, view, expanded, handlers };

  const cover = catalog.categories.find((c) => c.id === 'cover').parts.map((p) => catalog.parts[p.id]);
  const fanPart = catalog.parts[catalog.categories.find((c) => c.id === 'fan').parts[0]];
  const checks = runChecks({ picks: model.picks, covers: cover, fanPart, fans: model.fans, topFans: selection.topFans });

  mount($('hero'), heroView({ model, view, budget: data.targets.budget_eur ?? 3000, handlers }));
  mount($('parts'), ...partsView(ctx));
  mount($('gpu'), ...gpuView(ctx));
  mount($('fans'), ...fansView(ctx));
  mount($('compat'), ...compatView(checks));
  const monitor = model.picks.monitor;
  renderFps($('fps'), data.fps, monitor.specs.refresh_hz, monitor.name);
  renderStatus();
}

async function init() {
  try {
    data = await loadAll();
  } catch (error) {
    mount($('app'), h('p', { class: 'notice', role: 'alert' }, `Daten konnten nicht geladen werden (${error.message}). Läuft die Seite über einen Webserver, z. B. „python -m http.server“?`));
    return;
  }
  restore();
  render();
  setInterval(renderStatus, 60000); // „vor 12 Min.“ aktuell halten
}

init();
