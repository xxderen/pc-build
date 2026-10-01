// Tests der Seitenlogik (Auswahl, Lüfterplan, Summen, Kompatibilität) ohne Browser: node --test tests/js/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { runChecks } from '../../js/compat.js';
import { DEFAULT_SELECTION, budgetState, build, fanPlan, isListable } from '../../js/model.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const load = () => ({ catalog: read('data/parts.json'), prices: read('data/prices.json'), targets: read('config/targets.json'), fps: read('data/fps.json'), status: null });
const sel = (over = {}) => ({ ...DEFAULT_SELECTION, ...over });

function checksFor(data, selection) {
  const model = build(data, selection);
  const { catalog } = data;
  const covers = catalog.categories.find((c) => c.id === 'cover').parts.map((p) => catalog.parts[p.id]);
  const fanPart = catalog.parts[catalog.categories.find((c) => c.id === 'fan').parts[0]];
  const list = runChecks({ picks: model.picks, covers, fanPart, fans: model.fans, topFans: selection.topFans });
  return { model, byId: Object.fromEntries(list.map((c) => [c.id, c])) };
}

test('Standard: gewählter RAM (C30W), Gehäuse und Board stehen fest', () => {
  const { picks } = build(load(), sel());
  assert.equal(picks.case.id, 'case-lb600dx-white');
  assert.equal(picks.board.id, 'board-b850-aorus-elite-wifi7-ice');
  assert.equal(picks.ram.id, 'ram-vengeance-rgb-white-c30w');
  assert.equal(picks.monitor.id, 'mon-msi-mag-272qp-qd-oled-x24');
});

test('„Automatisch“ wählt die günstigste lieferbare GPU/SSD (BTF-Karten ausgenommen)', () => {
  const data = load();
  const { picks } = build(data, sel());
  const cheapest = (category, skip = () => false) => Object.values(data.catalog.parts)
    .filter((p) => p.category === category && !skip(p))
    .map((p) => [p, data.prices.parts[p.id]?.current])
    .filter(([, cur]) => cur && isListable(cur))
    .sort((a, b) => a[1].price - b[1].price)[0][0];
  assert.equal(picks.gpu.id, cheapest('gpu', (p) => p.specs.backside).id);
  assert.equal(picks.ssd.id, cheapest('ssd').id);
  assert.equal(build(data, sel({ gpu: 'gpu-asus-tuf-5070ti-oc-white' })).picks.gpu.id, 'gpu-asus-tuf-5070ti-oc-white');
});

test('Lüfterplan: 6 Intake + 4 Exhaust = 10 Matrix Pro, Reverse für Intake', () => {
  const data = load();
  const plan = fanPlan(data.catalog.parts['case-lb600dx-white'].specs, 'matrix');
  assert.deepEqual([plan.intake, plan.exhaust, plan.total, plan.reverse, plan.forward], [6, 4, 10, 6, 4]);
  const tryx = fanPlan(data.catalog.parts['case-lb600dx-white'].specs, 'tryx');
  assert.deepEqual([tryx.total, tryx.reverse, tryx.forward], [7, 6, 1]);
});

test('Summen: Lüfterzeilen folgen dem Plan, Monitor wird separat geführt', () => {
  const data = load();
  const { lines, totals } = build(data, sel());
  const qty = (id) => lines.find((l) => l.part.id === id)?.qty;
  assert.equal(qty('fan-matrix-pro-120-white-reverse'), 6);
  assert.equal(qty('fan-matrix-pro-120-white-forward'), 4);
  assert.equal(qty('cover-aurora-learn-24pin-white'), 1);
  const sum = (filter) => lines.filter(filter).reduce((n, l) => n + l.sum, 0);
  assert.ok(Math.abs(totals.pc - sum((l) => !l.category.separate)) < 0.005);
  assert.ok(Math.abs(totals.all - (totals.pc + totals.monitor)) < 0.005);
  assert.equal(build(data, sel({ paste: 'paste-none' })).lines.find((l) => l.category.id === 'paste').sum, 0);
});

test('Budget-Stufen: innerhalb, bis 10 % darüber, darüber hinaus', () => {
  assert.deepEqual([budgetState(2900, 3000), budgetState(3000, 3000), budgetState(3300, 3000), budgetState(3301, 3000)], ['ok', 'ok', 'warn', 'bad']);
});

test('Kompatibilität (Standard): nichts fällt durch, RAM und Covers werden angemerkt', () => {
  const { byId } = checksFor(load(), sel());
  assert.equal(Object.values(byId).filter((c) => c.status === 'fail').length, 0);
  assert.equal(byId.ram.status, 'warn'); // C30W hat nur XMP
  assert.equal(byId.covers.status, 'warn');
  for (const id of ['radiator', 'fans', 'gpu_length', 'psu', 'board', 'power', 'headers']) assert.equal(byId[id].status, 'ok', id);
});

test('Kompatibilität: EXPO-Kit besteht den RAM-Check', () => {
  assert.equal(checksFor(load(), sel({ ram: 'ram-vengeance-rgb-white-z30w' })).byId.ram.status, 'ok');
});

test('Kompatibilität: BTF-Karte passt nicht zum Board (Stromstecker)', () => {
  const { byId } = checksFor(load(), sel({ gpu: 'gpu-asus-tuf-5070ti-btf-oc-white' }));
  assert.equal(byId.power.status, 'fail');
});

test('Kompatibilität: Grenzwerte werden tatsächlich geprüft', () => {
  const data = load();
  data.catalog.parts['psu-rm1000e-white'].specs.length_mm = 190; // länger als 180 mm
  assert.equal(checksFor(data, sel()).byId.psu.status, 'fail');

  const radiator = load();
  radiator.catalog.parts['case-lb600dx-white'].specs.radiators.top = [120, 240]; // kein 360er mehr
  assert.equal(checksFor(radiator, sel()).byId.radiator.status, 'fail');

  const thick = load();
  thick.catalog.parts['case-lb600dx-white'].specs.top_radiator_max_mm = 55; // 30 + 26 = 56 mm
  assert.equal(checksFor(thick, sel()).byId.radiator.status, 'fail');
  assert.equal(checksFor(thick, sel({ topFans: 'tryx' })).byId.radiator.status, 'ok'); // 30 + 25 = 55 mm

  const hub = load();
  hub.catalog.parts['hub-asiahorse-umbra'].specs.pwm_ports = 8; // 10 Lüfter > 8 Ports
  assert.equal(checksFor(hub, sel()).byId.fans.status, 'fail');
});
