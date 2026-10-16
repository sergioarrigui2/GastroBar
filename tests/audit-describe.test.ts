import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { actorLabel, describeAudit, summarizeByActor } from '../lib/audit/describe.ts';

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const say = (action: string, details: Record<string, unknown>) => describeAudit({ action, details }, money, { permissionLabels: { 'inventory.view': 'Ver el inventario', 'orders.take': 'Tomar pedidos' } });

describe('auditoría: frases', () => {
  test('lo más delicado dice quién, qué, cuánto y por qué', () => {
    assert.equal(
      say('order.cancelled', { order_number: 12, table: 'Mesa 4', total: 85000, paid: 0, reason: 'Se fueron' }),
      'Anuló la cuenta #12 (Mesa 4) por $85.000 — «Se fueron»',
    );
    assert.equal(
      say('item.removed', { order_number: 12, table: 'Mesa 4', product: 'Cerveza Corona', quantity: 2, amount: 16000, status_before: 'delivered', reason: 'No la pidieron' }),
      'Quitó 2× Cerveza Corona ($16.000) de la cuenta #12 (Mesa 4); estaba entregada — «No la pidieron»',
    );
    assert.equal(say('payment.voided', { order_number: 9, amount: 50000, method: 'cash', reason: 'Cobro duplicado' }), 'Anuló un pago de $50.000 en efectivo de la cuenta #9 — «Cobro duplicado»');
    assert.equal(say('order.discount_applied', { order_number: 3, type: 'percent', value: 10, discount_total: 8000, subtotal: 80000, reason: 'Cliente frecuente' }), 'Dio un descuento de 10 % a la cuenta #3 ($8.000 sobre $80.000) — «Cliente frecuente»');
    assert.equal(say('order.cancelled', { order_number: 1, total: 1000, paid: 500 }), 'Anuló la cuenta #1 por $1.000 (tenía $500 cobrados)');
  });

  test('caja: cuadra, sobra o falta', () => {
    assert.equal(say('cash.closed', { counted_cash: 119800, expected_cash: 119800, difference: 0 }), 'Cerró la caja: contó $119.800 y cuadró');
    assert.match(say('cash.closed', { counted_cash: 100000, expected_cash: 107000, difference: -7000, notes: 'Faltan 500' }), /faltan \$7\.000 — «Faltan 500»/);
    assert.match(say('cash.closed', { counted_cash: 110000, expected_cash: 107000, difference: 3000 }), /sobran \$3\.000/);
    assert.equal(say('cash.movement', { type: 'out', amount: 20000, reason: 'transporte' }), 'Sacó $20.000 de la caja — «transporte»');
  });

  test('inventario, menú, personas y ajustes', () => {
    assert.equal(say('inventory.adjustment', { ingredient: 'Ron', unit: 'ml', quantity: -2000, value: 200000, stock_after: 3500, reason: 'Conteo físico' }), 'Ajustó Ron: -2.000 ml ($200.000); quedó en 3.500 ml — «Conteo físico»');
    assert.equal(say('inventory.waste', { ingredient: 'Limón', unit: 'unit', quantity: -5, value: 440, reason: 'Se dañaron' }), 'Registró una merma de 5 u de Limón ($440) — «Se dañaron»');
    assert.equal(say('product.price_changed', { name: 'Mojito', from: 25000, to: 28000 }), 'Cambió el precio de Mojito: $25.000 → $28.000');
    assert.equal(say('staff.permissions_changed', { name: 'Sara', to: ['inventory.view', 'orders.take'] }), 'Cambió los permisos de Sara: Ver el inventario, Tomar pedidos');
    assert.equal(say('staff.permissions_changed', { name: 'Sara', to: [] }), 'Cambió los permisos de Sara: ninguno');
    assert.equal(say('staff.role_changed', { name: 'Cami', from: 'cashier', to: 'waiter' }), 'Cambió el rol de Cami: Caja → Mesero');
    assert.equal(
      say('settings.changed', { changes: { tax_rate: { from: 8, to: 0 }, uses_kitchen_screen: { from: true, to: false } } }),
      'Cambió los ajustes del negocio — tarifa del impuesto: 8 → 0; pantalla de cocina: sí → no',
    );
  });

  test('las rondas enumeran lo pedido; una acción desconocida no rompe nada', () => {
    assert.equal(say('order.round_sent', { order_number: 5, round: 2, table: 'Mesa 1', items: [{ name: 'Mojito', qty: 2 }, { name: 'Soda', qty: 1 }] }), 'Envió la ronda 2 de la cuenta #5 (Mesa 1): 2× Mojito, 1× Soda');
    assert.equal(say('algo.nuevo', {}), 'algo.nuevo');
    assert.equal(say('order.opened', {}), 'Abrió la cuenta #');
  });

  test('quién lo hizo, y el sistema cuando no fue una persona', () => {
    assert.deepEqual(actorLabel({ actor_name: 'Sara', actor_role: 'supervisor' }), { name: 'Sara', role: 'Supervisor' });
    assert.deepEqual(actorLabel({ actor_name: null, actor_role: null }), { name: 'El sistema', role: null });
  });

  test('el resumen por persona suma sólo lo sensible y ordena por quien más acumula', () => {
    const rows = [
      { actor_id: 'a', name: 'Ana', role: 'admin', action: 'item.removed', n: 3 },
      { actor_id: 'a', name: 'Ana', role: 'admin', action: 'order.cancelled', n: 2 },
      { actor_id: 'b', name: 'Beto', role: 'cashier', action: 'order.discount_applied', n: 1 },
      { actor_id: 'b', name: 'Beto', role: 'cashier', action: 'item.comped', n: 6 },
      { actor_id: 'c', name: 'Cami', role: 'waiter', action: 'staff.deactivated', n: 4 }, // no es de las columnas: no aparece
    ];
    const t = summarizeByActor(rows);
    assert.deepEqual(t.map((x) => x.name), ['Beto', 'Ana']);
    assert.equal(t[0]!.counts.discounts, 7);
    assert.equal(t[1]!.counts.voids, 5);
    assert.equal(t[1]!.role, 'Administrador');
  });
});
