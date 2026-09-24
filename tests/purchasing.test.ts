import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPurchasePlan, groupBySupplier, type PurchaseInputIngredient, supplierMessage, whatsappLink } from '../lib/purchasing/forecast.ts';
import { colombianHolidays, easterSunday } from '../lib/purchasing/holidays.ts';
import { nextRunAt } from '../lib/purchasing/schedule.ts';

test('festivos de Colombia 2026: Emiliani y Semana Santa', () => {
  assert.equal(easterSunday(2026).toISOString().slice(0, 10), '2026-04-05');
  const dates = Object.fromEntries(colombianHolidays(2026).map((h) => [h.name, h.date]));
  assert.equal(dates['Reyes Magos'], '2026-01-12'); // 6 ene es martes → lunes 12
  assert.equal(dates['Viernes Santo'], '2026-04-03');
  assert.equal(dates['Día de la Raza'], '2026-10-12'); // ya es lunes
  assert.equal(dates['Ascensión del Señor'], '2026-05-18');
  assert.equal(colombianHolidays(2026).length, 18);
});

/** Historial sintético: consumo diario por día de la semana durante `days` días hasta ayer. */
function ingredient(over: Partial<PurchaseInputIngredient>, perDow: Record<number, number>, today: string, days = 56): PurchaseInputIngredient {
  const daily: Record<string, number> = {};
  const t = new Date(`${today}T12:00:00Z`).getTime();
  let first: string | null = null;
  for (let i = days; i >= 1; i--) {
    const d = new Date(t - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const dow = ((d.getUTCDay() + 6) % 7) + 1;
    first ??= key;
    if (perDow[dow]) daily[key] = perDow[dow]!;
  }
  return {
    id: 'x', name: 'Ron', unit: 'ml', stock: 0, min_stock: 0, cost_per_unit: 0.08, pack_size: 750, pack_label: 'botella 750 ml',
    supplier_id: 's1', supplier_name: 'Licores del Valle', supplier_phone: '57 300 111 2233', lead_time_days: 1,
    sold: Object.values(daily).reduce((a, b) => a + b, 0), waste: 0, first_day: first, daily, ...over,
  };
}

test('pronóstico por día de la semana: un viernes pesa más que un martes', () => {
  // Hoy lunes 2026-09-21; entrega 1 día; cubrir 7 días → 8 días: lun..lun.
  const today = '2026-09-21';
  const ron = ingredient({ stock: 1000 }, { 1: 300, 2: 300, 3: 300, 4: 600, 5: 1500, 6: 1800, 7: 600 }, today);
  const plan = buildPurchasePlan({ today, history_days: 56, timezone: 'America/Bogota', ingredients: [ron] }, 7);
  const line = plan.lines[0]!;
  // lun+mar+mié+jue+vie+sáb+dom+lun = 300+300+300+600+1500+1800+600+300
  assert.equal(line.demand, 5700);
  assert.equal(line.confidence, 'alta');
  // Patrón semanal exacto → sin incertidumbre alrededor del patrón: no hay reserva extra.
  assert.equal(line.reserve, 0);
  // 5.700 − 1.000 en stock = 4.700 ml → 7 botellas (5.250 ml).
  assert.equal(line.packs, 7);
  // Pedido en botellas completas y cubriendo la necesidad.
  assert.equal(line.order_qty % 750, 0);
  assert.ok(line.order_qty >= line.need);
  assert.equal(line.est_cost, Math.round(line.order_qty * 0.08));
});

test('una semana irregular sí genera reserva de seguridad', () => {
  const today = '2026-09-21';
  const ron = ingredient({}, { 5: 1000, 6: 1000 }, today);
  // Un viernes excepcional (+2.000) hace que la demanda varíe alrededor del patrón.
  ron.daily['2026-09-18'] = 3000;
  const line = buildPurchasePlan({ today, history_days: 56, timezone: 'America/Bogota', ingredients: [ron] }, 7).lines[0]!;
  assert.ok(line.reserve > 0);
});

test('respeta stock mínimo, merma y no pide lo que sobra', () => {
  const today = '2026-09-21';
  const flat = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100 };
  const plan = buildPurchasePlan(
    {
      today,
      history_days: 56,
      timezone: 'America/Bogota',
      ingredients: [
        ingredient({ id: 'a', name: 'Limón', unit: 'unit', pack_size: null, pack_label: null, min_stock: 500, stock: 0 }, flat, today),
        ingredient({ id: 'b', name: 'Soda', stock: 999_999 }, flat, today),
        ingredient({ id: 'c', name: 'Hierbabuena', unit: 'g', pack_size: null, pack_label: null, stock: 0, waste: 280, sold: 5600 }, flat, today),
      ],
    },
    7,
  );
  const by = Object.fromEntries(plan.lines.map((l) => [l.name, l]));
  assert.equal(by.Soda, undefined, 'con stock de sobra no se sugiere');
  // Consumo plano (sd 0): la reserva es el stock mínimo. 8 días × 100 + 500.
  assert.equal(by['Limón']!.order_qty, 1300);
  // 5 % de merma sobre 800 → 840, redondeado a 100 g sin empaque.
  assert.equal(by.Hierbabuena!.demand, 840);
  assert.equal(by.Hierbabuena!.order_qty, 900);
  assert.ok(plan.notes.some((n) => n.includes('empaque')));
});

test('puente festivo: el domingo antes del lunes festivo se proyecta como sábado', () => {
  // Lunes 12 oct 2026 es festivo (Día de la Raza). Hoy jueves 8 oct, cubrir 3 días + 1 de entrega: jue..dom.
  const today = '2026-10-08';
  const ron = ingredient({}, { 4: 100, 5: 100, 6: 900, 7: 100 }, today);
  const plan = buildPurchasePlan({ today, history_days: 56, timezone: 'America/Bogota', ingredients: [ron] }, 3);
  // jue 100 + vie 100 + sáb 900 + dom-puente 900 (en vez de 100)
  assert.equal(plan.lines[0]!.demand, 2000);
  assert.ok(plan.notes[0]!.includes('Día de la Raza'));
});

test('mensaje por proveedor y enlace de WhatsApp sin IA', () => {
  const today = '2026-09-21';
  const plan = buildPurchasePlan(
    { today, history_days: 56, timezone: 'America/Bogota', ingredients: [ingredient({}, { 5: 1500, 6: 1500 }, today)] },
    7,
  );
  const [group] = groupBySupplier(plan.lines);
  const text = supplierMessage({ business: 'La Terraza', supplier: group!.supplier_name, lines: group!.lines });
  assert.match(text, /Hola, Licores del Valle\. Te escribo de La Terraza/);
  assert.match(text, /• \d+ × botella 750 ml de Ron/);
  assert.match(whatsappLink(group!.supplier_phone, text)!, /^https:\/\/wa\.me\/573001112233\?text=Hola/);
  assert.equal(whatsappLink('123', text), null);
});

test('próxima ejecución en hora local del negocio', () => {
  const tz = 'America/Bogota'; // UTC-5
  const after = new Date('2026-09-24T15:00:00Z'); // jueves 10:00 local
  assert.equal(nextRunAt({ frequency: 'daily', weekday: 1, day_of_month: 1, hour: 7 }, after, tz).toISOString(), '2026-09-25T12:00:00.000Z');
  assert.equal(nextRunAt({ frequency: 'daily', weekday: 1, day_of_month: 1, hour: 18 }, after, tz).toISOString(), '2026-09-24T23:00:00.000Z');
  // Semanal los lunes 7:00 → lunes 28.
  assert.equal(nextRunAt({ frequency: 'weekly', weekday: 1, day_of_month: 1, hour: 7 }, after, tz).toISOString(), '2026-09-28T12:00:00.000Z');
  // Quincenal: si corrió el lunes 21, el próximo es el lunes 5 de octubre.
  assert.equal(
    nextRunAt({ frequency: 'biweekly', weekday: 1, day_of_month: 1, hour: 7, last_run_at: '2026-09-21T12:00:00Z' }, after, tz).toISOString(),
    '2026-10-05T12:00:00.000Z',
  );
  // Mensual el día 1 → 1 de octubre.
  assert.equal(nextRunAt({ frequency: 'monthly', weekday: 1, day_of_month: 1, hour: 6 }, after, tz).toISOString(), '2026-10-01T11:00:00.000Z');
});
