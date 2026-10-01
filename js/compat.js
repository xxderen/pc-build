// Kompatibilitäts-Check: jede Prüfung liefert status ('ok' | 'warn' | 'fail'), eine Zusammenfassung und Details.
// Alle Grenzwerte stammen aus data/parts.json – hier steht nur die Logik.

import { geizhalsUrl } from './data.js';

const src = (name, url) => (url ? { name, url } : null);
const partSource = (part, label) => src(label ?? part.name, geizhalsUrl(part) ?? part.url);

function result(id, label, status, summary, details = [], sources = []) {
  return { id, label, status, summary, details, sources: sources.filter(Boolean) };
}

/** ctx: { picks: {case, cpu, board, gpu, ram, aio, psu, hub}, covers: [part], fanPart, fans, topFans } */
export function runChecks(ctx) {
  const { picks, fans, topFans } = ctx;
  const { case: pc, cpu, board, gpu, ram, aio, psu, hub } = picks;
  const c = pc.specs, a = aio.specs, g = gpu.specs, p = psu.specs, b = board.specs, f = ctx.fanPart.specs;
  const checks = [];

  // 1. Radiator
  {
    const sizeOk = c.radiators.top.includes(a.radiator_mm);
    const fanMm = topFans === 'matrix' ? f.thickness_mm : a.stock_fan_thickness_mm;
    const height = a.radiator_thickness_mm + fanMm;
    const limit = c.top_radiator_max_mm;
    const tooThick = limit != null && height > limit;
    checks.push(result('radiator', 'Radiator', sizeOk && !tooThick ? 'ok' : 'fail',
      sizeOk ? `${a.radiator_mm}-mm-Radiator im Deckel unterstützt, Bauhöhe ${height} mm` : `Deckel unterstützt keinen ${a.radiator_mm}-mm-Radiator`,
      [
        `Deckel nimmt Radiatoren bis ${Math.max(...c.radiators.top)} mm (${c.radiators.top.join(' / ')}).`,
        `Bauhöhe: Radiator ${a.radiator_thickness_mm} mm + Lüfter ${fanMm} mm = ${height} mm`
          + (limit != null ? ` (Limit ${limit} mm).` : ' – be quiet! nennt für den Deckel keine maximale Dicke.'),
        `Radiatorlänge ${a.radiator_length_mm} mm, Schläuche 400 mm.`,
        topFans === 'matrix' ? 'Matrix Pro sitzen auf dem Radiator; die 3 mitgelieferten Tryx-Lüfter bleiben übrig.' : 'Die Tryx-Serienlüfter bleiben auf dem Radiator.',
        'Nur die Tryx-Revision G1W (25-mm-Lüfter) wird verwendet; die ältere G0W hat 28-mm-Lüfter.',
      ],
      [src('be quiet! Light Base 600 DX', pc.url), partSource(aio, 'Tryx Panorama (Geizhals)')]));
  }

  // 2. Lüfter
  {
    const overSlots = fans.total > c.max_fans;
    const overHub = fans.total > hub.specs.pwm_ports || fans.total > hub.specs.argb_ports;
    const status = overSlots || overHub ? 'fail' : 'ok';
    checks.push(result('fans', 'Lüfter', status,
      `${fans.total} Matrix Pro: ${fans.intake} Intake + ${fans.exhaust} Exhaust – ${overSlots ? 'mehr als das Gehäuse aufnimmt' : `${c.max_fans} Plätze im Gehäuse`}`,
      [
        ...fans.positions.map((q) => `${q.label}: ${q.count}× ${q.size} mm (${q.direction === 'intake' ? 'Intake' : 'Exhaust'}, ${q.blade === 'reverse' ? 'Reverse' : 'Standard'}-Blade)`
          + (q.stock ? ' – Tryx-Serienlüfter' : '')),
        `Anschlüsse am ${hub.name.split(' (')[0]}: ${fans.total} von ${hub.specs.pwm_ports} PWM- und ${hub.specs.argb_ports} ARGB-Ports belegt${fans.total === hub.specs.pwm_ports ? ' (voll)' : ''}.`,
        `${pc.name.split(' (')[0]} hat ${c.hubs.count} eingebaute Hubs (${c.hubs.connectors} Anschlüsse) und keine Serienlüfter.`,
        fans.intake > fans.exhaust ? 'Mehr Intake als Exhaust: leichter Überdruck, das hält Staub eher draußen.' : null,
      ].filter(Boolean),
      [src('be quiet! Datenblatt', pc.facts_sources?.[1]?.url), partSource(hub, 'Umbra (Geizhals)')]));
  }

  // 3. GPU-Länge
  {
    const reserve = c.gpu_max_mm - g.length_mm;
    checks.push(result('gpu_length', 'GPU-Länge', reserve >= 0 ? 'ok' : 'fail',
      `${g.length_mm} mm von max. ${c.gpu_max_mm} mm (${reserve >= 0 ? `${reserve} mm Reserve` : `${-reserve} mm zu lang`})`,
      [`${gpu.name}: ${g.length_mm} × ${g.thickness_mm} mm Dicke (${g.slots} Slots), das Gehäuse hat ${c.expansion_slots} Slots.`,
       'Bei diesem ATX-Layout liegen die Boden-Lüfter weit unter der Karte – die Dicke spielt dafür keine Rolle.'],
      [partSource(gpu, 'Grafikkarte (Geizhals)'), src('be quiet! Datenblatt', pc.facts_sources?.[1]?.url)]));
  }

  // 4. Netzteil
  {
    const reserve = c.psu_max_mm - p.length_mm;
    const wattOk = p.watt >= g.recommended_psu_w;
    checks.push(result('psu', 'Netzteil', reserve >= 0 && wattOk ? 'ok' : 'fail',
      `${p.length_mm} mm von max. ${c.psu_max_mm} mm, ${p.watt} W (Empfehlung ${g.recommended_psu_w} W)`,
      [c.psu_max_note, `${p.atx_version}, vollmodular, ${p.length_mm} mm tief.`],
      [partSource(psu, 'Netzteil (Geizhals)'), src('be quiet! Handbuch/Datenblatt', pc.url)]));
  }

  // 5. Mainboard & Sockel
  {
    const formOk = c.form_factors.includes(b.form_factor);
    const socketOk = b.socket === cpu.specs.socket && a.sockets.includes(b.socket);
    checks.push(result('board', 'Mainboard-Formfaktor', formOk && socketOk ? 'ok' : 'fail',
      `${b.form_factor}-Board im Gehäuse (${c.form_factors.join(' / ')}), Sockel ${b.socket}`,
      [`${board.name}: ${b.wifi}, ${b.m2_slots} × M.2, ${b.pcie}.`,
       `CPU ${cpu.specs.socket}, Board ${b.socket}, AIO unterstützt ${a.sockets.join(' / ')}.`,
       b.backside_connector ? null : 'Kein Rückseiten-Anschluss-Board – BTF-/Project-Zero-Grafikkarten passen nicht.'].filter(Boolean),
      [partSource(board, 'Mainboard (Geizhals)')]));
  }

  // 6. RAM / EXPO
  {
    const hasExpo = ram.specs.profiles.includes('EXPO') && b.ram_profiles.includes('EXPO');
    const hasXmp = ram.specs.profiles.includes('XMP') && b.ram_profiles.includes('XMP');
    checks.push(result('ram', 'RAM / EXPO', hasExpo ? 'ok' : hasXmp ? 'warn' : 'fail',
      hasExpo ? `EXPO-Profil vorhanden (${ram.specs.timings})` : 'Kein EXPO-Profil – nur Intel XMP',
      [hasExpo ? 'Das Board lädt das AMD-EXPO-Profil direkt im BIOS.'
        : 'Der Kit hat nur ein Intel-XMP-Profil. Auf AM5 lässt sich XMP im BIOS meist problemlos laden, offiziell vorgesehen ist aber EXPO (Variante …Z30W).',
       `Kit ${ram.specs.kit}, Modulhöhe ${ram.specs.height_mm} mm, ${ram.specs.part_no}.`],
      [partSource(ram, 'RAM (Geizhals)')]));
  }

  // 7. Stromstecker
  {
    const details = [];
    let status = 'ok';
    if (g.backside && !b.backside_connector) {
      status = 'fail';
      details.push(`${gpu.name} braucht ein Board mit Rückseiten-Anschluss (${g.power_connector}) – das ${board.name} hat keinen.`);
    } else if (g.power_connector === '12V-2x6' && p.native_12v2x6) {
      details.push('Grafikkarte: 12V-2x6 – das Netzteil liefert ein natives 12V-2x6-Kabel (600 W), der Adapter der Karte bleibt in der Schachtel.');
    } else if (g.adapter_8pin <= p.pcie_8pin) {
      details.push(`Grafikkarte: 12V-2x6 über Adapter (${g.adapter_8pin}× 8-Pin), Netzteil hat ${p.pcie_8pin}× 8-Pin.`);
    } else {
      status = 'fail';
      details.push(`Grafikkarte braucht ${g.adapter_8pin}× 8-Pin, das Netzteil hat nur ${p.pcie_8pin}.`);
    }
    const epsOk = b.eps_8pin <= p.eps_8pin;
    if (!epsOk) status = 'fail';
    details.push(`CPU: ${b.eps_8pin}× EPS 8-Pin (+ ${b.eps_4pin}× 4-Pin optional) – Netzteil hat ${p.eps_8pin}× EPS 4+4.`);
    const sata = a.needs.sata_power + hub.specs.needs.sata_power + c.hubs.sata_power;
    if (sata > p.sata) status = 'fail';
    details.push(`SATA-Strom: ${sata} von ${p.sata} (Tryx ${a.needs.sata_power}, Umbra ${hub.specs.needs.sata_power}, Gehäuse-Hubs ${c.hubs.sata_power}).`);
    checks.push(result('power', 'Stromstecker', status,
      status === 'ok' ? '12V-2x6 nativ, EPS und SATA reichen' : 'Stromanschlüsse passen nicht zusammen', details,
      [partSource(psu, 'Netzteil (Geizhals)'), partSource(gpu, 'Grafikkarte (Geizhals)')]));
  }

  // 8. Kabel-Covers
  {
    const cover3 = ctx.covers.find((x) => x.specs.fits === '3x8pin');
    const adapterFits = g.adapter_8pin === 3;
    checks.push(result('covers', 'Kabel-Covers', 'warn',
      cover3 ? 'Das 3×8-Pin-Cover passt nicht zum 12V-2x6-Kabel – Nutzen fraglich' : 'Passform auf Corsair-Kabeln unbestätigt',
      [
        'Aurora Learn sind Silikon-Lichtstreifen für 24-Pin- bzw. drei parallele 8-Pin-Kabel (5 V ARGB, 108 LEDs).',
        p.native_12v2x6
          ? 'Die RTX 5070 Ti nutzt ein einzelnes 12V-2x6-Kabel; das 3×8-Pin-Cover sitzt dort nicht. Es ergibt nur Sinn, wenn du die Karte über den Adapter mit drei 8-Pin-Kabeln betreibst.'
          : 'Das Netzteil hat kein natives 12V-2x6-Kabel.',
        adapterFits ? `Der Adapter dieser Karte hat ${g.adapter_8pin}× 8-Pin – das passt zum Cover.`
          : `Der Adapter dieser Karte hat nur ${g.adapter_8pin}× 8-Pin – ein Anschluss des 3er-Covers bliebe leer.`,
        'Corsair liefert eigene (geprägte, flache) Kabel; ob die Asiahorse-Cover darauf sauber sitzen, ist nicht bestätigt.',
        'Alternative: das Asiahorse „Kabelabdeckungskit für 12+4-Pin/8-Pin/24-Pin" (ab ca. 28 € bei Geizhals).',
      ],
      [src('Asiahorse Aurora Learn', ctx.covers[0]?.url)]));
  }

  // 9. Interne Anschlüsse
  {
    const usb = a.needs.usb2_header + hub.specs.needs.usb2_header;
    const argb = a.needs.argb + hub.specs.needs.argb_in + (ctx.covers.length ? 1 : 0);
    const status = usb > b.usb2_headers || argb > b.argb_headers ? 'fail' : 'ok';
    checks.push(result('headers', 'Interne Anschlüsse', status,
      `USB-2.0-Header ${usb}/${b.usb2_headers}, ARGB-Header ${argb}/${b.argb_headers}`,
      [`USB 2.0: Tryx-Display ${a.needs.usb2_header} + Umbra ${hub.specs.needs.usb2_header} = ${usb} von ${b.usb2_headers}${usb === b.usb2_headers ? ' (keine Reserve)' : ''}.`,
       `5-V-ARGB: Tryx ${a.needs.argb}, Umbra-Sync ${hub.specs.needs.argb_in}${ctx.covers.length ? ', beide Covers per Daisy-Chain 1' : ''} = ${argb} von ${b.argb_headers}.`,
       'Der LED-Sync des Gehäuse-Streifens mit dem Board wäre ein weiterer ARGB-Header (nur per Taster am Gehäuse steuerbar, wenn keiner frei ist).'],
      [partSource(board, 'Mainboard (Geizhals)')]));
  }

  return checks;
}

export function summarize(checks) {
  const count = (s) => checks.filter((x) => x.status === s).length;
  return { ok: count('ok'), warn: count('warn'), fail: count('fail') };
}
