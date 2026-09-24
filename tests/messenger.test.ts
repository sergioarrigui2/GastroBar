import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, AGENT_ORDER } from '../lib/ai/agents.ts';
import { buildDigest } from '../lib/messenger/digest.ts';

const money = (n: number) => `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)}`;
const base = {
  business: 'La Terraza <Bar>',
  appUrl: 'https://gastrobar.app',
  periodLabel: 'Últimos 7 días',
  money,
  revenue: { current: 12_500_000, previous: 11_000_000, change_pct: 13.6 },
  orders: { current: 180, previous: 170, change_pct: 5.9 },
  avgTicket: { current: 69_444, previous: 64_706, change_pct: 7.3 },
  foodCostPct: 27.4,
  detected: { total: 294_000, label: 'esta semana' },
  reportHeadline: 'Buena semana: sube el ticket',
  purchase: { lines: 4, urgent: 2, total: 812_000 },
};

test('resumen con puntos a revisar: asunto, texto para WhatsApp y HTML escapado', () => {
  const d = buildDigest({
    ...base,
    items: [{ title: 'Faltante en caja', action: 'Revisa el cierre del sábado', severity: 'critical', source: 'reglas' }],
  });
  assert.equal(d.subject, 'La Terraza <Bar>: $ 12.500.000 en ventas y 1 punto para revisar');
  assert.match(d.text, /• Ventas: \$ 12\.500\.000 \+13\.6% vs\. semana anterior/);
  assert.match(d.text, /1\. Faltante en caja \(Vigía\): Revisa el cierre del sábado/);
  assert.match(d.text, /\*Comprador:\* pedido listo con 4 insumo\(s\), 2 urgente\(s\)/);
  assert.match(d.text, /Ver más: https:\/\/gastrobar\.app\/admin\/ai/);
  assert.ok(d.html.includes('La Terraza &lt;Bar&gt;'), 'el nombre del negocio se escapa en el HTML');
  assert.ok(!d.html.includes('<Bar>'));
});

test('semana tranquila: sin puntos ni pedido', () => {
  const d = buildDigest({ ...base, items: [], purchase: null, reportHeadline: null, detected: null });
  assert.equal(d.subject, 'La Terraza <Bar>: $ 12.500.000 en ventas esta semana');
  assert.match(d.text, /no ven nada fuera de lo normal/);
  assert.ok(!d.text.includes('Comprador'));
});

test('cada agente tiene presentación completa', () => {
  for (const id of AGENT_ORDER) {
    const a = AGENTS[id];
    assert.ok(a.intro.startsWith('Soy el'), `${id}: se presenta en primera persona`);
    assert.ok(a.does.length >= 3 && a.value.length >= 3 && a.how.length >= 2, `${id}: qué hace, valor y cómo`);
    assert.ok(a.where.length >= 1, `${id}: dónde aparece`);
  }
});
