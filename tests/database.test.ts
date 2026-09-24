/**
 * Pruebas de integración del esquema SQL sobre PostgreSQL embebido (PGlite):
 * aislamiento RLS entre tenants, precios del servidor, stock por receta,
 * permisos por estación, pagos divididos y liberación de mesas.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

const ADMIN_A = '11111111-1111-1111-1111-111111111111';
const ADMIN_B = '22222222-2222-2222-2222-222222222222';
const WAITER_A = '33333333-3333-3333-3333-333333333333';
const BAR_A = '44444444-4444-4444-4444-444444444444';

const db = new PGlite();

async function as<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const one = async <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) =>
  (await as<T>(uid, sql, params))[0]!;

const ids = {} as Record<string, string>;

before(async () => {
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${ADMIN_A}'), ('${ADMIN_B}'), ('${WAITER_A}'), ('${BAR_A}')`);

  ids.tenantA = (await one<{ id: string }>(ADMIN_A, `select public.create_tenant('Bar A', 'bar-a', 'Ana') as id`)).id;
  await one(ADMIN_B, `select public.create_tenant('Bar B', 'bar-b', 'Beto') as id`);
  await db.exec(`insert into public.profiles (id, tenant_id, role, full_name) values
    ('${WAITER_A}', '${ids.tenantA}', 'waiter', 'Walter'), ('${BAR_A}', '${ids.tenantA}', 'bar', 'Kevin')`);

  ids.zone = (await one<{ id: string }>(ADMIN_A, `insert into zones (name) values ('Terraza') returning id`)).id;
  ids.t1 = (await one<{ id: string }>(ADMIN_A, `insert into tables (zone_id, label) values ($1, 'T1') returning id`, [ids.zone])).id;
  ids.bar = (await one<{ id: string }>(ADMIN_A, `insert into categories (name, station) values ('Cócteles', 'bar') returning id`)).id;
  ids.kitchen = (await one<{ id: string }>(ADMIN_A, `insert into categories (name, station) values ('Platos', 'kitchen') returning id`)).id;
  ids.ron = (await one<{ id: string }>(ADMIN_A, `insert into ingredients (name, unit, stock_quantity, cost_per_unit) values ('Ron', 'ml', 1000, 0.08) returning id`)).id;
  ids.azucar = (await one<{ id: string }>(ADMIN_A, `insert into ingredients (name, unit, stock_quantity, cost_per_unit) values ('Azúcar', 'g', 1000, 0.004) returning id`)).id;
  ids.carne = (await one<{ id: string }>(ADMIN_A, `insert into ingredients (name, unit, stock_quantity, cost_per_unit) values ('Carne', 'g', 600, 0.05) returning id`)).id;
  ids.jarabe = (await one<{ id: string }>(ADMIN_A, `insert into sub_recipes (name, yield_quantity, yield_unit) values ('Jarabe', 1000, 'ml') returning id`)).id;
  await as(ADMIN_A, `insert into sub_recipe_ingredients (sub_recipe_id, ingredient_id, quantity) values ($1, $2, 500)`, [ids.jarabe, ids.azucar]);
  ids.mojito = (await one<{ id: string }>(ADMIN_A, `insert into products (category_id, name, price) values ($1, 'Mojito', 25000) returning id`, [ids.bar])).id;
  ids.burger = (await one<{ id: string }>(ADMIN_A, `insert into products (category_id, name, price) values ($1, 'Hamburguesa', 32000) returning id`, [ids.kitchen])).id;
  await as(ADMIN_A, `insert into recipes (product_id, ingredient_id, quantity) values ($1, $2, 60), ($3, $4, 200)`, [ids.mojito, ids.ron, ids.burger, ids.carne]);
  await as(ADMIN_A, `insert into recipes (product_id, sub_recipe_id, quantity) values ($1, $2, 20)`, [ids.mojito, ids.jarabe]);
  ids.doble = (await one<{ id: string }>(ADMIN_A, `insert into modifiers (product_id, name, price_delta) values ($1, 'Doble ron', 8000) returning id`, [ids.mojito])).id;
});

const stock = async (name: string) =>
  Number((await one<{ s: string }>(ADMIN_A, `select stock_quantity as s from ingredients where name = $1`, [name])).s);

const submit = (uid: string, items: unknown[], tableId: string | null = ids.t1!) =>
  one<{ r: { order_id: string; round: number; total: number } }>(uid, `select public.submit_order($1, $2::jsonb) as r`, [
    tableId,
    JSON.stringify(items),
  ]).then((row) => row.r);

describe('schema', () => {
  test('crea la orden con precios del servidor, descuenta stock por receta y ocupa la mesa', async () => {
    const order = await submit(WAITER_A, [
      { product_id: ids.mojito, quantity: 2, modifier_ids: [ids.doble] },
      { product_id: ids.burger, quantity: 1 },
    ]);
    assert.equal(order.total, 2 * (25000 + 8000) + 32000);
    assert.equal(await stock('Ron'), 1000 - 120);
    assert.equal(await stock('Azúcar'), 1000 - 20); // 2 × 20 ml de jarabe × 500 g / 1000 ml
    assert.equal(await stock('Carne'), 400);
    const table = await one<{ status: string }>(WAITER_A, `select status from tables where id = $1`, [ids.t1]);
    assert.equal(table.status, 'occupied');

    const round2 = await submit(WAITER_A, [{ product_id: ids.mojito, quantity: 1 }]);
    assert.equal(round2.order_id, order.order_id);
    assert.equal(round2.round, 2);
  });

  test('el cliente no puede alterar precios ni forzar el estado de la orden', async () => {
    const rows = await as<{ unit_price: string }>(WAITER_A, `update order_items set unit_price = 1 returning unit_price`);
    assert.ok(rows.every((r) => Number(r.unit_price) === 25000 || Number(r.unit_price) === 32000));
    await assert.rejects(as(WAITER_A, `update orders set status = 'paid'`), /order_status_is_derived/);
  });

  test('bloquea ventas sin stock y modificadores ajenos al producto', async () => {
    await assert.rejects(submit(WAITER_A, [{ product_id: ids.burger, quantity: 5 }]), /insufficient_stock/);
    await assert.rejects(submit(WAITER_A, [{ product_id: ids.burger, modifier_ids: [ids.doble] }]), /invalid_modifier/);
  });

  test('barra sólo actualiza ítems de su estación y no puede cancelar', async () => {
    const updatedKitchen = await as(BAR_A, `update order_items set status = 'ready' where station = 'kitchen' returning id`);
    assert.equal(updatedKitchen.length, 0);
    const updatedBar = await as(BAR_A, `update order_items set status = 'ready' where station = 'bar' returning id`);
    assert.equal(updatedBar.length, 2);
    await assert.rejects(as(BAR_A, `update order_items set status = 'cancelled' where station = 'bar'`), /forbidden_transition/);
  });

  test('aislamiento total entre tenants', async () => {
    for (const table of ['orders', 'order_items', 'ingredients', 'tables', 'product_availability']) {
      const [row] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from ${table}`);
      assert.equal(row!.c, 0, `tenant B ve filas de ${table}`);
    }
    await assert.rejects(as(ADMIN_B, `insert into zones (tenant_id, name) values ($1, 'Hack')`, [ids.tenantA]), /row-level security/);
    await assert.rejects(submit(ADMIN_B, [{ product_id: ids.mojito }]), /table_not_found/);
    await assert.rejects(as(WAITER_A, `select private.apply_recipe_stock($1, null, $2, 1, 1)`, [ids.tenantA, ids.mojito]), /permission denied/);
  });

  test('cancelar un ítem devuelve el stock', async () => {
    await as(WAITER_A, `update order_items set status = 'cancelled' where product_id = $1`, [ids.burger]);
    assert.equal(await stock('Carne'), 600);
  });

  test('pagos divididos: por ítem, sobrepago bloqueado y cierre con mesa liberada', async () => {
    const order = await one<{ id: string; total: string }>(WAITER_A, `select id, total from orders`);
    const [first] = await as<{ id: string; line_total: string }>(
      WAITER_A,
      `select id, line_total from order_items where status <> 'cancelled' order by created_at limit 1`,
    );
    const line = Number(first!.line_total);
    const pay1 = await one<{ r: { remaining: number; status: string } }>(
      WAITER_A,
      `select public.register_payments($1, 'by_item', $2::jsonb) as r`,
      [order.id, JSON.stringify([{ amount: line, method: 'card', allocations: [{ order_item_id: first!.id, amount: line }] }])],
    );
    assert.equal(pay1.r.remaining, Number(order.total) - line);

    await assert.rejects(
      as(WAITER_A, `select public.register_payments($1, 'custom', $2::jsonb)`, [order.id, JSON.stringify([{ amount: 10_000_000, method: 'cash' }])]),
      /overpayment/,
    );
    await assert.rejects(
      as(WAITER_A, `select public.register_payments($1, 'by_item', $2::jsonb)`, [
        order.id,
        JSON.stringify([{ amount: 1000, method: 'cash', allocations: [{ order_item_id: first!.id, amount: 1000 }] }]),
      ]),
      /item_overallocated/,
    );

    const half = pay1.r.remaining / 2;
    const pay2 = await one<{ r: { remaining: number; status: string } }>(
      WAITER_A,
      `select public.register_payments($1, 'equal', $2::jsonb) as r`,
      [order.id, JSON.stringify([{ amount: half, method: 'cash' }, { amount: half, method: 'transfer', tip: 2000 }])],
    );
    assert.equal(pay2.r.status, 'paid');
    assert.equal(pay2.r.remaining, 0);
    const table = await one<{ status: string }>(WAITER_A, `select status from tables where id = $1`, [ids.t1]);
    assert.equal(table.status, 'free');
  });

  test('catálogo: save_product guarda producto + receta de forma atómica y sólo para admin', async () => {
    const recipe = JSON.stringify([
      { ingredient_id: ids.ron, quantity: 45 },
      { sub_recipe_id: ids.jarabe, quantity: 15 },
    ]);
    const { id } = await one<{ id: string }>(
      ADMIN_A,
      `select public.save_product(null, $1, 'Daiquiri', 'Clásico', 27000, true, true, 5, $2::jsonb) as id`,
      [ids.bar, recipe],
    );
    const lines = await as(ADMIN_A, `select * from recipes where product_id = $1`, [id]);
    assert.equal(lines.length, 2);

    // Actualizar reemplaza la receta completa; una línea inválida revierte todo.
    await assert.rejects(
      as(ADMIN_A, `select public.save_product($1, $2, 'Daiquiri', null, 28000, true, true, 5, $3::jsonb)`, [
        id,
        ids.bar,
        JSON.stringify([{ ingredient_id: ids.ron, quantity: 0 }]),
      ]),
    );
    const after = await one<{ price: string; n: number }>(
      ADMIN_A,
      `select p.price, (select count(*)::int from recipes r where r.product_id = p.id) as n from products p where p.id = $1`,
      [id],
    );
    assert.equal(Number(after.price), 27000);
    assert.equal(after.n, 2);

    await assert.rejects(
      as(WAITER_A, `select public.save_product(null, $1, 'Hack', null, 1, true, true, 0, null)`, [ids.bar]),
      /forbidden/,
    );
    // Otro tenant no puede usar una categoría ajena (FK compuesta).
    await assert.rejects(as(ADMIN_B, `select public.save_product(null, $1, 'X', null, 1, true, true, 0, null)`, [ids.bar]));
  });

  test('catálogo: save_sub_recipe reemplaza sus insumos', async () => {
    const { id } = await one<{ id: string }>(
      ADMIN_A,
      `select public.save_sub_recipe($1, 'Jarabe', 500, 'ml', 'Mitad', $2::jsonb) as id`,
      [ids.jarabe, JSON.stringify([{ ingredient_id: ids.azucar, quantity: 300 }])],
    );
    assert.equal(id, ids.jarabe);
    const rows = await as<{ quantity: string }>(ADMIN_A, `select quantity from sub_recipe_ingredients where sub_recipe_id = $1`, [id]);
    assert.deepEqual(rows.map((r) => Number(r.quantity)), [300]);
  });

  test('caja: apertura única, movimientos, efectivo esperado y cierre con diferencia', async () => {
    await assert.rejects(as(WAITER_A, `select public.open_cash_session(100000)`), /forbidden/);
    const opened = await one<{ id: string }>(ADMIN_A, `select (public.open_cash_session(100000)).id as id`);
    assert.ok(opened.id);
    await assert.rejects(as(ADMIN_A, `select public.open_cash_session(0)`), /cash_session_already_open/);

    // Venta en efectivo dentro de la sesión.
    const order = await submit(WAITER_A, [{ product_id: ids.mojito, quantity: 1 }]);
    await as(WAITER_A, `select public.register_payments($1, 'full', $2::jsonb)`, [
      order.order_id,
      JSON.stringify([{ amount: 25000, tip: 2500, method: 'cash' }]),
    ]);
    await as(ADMIN_A, `select public.add_cash_movement('out', 20000, 'Compra de hielo')`);

    const live = await one<{ s: { report: { expected_cash: number; cash_sales: number } } }>(ADMIN_A, `select public.get_cash_session() as s`);
    assert.equal(live.s.report.cash_sales, 25000);
    assert.equal(live.s.report.expected_cash, 100000 + 25000 + 2500 - 20000);

    const closed = await one<{ s: { difference: number; expected_cash: number } }>(
      ADMIN_A,
      `select public.close_cash_session(107000, 'Faltan 500') as s`,
    );
    assert.equal(closed.s.expected_cash, 107500);
    assert.equal(closed.s.difference, -500);
    const [none] = await as<{ s: unknown }>(ADMIN_A, `select public.get_cash_session() as s`);
    assert.equal(none!.s, null);
    const [otherTenant] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from cash_sessions`);
    assert.equal(otherTenant!.c, 0);
  });

  test('claves API sólo para usuarios ai_agent del mismo tenant; menú público sin sesión', async () => {
    await assert.rejects(
      as(ADMIN_A, `insert into api_keys (profile_id, name, key_prefix, key_hash) values ($1, 'x', 'gbk_x', 'h1')`, [WAITER_A]),
      /api_key_requires_ai_agent/,
    );
    await db.exec(`update public.profiles set role = 'ai_agent' where id = '${WAITER_A}'`);
    await as(ADMIN_A, `insert into api_keys (profile_id, name, key_prefix, key_hash) values ($1, 'Bot', 'gbk_x', 'h2')`, [WAITER_A]);
    const [visibleToB] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from api_keys`);
    assert.equal(visibleToB!.c, 0);
    await db.exec(`update public.profiles set role = 'waiter' where id = '${WAITER_A}'`);

    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`);
    try {
      const menu = (await db.query<{ m: { products: Array<{ name: string }> } | null }>(`select public.get_public_menu('bar-a') as m`)).rows[0]!.m;
      assert.ok(menu!.products.some((p) => p.name === 'Mojito'));
      const missing = (await db.query<{ m: unknown }>(`select public.get_public_menu('no-existe') as m`)).rows[0]!.m;
      assert.equal(missing, null);
      const leaked = await db.query(`select * from products`);
      assert.equal(leaked.rows.length, 0, 'anon no debe ver productos directamente');
    } finally {
      await db.exec('reset role');
    }
  });

  test('impuestos: INC incluido por defecto, IVA adicional por producto y exentos', async () => {
    ids.t2 = (await one<{ id: string }>(ADMIN_A, `insert into tables (zone_id, label) values ($1, 'T2') returning id`, [ids.zone])).id;
    // Producto con IVA 19% en un tenant que cobra precios SIN impuesto incluido.
    await db.exec(`update public.tenants set prices_include_tax = false where id = '${ids.tenantA}'`);
    const { id: soda } = await one<{ id: string }>(
      ADMIN_A,
      `select public.save_product(null, $1, 'Soda', null, 10000, true, false, 9, null, 19) as id`,
      [ids.bar],
    );
    const excl = await submit(WAITER_A, [{ product_id: soda, quantity: 2 }], ids.t2!);
    assert.equal(excl.total, 23800); // 20.000 + 19%
    const [line] = await as<{ tax_amount: string; tax_rate: string }>(WAITER_A, `select tax_amount, tax_rate from order_items where order_id = $1`, [excl.order_id]);
    assert.equal(Number(line!.tax_amount), 3800);
    assert.equal(Number(line!.tax_rate), 19);
    await as(ADMIN_A, `update orders set status = 'cancelled' where id = $1`, [excl.order_id]);
    await db.exec(`update public.tenants set prices_include_tax = true where id = '${ids.tenantA}'`);

    // INC 8% incluido (tarifa del tenant): el total no cambia, el impuesto se desglosa.
    const incl = await submit(WAITER_A, [{ product_id: ids.mojito, quantity: 1 }], ids.t2!);
    assert.equal(incl.total, 25000);
    const order = await one<{ tax_total: string }>(WAITER_A, `select tax_total from orders where id = $1`, [incl.order_id]);
    assert.equal(Number(order.tax_total), 1851.85); // 25.000 − 25.000 / 1,08
    ids.taxOrder = incl.order_id;
  });

  test('cortesías y descuentos: sólo admin/caja, con motivo, recalculan total e impuesto', async () => {
    await submit(WAITER_A, [{ product_id: ids.mojito, quantity: 1 }], ids.t2!);
    const [item] = await as<{ id: string }>(WAITER_A, `select id from order_items where order_id = $1 and round = 2`, [ids.taxOrder]);

    await assert.rejects(as(WAITER_A, `update order_items set comped = true, comp_reason = 'x' where id = $1`, [item!.id]), /forbidden/);
    await assert.rejects(as(ADMIN_A, `update order_items set comped = true where id = $1`, [item!.id]), /comp_reason_required/);
    await as(ADMIN_A, `update order_items set comped = true, comp_reason = 'Cumpleaños' where id = $1`, [item!.id]);
    type Totals = { subtotal: string; total: string; discount_total: string; tax_total: string };
    const totals = () => one<Totals>(ADMIN_A, `select subtotal, total, discount_total, tax_total from orders where id = $1`, [ids.taxOrder]);
    let order = await totals();
    assert.equal(Number(order.subtotal), 25000); // la cortesía vale 0

    await assert.rejects(as(WAITER_A, `update orders set discount_type = 'percent', discount_value = 10, discount_reason = 'x' where id = $1`, [ids.taxOrder]), /forbidden/);
    await assert.rejects(as(ADMIN_A, `update orders set discount_type = 'percent', discount_value = 10 where id = $1`, [ids.taxOrder]), /discount_reason_required/);
    await as(ADMIN_A, `update orders set discount_type = 'percent', discount_value = 10, discount_reason = 'Cliente frecuente' where id = $1`, [ids.taxOrder]);
    order = await totals();
    assert.equal(Number(order.total), 22500);
    assert.equal(Number(order.discount_total), 2500);
    assert.equal(Number(order.tax_total), 1666.67); // impuesto prorrateado por el descuento
  });

  test('anular pago: sólo admin, reabre la cuenta y la mesa; bloqueado en caja cerrada', async () => {
    const paid = await one<{ r: { status: string } }>(WAITER_A, `select public.register_payments($1, 'full', $2::jsonb) as r`, [
      ids.taxOrder,
      JSON.stringify([{ amount: 22500, method: 'card' }]),
    ]);
    assert.equal(paid.r.status, 'paid');
    const [pay] = await as<{ id: string }>(ADMIN_A, `select id from payments where order_id = $1`, [ids.taxOrder]);

    await assert.rejects(as(WAITER_A, `select public.void_payment($1, 'error')`, [pay!.id]), /forbidden/);
    await assert.rejects(as(ADMIN_A, `select public.void_payment($1, ' ')`, [pay!.id]), /void_reason_required/);
    const voided = await one<{ r: { status: string; remaining: number } }>(ADMIN_A, `select public.void_payment($1, 'Cobro duplicado') as r`, [pay!.id]);
    assert.notEqual(voided.r.status, 'paid');
    assert.equal(voided.r.remaining, 22500);
    const table = await one<{ status: string }>(ADMIN_A, `select status from tables where id = $1`, [ids.t2]);
    assert.equal(table.status, 'occupied');
    await assert.rejects(as(ADMIN_A, `select public.void_payment($1, 'otra vez')`, [pay!.id]), /payment_already_voided/);

    // Un pago que pertenece a una caja ya cerrada (prueba de caja) no se puede anular.
    const [closedPay] = await as<{ id: string }>(ADMIN_A, `select id from payments where tip = 2500 and voided_at is null`);
    await assert.rejects(as(ADMIN_A, `select public.void_payment($1, 'tarde')`, [closedPay!.id]), /payment_in_closed_cash_session/);
  });

  test('mermas y compras con costo promedio ponderado; métricas sólo para roles ejecutivos', async () => {
    await as(BAR_A, `select public.record_inventory_movement($1, 'waste', 50, 'Botella rota')`, [ids.ron]);
    await assert.rejects(as(WAITER_A, `select public.record_inventory_movement($1, 'purchase', 50)`, [ids.ron]), /forbidden/);
    const before = await stock('Ron');
    await as(ADMIN_A, `select public.record_inventory_movement($1, 'purchase', 1000, 'Proveedor', 0.1)`, [ids.ron]);
    assert.equal(await stock('Ron'), before + 1000);

    const metrics = await one<{ m: { revenue: number; waste_cost: number; orders_closed: number } }>(
      ADMIN_A,
      `select public.get_shift_metrics(now() - interval '1 day', now() + interval '1 minute') as m`,
    );
    assert.equal(metrics.m.orders_closed, 2); // la cuenta dividida + la venta de la prueba de caja
    assert.equal(metrics.m.waste_cost, 4); // 50 ml × 0.08
    await assert.rejects(as(WAITER_A, `select public.get_shift_metrics()`), /forbidden/);
  });
});

describe('facturación electrónica', () => {
  const pay = (orderId: string, amount: number) =>
    one<{ r: { status: string } }>(WAITER_A, `select public.register_payments($1, 'full', $2::jsonb) as r`, [
      orderId,
      JSON.stringify([{ amount, method: 'cash' }]),
    ]).then((row) => row.r);
  const docsOf = (orderId: string) =>
    as<{ id: string; doc_type: string; status: string; credited_at: string | null; customer: unknown; payload: { totals: { total: number } } }>(
      ADMIN_A,
      `select id, doc_type, status, credited_at, customer, payload from einvoice_documents where order_id = $1 order by created_at`,
      [orderId],
    );

  test('desactivada: cobrar no genera documentos', async () => {
    ids.since = (await one<{ t: string }>(ADMIN_A, `select now()::text as t`)).t;
    ids.t3 = (await one<{ id: string }>(ADMIN_A, `insert into tables (zone_id, label) values ($1, 'T3') returning id`, [ids.zone])).id;
    const order = await submit(WAITER_A, [{ product_id: ids.mojito, quantity: 1 }], ids.t3!);
    assert.equal((await pay(order.order_id, order.total)).status, 'paid');
    assert.equal((await docsOf(order.order_id)).length, 0);
    ids.unbilledOrder = order.order_id;
  });

  test('activada: encola POS o factura según el cliente, con snapshot y sin duplicados', async () => {
    await db.exec(`update public.tenants set einvoice_enabled = true, einvoice_provider = 'simulator' where id = '${ids.tenantA}'`);

    const pos = await submit(WAITER_A, [{ product_id: ids.mojito, quantity: 2 }], ids.t3!);
    await pay(pos.order_id, pos.total);
    const [posDoc] = await docsOf(pos.order_id);
    assert.equal(posDoc!.doc_type, 'pos');
    assert.equal(posDoc!.status, 'pending');
    assert.equal(posDoc!.payload.totals.total, 50000);

    const inv = await submit(WAITER_A, [{ product_id: ids.mojito, quantity: 1 }], ids.t3!);
    await as(WAITER_A, `select public.set_billing_customer($1, $2::jsonb)`, [
      inv.order_id,
      JSON.stringify({ id_type: 'NIT', id_number: '900123456', name: 'Empresa SAS', email: 'fe@empresa.co' }),
    ]);
    await pay(inv.order_id, inv.total);
    const [invDoc] = await docsOf(inv.order_id);
    assert.equal(invDoc!.doc_type, 'invoice');
    assert.deepEqual((invDoc!.customer as { id_number: string }).id_number, '900123456');
    ids.invOrder = inv.order_id;

    // Reconciliación: sólo encola cuentas pagadas sin documento (la del test anterior).
    const [missing] = await as<{ n: number }>(ADMIN_A, `select public.enqueue_missing_einvoices($1::timestamptz) as n`, [ids.since]);
    assert.equal(missing!.n, 1);
    assert.equal((await docsOf(ids.unbilledOrder!)).length, 1);
    const [again] = await as<{ n: number }>(ADMIN_A, `select public.enqueue_missing_einvoices($1::timestamptz) as n`, [ids.since]);
    assert.equal(again!.n, 0);
  });

  test('anular pago: cancela lo pendiente y emite nota crédito sobre lo aceptado', async () => {
    // Documento aún pendiente -> se cancela al reabrir la cuenta.
    const [pendingPay] = await as<{ id: string }>(ADMIN_A, `select id from payments where order_id = $1`, [ids.unbilledOrder]);
    await as(ADMIN_A, `select public.void_payment($1, 'Error de caja')`, [pendingPay!.id]);
    assert.equal((await docsOf(ids.unbilledOrder!))[0]!.status, 'cancelled');
    // Libera la mesa: la cuenta reabierta sin pagos se anula.
    await as(ADMIN_A, `update orders set status = 'cancelled' where id = $1`, [ids.unbilledOrder]);

    // Documento aceptado por el proveedor -> nota crédito y se permite re-facturar al volver a pagar.
    await db.exec(`update public.einvoice_documents set status = 'accepted', cufe = 'x' where order_id = '${ids.invOrder}'`);
    const [invPay] = await as<{ id: string }>(ADMIN_A, `select id from payments where order_id = $1`, [ids.invOrder]);
    await as(ADMIN_A, `select public.void_payment($1, 'Cliente pagó con otra tarjeta')`, [invPay!.id]);
    let docs = await docsOf(ids.invOrder!);
    assert.equal(docs.length, 2);
    assert.ok(docs[0]!.credited_at);
    assert.equal(docs[1]!.doc_type, 'credit_note');

    const order = await one<{ total: string }>(ADMIN_A, `select total from orders where id = $1`, [ids.invOrder]);
    await pay(ids.invOrder!, Number(order.total));
    docs = await docsOf(ids.invOrder!);
    assert.equal(docs.length, 3);
    assert.equal(docs[2]!.doc_type, 'invoice');
  });

  test('permisos: meseros no ven documentos; sólo admin reintenta', async () => {
    const [seen] = await as<{ c: number }>(WAITER_A, `select count(*)::int as c from einvoice_documents`);
    assert.equal(seen!.c, 0);
    const [otherTenant] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from einvoice_documents`);
    assert.equal(otherTenant!.c, 0);
    const [doc] = await as<{ id: string }>(ADMIN_A, `select id from einvoice_documents where status = 'pending' limit 1`);
    await db.exec(`update public.einvoice_documents set status = 'error', attempts = 5 where id = '${doc!.id}'`);
    await assert.rejects(as(WAITER_A, `select public.retry_einvoice_document($1)`, [doc!.id]), /forbidden/);
    await as(ADMIN_A, `select public.retry_einvoice_document($1)`, [doc!.id]);
    const [row] = await as<{ status: string; attempts: number }>(ADMIN_A, `select status, attempts from einvoice_documents where id = $1`, [doc!.id]);
    assert.equal(row!.status, 'pending');
    assert.equal(row!.attempts, 0);
  });
});

describe('resumen del negocio', () => {
  const range = [new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 60_000).toISOString()];

  test('agrega ventas, costos reales por producto, personal y estaciones del periodo', async () => {
    const { s } = await one<{ s: Record<string, any> }>(ADMIN_A, `select public.get_business_snapshot($1, $2) as s`, range);
    const paid = await one<{ n: number; total: string }>(
      ADMIN_A,
      `select count(*)::int as n, coalesce(sum(total), 0) as total from orders where status = 'paid'`,
    );
    assert.equal(s.kpis.orders, paid.n);
    assert.equal(Number(s.kpis.revenue), Number(paid.total));
    assert.equal(s.previous_kpis.orders, 0);
    assert.ok(s.period.days >= 1);

    // El costo por producto sale de los movimientos reales de inventario (mojito: ron 60 ml + jarabe).
    const mojito = s.products.find((p: { name: string }) => p.name === 'Mojito');
    assert.ok(mojito && mojito.quantity > 0);
    assert.ok(Number(mojito.cost) > 0 && Number(mojito.net_revenue) > Number(mojito.cost));
    const productsRevenue = s.products.reduce((sum: number, p: { revenue: string }) => sum + Number(p.revenue), 0);
    assert.ok(productsRevenue >= Number(s.kpis.revenue) - Number(s.kpis.discounts) - 1);

    assert.ok(s.staff.some((w: { name: string }) => w.name === 'Walter'));
    assert.equal(s.daily.reduce((n: number, d: { orders: number }) => n + d.orders, 0), paid.n);
    assert.ok(Array.isArray(s.inventory.usage) && s.inventory.usage.length > 0);
  });

  test('sólo admin/agente, sin fugas entre tenants y con rango válido', async () => {
    await assert.rejects(as(WAITER_A, `select public.get_business_snapshot($1, $2)`, range), /forbidden/);
    await assert.rejects(as(ADMIN_A, `select public.get_business_snapshot($2, $1)`, range), /invalid_range/);
    const { s } = await one<{ s: Record<string, any> }>(ADMIN_B, `select public.get_business_snapshot($1, $2) as s`, range);
    assert.equal(s.kpis.orders, 0);
    assert.equal(s.products.length, 0);
    assert.equal(s.inventory.usage.length, 0);
  });
});

describe('informes del analista', () => {
  const report = (uid: string) =>
    as(uid, `insert into ai_reports (period_from, period_to, model, facts_hash, facts, content)
             values (now() - interval '7 days', now(), 'test-model', 'h1', '[]'::jsonb, '{}'::jsonb) returning id`);

  test('sólo el admin del tenant crea y ve informes; no se pueden editar', async () => {
    const [created] = await report(ADMIN_A);
    await assert.rejects(report(WAITER_A), /row-level security/);
    const [mine] = await as<{ c: number }>(ADMIN_A, `select count(*)::int as c from ai_reports`);
    assert.equal(mine!.c, 1);
    const [waiter] = await as<{ c: number }>(WAITER_A, `select count(*)::int as c from ai_reports`);
    assert.equal(waiter!.c, 0);
    const [other] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from ai_reports`);
    assert.equal(other!.c, 0);
    await as(ADMIN_A, `update ai_reports set model = 'x' where id = $1`, [(created as { id: string }).id]);
    const [row] = await as<{ model: string }>(ADMIN_A, `select model from ai_reports where id = $1`, [(created as { id: string }).id]);
    assert.equal(row!.model, 'test-model');
  });
});

describe('registro de costos de IA', () => {
  test('admin registra y ve su consumo; meseros y otros tenants no; no se edita ni borra', async () => {
    const insert = (uid: string) =>
      as(uid, `insert into ai_usage (feature, model, input_tokens, output_tokens, cost_usd) values ('analyst_report', 'claude-sonnet-5', 4695, 2704, 0.03643) returning id`);
    const [row] = await insert(ADMIN_A);
    await assert.rejects(insert(WAITER_A), /row-level security/);
    const [mine] = await as<{ c: number; total: string }>(ADMIN_A, `select count(*)::int as c, sum(cost_usd) as total from ai_usage`);
    assert.equal(mine!.c, 1);
    assert.equal(Number(mine!.total), 0.03643);
    const [other] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from ai_usage`);
    assert.equal(other!.c, 0);
    await as(ADMIN_A, `update ai_usage set cost_usd = 0 where id = $1`, [(row as { id: string }).id]);
    await as(ADMIN_A, `delete from ai_usage where id = $1`, [(row as { id: string }).id]);
    const [after] = await as<{ cost: string }>(ADMIN_A, `select cost_usd as cost from ai_usage where id = $1`, [(row as { id: string }).id]);
    assert.equal(Number(after!.cost), 0.03643);
  });
});
