// Zusammenstellung des Builds: Auswahl auflösen, Lüfterplan berechnen, Summen bilden. Reine Funktionen (ohne DOM).

import { currentOf } from './data.js';

const LISTABLE = new Set(['in_stock', 'shortly', 'unknown']);
export const isListable = (current) => !!current && LISTABLE.has(current.availability);

export const DEFAULT_SELECTION = { gpu: null, ssd: null, ram: null, paste: null, monitor: null, topFans: 'matrix' };

const optionsOf = (catalog, categoryId) => Object.values(catalog.parts).filter((p) => p.category === categoryId);

/** Günstigste lieferbare Option; Karten, die nicht zum Board passen (BTF), werden bei „auto" übersprungen. */
function cheapest(data, options, board) {
  const usable = options.filter((p) => !(p.specs?.backside && !board?.specs?.backside_connector));
  const priced = usable.map((p) => ({ p, cur: currentOf(data, p) })).filter((x) => x.cur?.price != null);
  const pool = priced.filter((x) => isListable(x.cur));
  const list = (pool.length ? pool : priced).sort((a, b) => a.cur.price - b.cur.price);
  return list[0]?.p ?? usable[0] ?? null;
}

export function resolvePick(data, category, selected) {
  const { catalog } = data;
  if (selected && selected !== 'auto' && catalog.parts[selected]?.category === category.id) return catalog.parts[selected];
  if (category.default && category.default !== 'auto') return catalog.parts[category.default];
  return cheapest(data, optionsOf(catalog, category.id), catalog.parts[catalog.categories.find((c) => c.id === 'board').default]);
}

/** Lüfterplan des Gehäuses; `topFans` = 'matrix' (Matrix Pro auf dem Radiator) oder 'tryx' (Serienlüfter bleiben). */
export function fanPlan(caseSpecs, topFans) {
  const positions = caseSpecs.fan_plan.map((p) => {
    const stock = p.radiator && topFans === 'tryx';
    return { ...p, matrix: stock ? 0 : p.count, stock: stock ? p.count : 0 };
  });
  const sum = (test) => positions.filter(test).reduce((n, p) => n + p.matrix, 0);
  return {
    positions,
    intake: sum((p) => p.direction === 'intake'),
    exhaust: sum((p) => p.direction === 'exhaust'),
    total: sum(() => true),
    reverse: sum((p) => p.blade === 'reverse'),
    forward: sum((p) => p.blade === 'forward'),
  };
}

export function build(data, selection) {
  const { catalog } = data;
  const picks = {};
  for (const category of catalog.categories) {
    if (category.kind === 'choice') picks[category.id] = resolvePick(data, category, selection[category.id]);
  }
  const fans = fanPlan(picks.case.specs, selection.topFans);
  const lines = [];
  const add = (category, part, qty) => {
    if (!part || qty <= 0) return;
    const current = currentOf(data, part);
    lines.push({ category, part, qty, current, unit: current?.price ?? null, sum: current?.price != null ? current.price * qty : null });
  };
  for (const category of catalog.categories) {
    if (category.kind === 'choice') add(category, picks[category.id], 1);
    else if (category.kind === 'fixed') category.parts.forEach((item) => add(category, catalog.parts[item.id], item.qty));
    else if (category.kind === 'fans') {
      add(category, catalog.parts[category.parts[0]], fans.reverse);
      add(category, catalog.parts[category.parts[1]], fans.forward);
    }
  }
  const total = (filter) => lines.filter(filter).reduce((n, l) => n + (l.sum ?? 0), 0);
  return {
    picks,
    fans,
    lines,
    totals: { pc: total((l) => !l.category.separate), monitor: total((l) => l.category.separate), all: total(() => true) },
    missing: lines.filter((l) => l.sum == null).map((l) => l.part.name),
  };
}

/** Schweregrad des Budgets: innerhalb (accent), bis 10 % darüber (warn), mehr (bad). */
export function budgetState(total, budget) {
  if (total <= budget) return 'ok';
  return total <= budget * 1.1 ? 'warn' : 'bad';
}
