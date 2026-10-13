import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeDays, monthlySales, rangeVsLastYear } from '../lib/analytics/sales-history.ts';

describe('historial de ventas', () => {
  const history = [
    { day: '2025-10-01', orders: 50, revenue: 1_000_000 },
    { day: '2025-10-02', orders: 40, revenue: 800_000 },
    { day: '2026-10-01', orders: 60, revenue: 1_500_000 },
    { day: '2026-10-05', orders: 30, revenue: 900_000 },
  ];

  test('un día cuenta de una sola fuente: el historial manda hasta su último día', () => {
    const live = [
      { day: '2026-10-05', orders: 99, revenue: 9_999_999 }, // solapado con el historial: se ignora
      { day: '2026-10-06', orders: 10, revenue: 300_000 },
      { day: '2026-10-07', orders: 0, revenue: 0 }, // días sin venta no cuentan
    ];
    const days = mergeDays(history, live);
    assert.deepEqual(days.map((d) => [d.day, d.source]), [
      ['2025-10-01', 'history'],
      ['2025-10-02', 'history'],
      ['2026-10-01', 'history'],
      ['2026-10-05', 'history'],
      ['2026-10-06', 'live'],
    ]);
    assert.equal(days.find((d) => d.day === '2026-10-05')!.revenue, 900_000);
  });

  test('agrupa por mes, marca el mes en curso y compara con el mismo mes del año anterior', () => {
    const months = monthlySales(mergeDays(history, [{ day: '2026-10-06', orders: 10, revenue: 300_000 }]), '2026-10-13');
    assert.equal(months.length, 2);
    const oct26 = months.find((m) => m.month === '2026-10')!;
    assert.equal(oct26.revenue, 2_700_000);
    assert.equal(oct26.orders, 100);
    assert.equal(oct26.source, 'mixed');
    assert.equal(oct26.partial, true);
    assert.deepEqual(oct26.previous_year, { revenue: 1_800_000, orders: 90 });
    assert.equal(oct26.change_pct, 50);
    assert.equal(months.find((m) => m.month === '2025-10')!.change_pct, null);
    // Mes en curso al día 1: sólo cuenta el 1 de octubre del año pasado.
    const early = monthlySales(mergeDays(history, []), '2026-10-01').find((m) => m.month === '2026-10')!;
    assert.deepEqual(early.previous_year, { revenue: 1_000_000, orders: 50 });
  });

  test('rango contra los mismos días del año anterior', () => {
    const r = rangeVsLastYear(history, '2026-10-01', '2026-10-02');
    assert.deepEqual(r.current, { orders: 60, revenue: 1_500_000 });
    assert.deepEqual(r.previous, { orders: 90, revenue: 1_800_000 });
    assert.equal(r.change_pct, -16.7);
  });
});
