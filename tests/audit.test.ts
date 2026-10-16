/**
 * Auditoría (migración 027): lo que queda registrado, quién lo puede leer y que nadie pueda
 * editarlo ni borrarlo. PostgreSQL embebido (PGlite).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;
const ADMIN = '22222222-0000-0000-0000-000000000001';
const SUP = '22222222-0000-0000-0000-000000000002';
const WAITER = '22222222-0000-0000-0000-000000000003';
const CASHIER = '22222222-0000-0000-0000-000000000004';
const OTHER_ADMIN = '22222222-0000-0000-0000-000000000009';

const db = new PGlite();
const ids: Record<string, string> = {};
type Row = { action: string; severity: string; category: string; actor_name: string | null; actor_role: string | null; details: Record<string, any>; entity_id: string | null };

async function as<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const one = async <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) => (await as<T>(uid, sql, params))[0]!;
const root = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  return (await db.query<T>(sql, params)).rows;
};
const log = (action?: string) =>
  root<Row>(`select action, severity, category, actor_name, actor_role, details, entity_id from audit_log ${action ? `where action = '${action}'` : ''} order by at, id`);
const lastOf = async (action: string) => (await log(action)).at(-1)!;
const countOf = async (action: string) => (await log(action)).length;

before(async () => {
  await db.exec(STUBS);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${ADMIN}'), ('${SUP}'), ('${WAITER}'), ('${CASHIER}'), ('${OTHER_ADMIN}')`);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
  ids.tenant = (await db.query<{ id: string }>(`select public.create_tenant('Bar Audit', 'bar-audit', 'Dueña Ana') as id`)).rows[0]!.id;
  await db.exec(`select set_config('request.jwt.claim.sub', '${OTHER_ADMIN}', false)`);
  ids.other = (await db.query<{ id: string }>(`select public.create_tenant('Otro Bar', 'otro-bar', 'Beto') as id`)).rows[0]!.id;
  await db.exec(`insert into public.profiles (id, tenant_id, role, full_name, permissions) values
    ('${SUP}', '${ids.tenant}', 'supervisor', 'Sara Supervisora', '{orders.take,inventory.receive,inventory.count,inventory.waste}'),
    ('${WAITER}', '${ids.tenant}', 'waiter', 'Walter Mesero', '{}'),
    ('${CASHIER}', '${ids.tenant}', 'cashier', 'Cami Caja', '{}')`);

  ids.zone = (await one<{ id: string }>(ADMIN, `insert into zones (name) values ('Salón') returning id`)).id;
  for (const n of [1, 2, 3, 4]) ids[`t${n}`] = (await one<{ id: string }>(ADMIN, `insert into tables (zone_id, label) values ($1, $2) returning id`, [ids.zone, `Mesa ${n}`])).id;
  ids.cat = (await one<{ id: string }>(ADMIN, `insert into categories (name, station) values ('Bar', 'bar') returning id`)).id;
  ids.ron = (await one<{ id: string }>(ADMIN, `insert into ingredients (name, unit, stock_quantity, cost_per_unit) values ('Ron', 'ml', 5000, 100) returning id`)).id;
  ids.mojito = (await one<{ id: string }>(ADMIN, `insert into products (category_id, name, price) values ($1, 'Mojito', 25000) returning id`, [ids.cat])).id;
  await as(ADMIN, `insert into recipes (product_id, ingredient_id, quantity) values ($1, $2, 60)`, [ids.mojito, ids.ron]);
});

const submit = (uid: string, table: string, qty = 1) =>
  one<{ r: { order_id: string; round: number; total: number; order_number: number } }>(uid, `select public.submit_order($1, $2::jsonb) as r`, [
    table,
    JSON.stringify([{ product_id: ids.mojito, quantity: qty }]),
  ]).then((x) => x.r);

describe('auditoría: ventas', () => {
  test('cada ronda queda registrada con quién la tomó, y el rol de supervisor se ve como tal', async () => {
    const r1 = await submit(WAITER, ids.t1!, 2);
    const opened = await lastOf('order.opened');
    assert.equal(opened.actor_name, 'Walter Mesero');
    assert.equal(opened.actor_role, 'waiter');
    assert.equal(opened.details.table, 'Mesa 1');
    const round = await lastOf('order.round_sent');
    assert.equal(round.details.round, 1);
    assert.deepEqual(round.details.items.map((i: any) => [i.name, i.qty]), [['Mojito', 2]]);
    await submit(WAITER, ids.t1!, 1); // segunda ronda de la misma cuenta
    assert.equal(await countOf('order.round_sent'), 2);
    assert.equal((await lastOf('order.round_sent')).details.round, 2);
    assert.equal(await countOf('order.opened'), 1);
    await submit(SUP, ids.t2!);
    const sup = await lastOf('order.round_sent');
    assert.equal(sup.actor_name, 'Sara Supervisora');
    assert.equal(sup.actor_role, 'supervisor');
    ids.order1 = r1.order_id;
  });

  test('quitar un producto enviado, cortesías y descuentos: quién, qué y por qué', async () => {
    const [item] = await as<{ id: string }>(ADMIN, `select id from order_items where order_id = $1 order by created_at limit 1`, [ids.order1]);
    await as(ADMIN, `update order_items set comped = true, comp_reason = 'Cumpleaños' where id = $1`, [item!.id]);
    const comp = await lastOf('item.comped');
    assert.deepEqual([comp.severity, comp.details.reason, comp.actor_name], ['important', 'Cumpleaños', 'Dueña Ana']);
    await as(ADMIN, `update order_items set comped = false where id = $1`, [item!.id]);
    assert.equal(await countOf('item.comp_removed'), 1);

    await as(ADMIN, `update orders set discount_type = 'percent', discount_value = 10, discount_reason = 'Cliente frecuente' where id = $1`, [ids.order1]);
    const disc = await lastOf('order.discount_applied');
    assert.deepEqual([disc.severity, disc.details.type, Number(disc.details.value), disc.details.reason], ['important', 'percent', 10, 'Cliente frecuente']);

    const [extra] = await as<{ id: string }>(ADMIN, `select id from order_items where order_id = $1 order by created_at desc limit 1`, [ids.order1]);
    await as(ADMIN, `select public.cancel_order_items($1::uuid[], 'Se equivocó el pedido')`, [[extra!.id]]);
    const removed = await lastOf('item.removed');
    assert.deepEqual([removed.severity, removed.details.reason, removed.details.product, removed.actor_name], ['critical', 'Se equivocó el pedido', 'Mojito', 'Dueña Ana']);
  });

  test('anular una cuenta completa deja una entrada crítica, no una por producto', async () => {
    const o = await submit(WAITER, ids.t3!, 3);
    const before = await countOf('item.removed');
    await as(ADMIN, `select public.cancel_order($1, 'Los clientes se fueron')`, [o.order_id]);
    const cancelled = await lastOf('order.cancelled');
    assert.deepEqual([cancelled.severity, cancelled.details.reason, Number(cancelled.details.total)], ['critical', 'Los clientes se fueron', 75000]);
    assert.equal(await countOf('item.removed'), before);
  });

  test('pagos: cobro, anulación y quién cambió de mesa una cuenta', async () => {
    await as(ADMIN, `select public.transfer_order($1, $2)`, [ids.order1, ids.t4]);
    const moved = await lastOf('order.table_moved');
    assert.deepEqual([moved.details.from, moved.details.to], ['Mesa 1', 'Mesa 4']);

    const total = Number((await one<{ t: string }>(ADMIN, `select total as t from orders where id = $1`, [ids.order1])).t);
    const pay = await one<{ r: { remaining: number } }>(CASHIER, `select public.register_payments($1, 'full', $2::jsonb) as r`, [ids.order1, JSON.stringify([{ amount: total, method: 'cash' }])]);
    assert.equal(pay.r.remaining, 0);
    const registered = await lastOf('payment.registered');
    assert.deepEqual([registered.details.method, Number(registered.details.amount), registered.actor_name, registered.severity], ['cash', total, 'Cami Caja', 'info']);

    const [p] = await as<{ id: string }>(ADMIN, `select id from payments where order_id = $1`, [ids.order1]);
    await as(ADMIN, `select public.void_payment($1, 'Cobro duplicado')`, [p!.id]);
    const voided = await lastOf('payment.voided');
    assert.deepEqual([voided.severity, voided.details.reason], ['critical', 'Cobro duplicado']);
  });
});

describe('auditoría: caja, inventario, menú, personas y ajustes', () => {
  test('caja: la apertura es normal; los movimientos importan; una diferencia al cerrar es crítica', async () => {
    await as(ADMIN, `select public.open_cash_session(100000)`);
    assert.equal((await lastOf('cash.opened')).severity, 'info');
    await as(ADMIN, `select public.add_cash_movement('out', 20000, 'Compra de hielo')`);
    const mov = await lastOf('cash.movement');
    assert.deepEqual([mov.severity, mov.details.type, Number(mov.details.amount), mov.details.reason], ['important', 'out', 20000, 'Compra de hielo']);
    await as(ADMIN, `select public.close_cash_session(1000, 'No cuadra')`);
    const closed = await lastOf('cash.closed');
    assert.equal(closed.severity, 'critical');
    assert.notEqual(Number(closed.details.difference), 0);
  });

  test('inventario: compras normales, mermas y ajustes importantes, los grandes críticos; el costo a mano también', async () => {
    const mov = (uid: string, type: string, qty: number, reason: string, cost = 100) =>
      one(uid, `select public.record_inventory_movement($1, $2::movement_type, $3, $4, $5) as r`, [ids.ron, type, qty, reason, cost]);
    await mov(SUP, 'purchase', 1000, 'Pedido semanal');
    const purchase = await lastOf('inventory.purchase');
    assert.deepEqual([purchase.severity, purchase.actor_role, purchase.details.ingredient], ['info', 'supervisor', 'Ron']);
    await mov(SUP, 'waste', 100, 'Se derramó'); // 100 × $100 = $10.000
    assert.equal((await lastOf('inventory.waste')).severity, 'important');
    await mov(ADMIN, 'adjustment', -2000, 'Conteo físico'); // 2.000 × $100 = $200.000
    const adj = await lastOf('inventory.adjustment');
    assert.deepEqual([adj.severity, Number(adj.details.value), Number(adj.details.quantity)], ['critical', 200000, -2000]);

    // Comprar actualiza el costo promedio solo: eso NO se registra como cambio manual…
    const before = await countOf('ingredient.cost_changed');
    await mov(ADMIN, 'purchase', 500, 'Compra', 150);
    assert.equal(await countOf('ingredient.cost_changed'), before);
    // …pero cambiarlo a mano sí.
    await as(ADMIN, `update ingredients set cost_per_unit = 5 where id = $1`, [ids.ron]);
    const cost = await lastOf('ingredient.cost_changed');
    assert.deepEqual([cost.severity, Number(cost.details.to)], ['important', 5]);
  });

  test('menú: precio, recetas (una sola entrada por guardado) y productos', async () => {
    await as(ADMIN, `update products set price = 28000 where id = $1`, [ids.mojito]);
    const price = await lastOf('product.price_changed');
    assert.deepEqual([price.severity, Number(price.details.from), Number(price.details.to)], ['important', 25000, 28000]);

    const sugar = (await one<{ id: string }>(ADMIN, `insert into ingredients (name, unit) values ('Azúcar', 'g') returning id`)).id;
    const lime = (await one<{ id: string }>(ADMIN, `insert into ingredients (name, unit) values ('Limón', 'unit') returning id`)).id;
    const before = await countOf('recipe.changed');
    await as(ADMIN, `insert into recipes (product_id, ingredient_id, quantity) values ($1, $2, 10), ($1, $3, 2)`, [ids.mojito, sugar, lime]);
    assert.equal(await countOf('recipe.changed'), before + 1);
    assert.equal((await lastOf('recipe.changed')).details.product, 'Mojito');

    await as(ADMIN, `update products set is_active = false where id = $1`, [ids.mojito]);
    assert.equal(await countOf('product.deactivated'), 1);
    await as(ADMIN, `update products set is_active = true where id = $1`, [ids.mojito]);
  });

  test('personas y permisos: el cambio de rol o de permisos es crítico', async () => {
    await as(ADMIN, `update profiles set permissions = '{inventory.view}' where id = $1`, [SUP]);
    const perms = await lastOf('staff.permissions_changed');
    assert.equal(perms.severity, 'critical');
    assert.deepEqual(perms.details.to, ['inventory.view']);
    await as(ADMIN, `update profiles set is_active = false where id = $1`, [CASHIER]);
    assert.equal((await lastOf('staff.deactivated')).details.name, 'Cami Caja');
    await as(ADMIN, `update profiles set is_active = true, role = 'waiter' where id = $1`, [CASHIER]);
    const role = await lastOf('staff.role_changed');
    assert.deepEqual([role.severity, role.details.from, role.details.to], ['critical', 'cashier', 'waiter']);
  });

  test('ajustes del negocio: se ve qué cambió, de qué a qué; el contador de comandas no cuenta', async () => {
    await as(ADMIN, `update tenants set tax_rate = 0, uses_kitchen_screen = false`);
    const s = await lastOf('settings.changed');
    assert.deepEqual(s.details.changes.tax_rate, { from: 8, to: 0 });
    assert.deepEqual(s.details.changes.uses_kitchen_screen, { from: true, to: false });
    const before = await countOf('settings.changed');
    await root(`update ingredients set stock_quantity = 9999`); // el ejemplo gastó el ron
    await submit(WAITER, ids.t3!, 1); // sube order_seq, no es un ajuste
    assert.equal(await countOf('settings.changed'), before);
    await as(ADMIN, `update tenants set tax_rate = 8, uses_kitchen_screen = true`);
  });

  test('lo hecho sin una persona (cargas masivas, tareas programadas) queda como «el sistema»', async () => {
    await root(`update products set price = 28500 where id = $1`, [ids.mojito]);
    const sys = await lastOf('product.price_changed');
    assert.deepEqual([sys.actor_name, sys.actor_role], [null, null]);
  });
});

describe('auditoría: quién lee y nadie la altera', () => {
  test('sólo el administrador de ese negocio la lee', async () => {
    const total = Number((await root<{ c: string }>(`select count(*) as c from audit_log where tenant_id = $1`, [ids.tenant]))[0]!.c);
    assert.ok(total > 20);
    const mine = Number((await one<{ c: string }>(ADMIN, `select count(*) as c from audit_log`)).c);
    assert.equal(mine, total);
    for (const uid of [SUP, WAITER, CASHIER, OTHER_ADMIN]) {
      assert.equal(Number((await one<{ c: string }>(uid, `select count(*) as c from audit_log`)).c), uid === OTHER_ADMIN ? 0 : 0, uid);
    }
    // El otro negocio, que no hizo nada, no tiene entradas ni ve las de este.
    assert.equal(Number((await root<{ c: string }>(`select count(*) as c from audit_log where tenant_id = $1`, [ids.other]))[0]!.c), 0);
  });

  test('el resumen por persona sólo lo pide el administrador', async () => {
    const sum = await one<{ s: { by_severity: Record<string, number>; by_actor: Array<{ name: string; action: string; n: number }> } }>(
      ADMIN,
      `select public.get_audit_summary(now() - interval '1 day', now() + interval '1 day') as s`,
    );
    assert.ok(sum.s.by_severity.critical! >= 5);
    assert.ok(sum.s.by_actor.some((a) => a.name === 'Dueña Ana' && a.action === 'item.removed'));
    for (const uid of [SUP, WAITER, CASHIER]) {
      await assert.rejects(as(uid, `select public.get_audit_summary(now() - interval '1 day', now())`), /forbidden/);
    }
  });

  test('nadie escribe, edita ni borra: ni el administrador, ni el rol de servicio, ni vaciando la tabla', async () => {
    const entry = (await root<{ id: string }>(`select id from audit_log limit 1`))[0]!.id;
    await assert.rejects(as(ADMIN, `insert into audit_log (tenant_id, action, category, severity) values ($1, 'x.y', 'ventas', 'info')`, [ids.tenant]), /permission denied/);
    await assert.rejects(as(ADMIN, `update audit_log set severity = 'info'`), /permission denied/);
    await assert.rejects(as(ADMIN, `delete from audit_log`), /permission denied/);
    await assert.rejects(as(ADMIN, `truncate audit_log`), /permission denied/);
    // Rol de servicio (el servidor): puede agregar eventos propios, pero no cambiarlos ni borrarlos.
    await db.exec(`reset role; set role service_role`);
    await db.query(`insert into audit_log (tenant_id, action, category, severity, details) values ($1, 'staff.created', 'personal', 'important', '{}')`, [ids.tenant]);
    await assert.rejects(db.query(`update audit_log set severity = 'info' where id = $1`, [entry]), /permission denied/);
    await assert.rejects(db.query(`delete from audit_log where id = $1`, [entry]), /permission denied/);
    await db.exec(`reset role`);
    // Ni siquiera con permisos totales de base de datos.
    await assert.rejects(root(`update audit_log set severity = 'info' where id = $1`, [entry]), /audit_log_immutable/);
    await assert.rejects(root(`delete from audit_log where id = $1`, [entry]), /audit_log_immutable/);
    await assert.rejects(root(`truncate audit_log`), /audit_log_immutable/);
  });

  test('los valores no válidos se rechazan, y eliminar un gastrobar completo sí limpia su auditoría', async () => {
    await assert.rejects(root(`insert into audit_log (tenant_id, action, category, severity) values ($1, 'x.y', 'otra', 'info')`, [ids.tenant]), /audit_log_category_check/);
    await assert.rejects(root(`insert into audit_log (tenant_id, action, category, severity) values ($1, 'x.y', 'ventas', 'grave')`, [ids.tenant]), /audit_log_severity_check/);
    await root(`insert into audit_log (tenant_id, action, category, severity) values ($1, 'x.y', 'ventas', 'info')`, [ids.other]);
    await root(`delete from tenants where id = $1`, [ids.other]);
    assert.equal(Number((await root<{ c: string }>(`select count(*) as c from audit_log where tenant_id = $1`, [ids.other]))[0]!.c), 0);
  });
});
