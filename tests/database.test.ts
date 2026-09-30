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
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
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

/** Como el programa GastroBar Print: rol anon, sin usuario. */
async function anon<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const ids = {} as Record<string, string>;

before(async () => {
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${ADMIN_A}'), ('${ADMIN_B}'), ('${WAITER_A}'), ('${BAR_A}')`);

  // El registro está cerrado para usuarios (011): los gastrobares los crea la plataforma.
  const createAs = async (uid: string, name: string, slug: string, owner: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false);`);
    return (await db.query<{ id: string }>(`select public.create_tenant($1, $2, $3) as id`, [name, slug, owner])).rows[0]!.id;
  };
  ids.tenantA = await createAs(ADMIN_A, 'Bar A', 'bar-a', 'Ana');
  ids.tenantB = await createAs(ADMIN_B, 'Bar B', 'bar-b', 'Beto');
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
    await assert.rejects(as(BAR_A, `update order_items set status = 'cancelled' where station = 'bar'`), /forbidden/);
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

  test('quitar un ítem enviado: sólo admin, con motivo; devuelve el stock y queda quién y por qué', async () => {
    const [burger] = await as<{ id: string }>(ADMIN_A, `select id from order_items where product_id = $1`, [ids.burger]);
    await assert.rejects(as(WAITER_A, `update order_items set status = 'cancelled' where product_id = $1`, [ids.burger]), /forbidden/);
    await assert.rejects(as(WAITER_A, `select public.cancel_order_items($1::uuid[], 'Se equivocó')`, [[burger!.id]]), /forbidden/);
    await assert.rejects(as(ADMIN_A, `update order_items set status = 'cancelled' where product_id = $1`, [ids.burger]), /void_reason_required/);
    await assert.rejects(as(ADMIN_A, `select public.cancel_order_items($1::uuid[], '  ')`, [[burger!.id]]), /void_reason_required/);
    assert.equal(await stock('Carne'), 400, 'nada cambió');
    const [r] = await as<{ n: number }>(ADMIN_A, `select public.cancel_order_items($1::uuid[], 'Cliente cambió de plato') as n`, [[burger!.id]]);
    assert.equal(r!.n, 1);
    assert.equal(await stock('Carne'), 600);
    const item = await one<{ status: string; cancel_reason: string; cancelled_by: string }>(ADMIN_A, `select status, cancel_reason, cancelled_by from order_items where id = $1`, [burger!.id]);
    assert.deepEqual(item, { status: 'cancelled', cancel_reason: 'Cliente cambió de plato', cancelled_by: ADMIN_A });
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
    await as(ADMIN_A, `select public.cancel_order($1, 'Prueba de impuestos')`, [excl.order_id]);
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
    await as(ADMIN_A, `select public.cancel_order($1, 'Cuenta reabierta sin pagos')`, [ids.unbilledOrder]);

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
  test('el servidor registra el consumo, pero el gastrobar no ve costos ni puede editarlos', async () => {
    const insert = (uid: string) =>
      as<{ id: string }>(uid, `insert into ai_usage (feature, model, input_tokens, output_tokens, cost_usd) values ('analyst_report', 'claude-sonnet-5', 4695, 2704, 0.03643) returning id`);
    // Sin política de lectura (011), el INSERT ... RETURNING no devuelve la fila: se inserta sin returning.
    await as(ADMIN_A, `insert into ai_usage (feature, model, input_tokens, output_tokens, cost_usd) values ('analyst_report', 'claude-sonnet-5', 4695, 2704, 0.03643)`);
    await assert.rejects(insert(WAITER_A), /row-level security/);
    const [mine] = await as<{ c: number }>(ADMIN_A, `select count(*)::int as c from ai_usage`);
    assert.equal(mine!.c, 0, 'el administrador del gastrobar no ve los costos');
    await as(ADMIN_A, `update ai_usage set cost_usd = 0`);
    await as(ADMIN_A, `delete from ai_usage`);
    await db.exec('reset role');
    const { rows } = await db.query<{ c: number; total: string }>(
      `select count(*)::int as c, sum(cost_usd) as total from public.ai_usage where tenant_id = $1`,
      [ids.tenantA],
    );
    assert.equal(rows[0]!.c, 1, 'la plataforma sí conserva el registro');
    assert.equal(Number(rows[0]!.total), 0.03643);
  });
});

describe('planes de IA', () => {
  test('el admin lee su plan pero no puede asignárselo ni cambiarlo', async () => {
    await assert.rejects(as(ADMIN_A, `insert into tenant_ai_plans (tenant_id, plan) values ($1, 'premium')`, [ids.tenantA]), /row-level security/);
    await db.exec(`insert into public.tenant_ai_plans (tenant_id, plan, reports_per_month) values ('${ids.tenantA}', 'pro', 12)`);
    const [mine] = await as<{ plan: string; reports_per_month: number }>(ADMIN_A, `select plan, reports_per_month from tenant_ai_plans`);
    assert.deepEqual(mine, { plan: 'pro', reports_per_month: 12 });
    await as(ADMIN_A, `update tenant_ai_plans set reports_per_month = 999`);
    const [after] = await as<{ reports_per_month: number }>(ADMIN_A, `select reports_per_month from tenant_ai_plans`);
    assert.equal(after!.reports_per_month, 12);
    const [waiter] = await as<{ c: number }>(WAITER_A, `select count(*)::int as c from tenant_ai_plans`);
    assert.equal(waiter!.c, 0);
    const [other] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from tenant_ai_plans`);
    assert.equal(other!.c, 0);
  });
});

describe('agente comprador', () => {
  const asService = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec('reset role');
    }
  };

  test('entrega insumos con consumo diario real, proveedor y empaque', async () => {
    const [sup] = await as<{ id: string }>(ADMIN_A, `insert into suppliers (name, phone, lead_time_days) values ('Licores del Valle', '573001112233', 2) returning id`);
    await as(ADMIN_A, `update ingredients set supplier_id = $1, pack_size = 750, pack_label = 'botella 750 ml' where name = 'Ron'`, [sup!.id]);
    const { r } = await one<{ r: any }>(ADMIN_A, `select public.get_purchase_inputs($1, 28) as r`, [ids.tenantA]);
    const ron = r.ingredients.find((i: { name: string }) => i.name === 'Ron');
    assert.equal(ron.supplier_name, 'Licores del Valle');
    assert.equal(ron.lead_time_days, 2);
    assert.equal(Number(ron.pack_size), 750);
    assert.ok(Number(ron.sold) > 0, 'el ron vendido sale de los movimientos por receta');
    const dailyTotal = Object.values(ron.daily as Record<string, number>).reduce((a, b) => a + Number(b), 0);
    assert.equal(dailyTotal, Number(ron.sold));
  });

  test('sólo el admin de su gastrobar o el servicio programado', async () => {
    await assert.rejects(as(WAITER_A, `select public.get_purchase_inputs($1, 28)`, [ids.tenantA]), /forbidden/);
    await assert.rejects(as(ADMIN_B, `select public.get_purchase_inputs($1, 28)`, [ids.tenantA]), /forbidden/);
    const [row] = await asService<{ r: any }>(`select public.get_purchase_inputs($1, 28) as r`, [ids.tenantA]);
    assert.ok(row!.r.ingredients.length > 0);
    const [other] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from suppliers`);
    assert.equal(other!.c, 0);
  });

  test('el cron guarda pedidos con el rol de servicio; sólo el admin del gastrobar los ve', async () => {
    await asService(
      `insert into purchase_suggestions (tenant_id, trigger, horizon_days, coverage_from, coverage_to, history_days, lines, total_estimated)
       values ($1, 'schedule', 7, current_date, current_date + 7, 56, '[]', 0)`,
      [ids.tenantA],
    );
    await as(ADMIN_A, `insert into agent_schedules (agent, is_active, frequency, hour) values ('purchase', true, 'weekly', 7)`);
    const [mine] = await as<{ c: number }>(ADMIN_A, `select count(*)::int as c from purchase_suggestions where trigger = 'schedule'`);
    assert.equal(mine!.c, 1);
    const [waiter] = await as<{ c: number }>(WAITER_A, `select count(*)::int as c from purchase_suggestions`);
    assert.equal(waiter!.c, 0);
    const [otherAdmin] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from agent_schedules`);
    assert.equal(otherAdmin!.c, 0);
  });
});

describe('mensajero', () => {
  const range = [new Date(Date.now() - 7 * 86_400_000).toISOString(), new Date(Date.now() + 60_000).toISOString()];

  test('el resumen del negocio acepta un gastrobar explícito sólo con el rol de servicio', async () => {
    await assert.rejects(as(ADMIN_A, `select public.get_business_snapshot($1, $2, $3)`, [...range, ids.tenantA]), /forbidden/);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
    try {
      const { rows } = await db.query<{ s: any }>(`select public.get_business_snapshot($1, $2, $3) as s`, [...range, ids.tenantA]);
      const mine = await one<{ s: any }>(ADMIN_A, `select public.get_business_snapshot($1, $2) as s`, range);
      assert.equal(rows[0]!.s.kpis.orders, mine.s.kpis.orders);
      assert.ok(rows[0]!.s.kpis.orders > 0);
    } finally {
      await db.exec('reset role');
    }
  });

  test('destinatarios y envíos: sólo el admin de su gastrobar', async () => {
    await as(ADMIN_A, `insert into messenger_settings (emails, whatsapp_phone) values ('{dueno@bar-a.co}', '573001112233')`);
    await as(ADMIN_A, `insert into messenger_deliveries (recipients, subject, status) values ('{dueno@bar-a.co}', 'Resumen', 'sent')`);
    await as(ADMIN_A, `insert into agent_schedules (agent, is_active, frequency, weekday, hour) values ('messenger', true, 'weekly', 1, 7)`);
    const [s] = await as<{ emails: string[] }>(ADMIN_A, `select emails from messenger_settings`);
    assert.deepEqual(s!.emails, ['dueno@bar-a.co']);
    const [w] = await as<{ c: number }>(WAITER_A, `select count(*)::int as c from messenger_settings`);
    assert.equal(w!.c, 0);
    const [b] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from messenger_deliveries`);
    assert.equal(b!.c, 0);
    await assert.rejects(as(WAITER_A, `insert into messenger_deliveries (recipients, subject, status) values ('{x@y.co}', 'x', 'sent')`), /row-level security/);
  });
});

describe('plataforma', () => {
  test('los usuarios ya no pueden crear gastrobares por su cuenta', async () => {
    await db.exec(`insert into auth.users values ('55555555-5555-5555-5555-555555555555')`);
    await assert.rejects(
      as('55555555-5555-5555-5555-555555555555', `select public.create_tenant('Bar C', 'bar-c', 'Carla')`),
      /permission denied/,
    );
  });

  test('agentes contratados: los miembros los leen, nadie los cambia salvo la plataforma', async () => {
    await db.exec(`insert into public.tenant_agents (tenant_id, agent, enabled) values ('${ids.tenantA}', 'analista', false)`);
    const [row] = await as<{ enabled: boolean }>(WAITER_A, `select enabled from tenant_agents where agent = 'analista'`);
    assert.equal(row!.enabled, false);
    await as(ADMIN_A, `update tenant_agents set enabled = true where agent = 'analista'`);
    const [after] = await as<{ enabled: boolean }>(ADMIN_A, `select enabled from tenant_agents where agent = 'analista'`);
    assert.equal(after!.enabled, false);
    await assert.rejects(as(ADMIN_A, `insert into tenant_agents (tenant_id, agent) values ($1, 'vigia')`, [ids.tenantA]), /row-level security/);
    const [other] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from tenant_agents`);
    assert.equal(other!.c, 0);
  });

  test('un gastrobar suspendido no ve ni escribe nada, pero sus usuarios siguen viendo su perfil', async () => {
    await db.exec(`update public.tenants set status = 'suspended' where id = '${ids.tenantB}'`);
    try {
      const [t] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from tenants`);
      assert.equal(t!.c, 0);
      const [me] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from profiles where id = auth.uid()`);
      assert.equal(me!.c, 1);
      await assert.rejects(as(ADMIN_B, `insert into zones (name) values ('Nueva')`), /row-level security|null value/);
      // El otro gastrobar sigue funcionando normalmente.
      const [a] = await as<{ c: number }>(ADMIN_A, `select count(*)::int as c from tenants`);
      assert.equal(a!.c, 1);
    } finally {
      await db.exec(`update public.tenants set status = 'active' where id = '${ids.tenantB}'`);
    }
  });

  test('sólo el propio superusuario ve su registro de plataforma', async () => {
    await db.exec(`insert into public.platform_admins (user_id) values ('${ADMIN_A}')`);
    const [mine] = await as<{ c: number }>(ADMIN_A, `select count(*)::int as c from platform_admins`);
    assert.equal(mine!.c, 1);
    const [other] = await as<{ c: number }>(ADMIN_B, `select count(*)::int as c from platform_admins`);
    assert.equal(other!.c, 0);
    await assert.rejects(as(ADMIN_B, `insert into platform_admins (user_id) values ($1)`, [ADMIN_B]), /row-level security/);
  });
});

describe('ubicación del gastrobar', () => {
  test('el admin guarda ciudad y departamento; valores vacíos o absurdos se rechazan', async () => {
    await as(ADMIN_A, `update tenants set city = 'Bogotá', department = 'Bogotá D. C.'`);
    const [t] = await as<{ city: string; department: string }>(ADMIN_A, `select city, department from tenants`);
    assert.deepEqual(t, { city: 'Bogotá', department: 'Bogotá D. C.' });
    await assert.rejects(as(ADMIN_A, `update tenants set city = 'X'`), /tenants_city_len/);
    const [other] = await as<{ city: string | null }>(ADMIN_B, `select city from tenants`);
    assert.equal(other!.city, null, 'la ciudad de A no aparece para B');
  });
});

describe('cambio de unidad de un insumo', () => {
  test('de ml a botella convierte stock, mínimo, costo, recetas e historial; nadie más puede hacerlo', async () => {
    const whisky = (await one<{ id: string }>(
      ADMIN_A,
      `insert into ingredients (name, unit, stock_quantity, min_stock, cost_per_unit, pack_size) values ('Whisky prueba', 'ml', 0, 1500, 145.2, 750) returning id`,
    )).id;
    await as(ADMIN_A, `select public.record_inventory_movement($1, 'purchase', 1500, 'Compra 2 botellas', 145.2)`, [whisky]);
    const shot = (await one<{ id: string }>(ADMIN_A, `insert into products (category_id, name, price) values ($1, 'Shot prueba', 22000) returning id`, [ids.bar])).id;
    await as(ADMIN_A, `insert into recipes (product_id, ingredient_id, quantity) values ($1, $2, 60)`, [shot, whisky]);

    await assert.rejects(as(WAITER_A, `select public.change_ingredient_unit($1, 'unit', 750)`, [whisky]), /forbidden/);
    await assert.rejects(as(ADMIN_B, `select public.change_ingredient_unit($1, 'unit', 750)`, [whisky]), /ingredient_not_found/);
    await assert.rejects(as(ADMIN_A, `select public.change_ingredient_unit($1, 'unit', 0)`, [whisky]), /invalid_quantity/);

    await as(ADMIN_A, `select public.change_ingredient_unit($1, 'unit', 750)`, [whisky]);
    const ing = await one<{ unit: string; stock_quantity: string; min_stock: string; cost_per_unit: string; pack_size: string }>(
      ADMIN_A,
      `select unit, stock_quantity, min_stock, cost_per_unit, pack_size from ingredients where id = $1`,
      [whisky],
    );
    assert.equal(ing.unit, 'unit');
    assert.equal(Number(ing.stock_quantity), 2, '1.500 ml = 2 botellas');
    assert.equal(Number(ing.min_stock), 2);
    assert.equal(Number(ing.cost_per_unit), 108900, '$145,2/ml × 750 = $108.900 por botella');
    assert.equal(Number(ing.pack_size), 1);
    const recipe = await one<{ quantity: string }>(ADMIN_A, `select quantity from recipes where product_id = $1`, [shot]);
    assert.equal(Number(recipe.quantity), 0.08, '60 ml = 0,08 botellas');
    const mov = await one<{ quantity: string; unit_cost: string }>(ADMIN_A, `select quantity, unit_cost from inventory_movements where ingredient_id = $1`, [whisky]);
    assert.equal(Number(mov.quantity), 2);
    assert.equal(Number(mov.unit_cost), 108900);

    // Volver a ml deja todo como estaba.
    await as(ADMIN_A, `select public.change_ingredient_unit($1, 'ml', $2)`, [whisky, 1 / 750]);
    const back = await one<{ stock_quantity: string; cost_per_unit: string }>(ADMIN_A, `select stock_quantity, cost_per_unit from ingredients where id = $1`, [whisky]);
    assert.equal(Number(back.stock_quantity), 1500);
    assert.equal(Number(back.cost_per_unit), 145.2);
    const backRecipe = await one<{ quantity: string }>(ADMIN_A, `select quantity from recipes where product_id = $1`, [shot]);
    assert.equal(Number(backRecipe.quantity), 60);
  });
});

describe('anular comandas enviadas', () => {
  test('sólo el admin anula la comanda completa, con motivo; los ítems heredan motivo y autor', async () => {
    const t9 = (await one<{ id: string }>(ADMIN_A, `insert into tables (zone_id, label) values ($1, 'T9') returning id`, [ids.zone])).id;
    const { order_id } = await submit(WAITER_A, [{ product_id: ids.mojito }], t9);
    for (const who of [WAITER_A, BAR_A]) {
      await assert.rejects(as(who, `select public.cancel_order($1, 'No quiso')`, [order_id]), /forbidden/);
      // Mesero: la regla lo rechaza. Barra: ni siquiera ve la orden (0 filas).
      await as(who, `update orders set status = 'cancelled' where id = $1`, [order_id]).catch((e) => assert.match(String(e), /forbidden/));
    }
    const still = await one<{ status: string }>(ADMIN_A, `select status from orders where id = $1`, [order_id]);
    assert.notEqual(still.status, 'cancelled');
    await assert.rejects(as(ADMIN_A, `update orders set status = 'cancelled' where id = $1`, [order_id]), /void_reason_required/);
    await as(ADMIN_A, `select public.cancel_order($1, 'Clientes se fueron sin consumir')`, [order_id]);
    const order = await one<{ status: string; cancel_reason: string; cancelled_by: string }>(ADMIN_A, `select status, cancel_reason, cancelled_by from orders where id = $1`, [order_id]);
    assert.deepEqual(order, { status: 'cancelled', cancel_reason: 'Clientes se fueron sin consumir', cancelled_by: ADMIN_A });
    const items = await as<{ status: string; cancel_reason: string }>(ADMIN_A, `select status, cancel_reason from order_items where order_id = $1`, [order_id]);
    assert.ok(items.length > 0 && items.every((i) => i.status === 'cancelled' && i.cancel_reason === 'Clientes se fueron sin consumir'));
    const table = await one<{ status: string }>(ADMIN_A, `select status from tables where id = $1`, [t9]);
    assert.equal(table.status, 'free', 'la mesa queda libre');
    await assert.rejects(as(ADMIN_A, `select public.cancel_order($1, 'Otra vez')`, [order_id]), /order_closed/);
  });
});

describe('cambio de mesa, unión y separación de cuentas', () => {
  test('trasladar a mesa libre, unir con abono incluido y separar productos; la mesa de origen queda libre', async () => {
    const agua = (await one<{ id: string }>(ADMIN_A, `insert into products (category_id, name, price, track_stock) values ($1, 'Agua prueba', 5000, false) returning id`, [ids.bar])).id;
    const mesa = async (label: string) => (await one<{ id: string }>(ADMIN_A, `insert into tables (zone_id, label) values ($1, $2) returning id`, [ids.zone, label])).id;
    const [m3, m7, m8] = [await mesa('M3'), await mesa('M7'), await mesa('M8')];
    const status = async (t: string) => (await one<{ status: string }>(ADMIN_A, `select status from tables where id = $1`, [t])).status;
    const order = (id: string) => one<{ table_id: string; total: string; paid_amount: string; notes: string | null }>(ADMIN_A, `select table_id, total, paid_amount, notes from orders where id = $1`, [id]);

    // Mesa 3: 2 aguas y un abono de 3.000 sin asignar a ítems.
    const { order_id: cuenta3 } = await submit(WAITER_A, [{ product_id: agua, quantity: 2 }], m3);
    await as(WAITER_A, `select public.register_payments($1, 'custom', $2::jsonb)`, [cuenta3, JSON.stringify([{ amount: 3000, method: 'card' }])]);

    // Otro gastrobar y la barra no pueden moverla.
    await assert.rejects(as(ADMIN_B, `select public.transfer_order($1, $2)`, [cuenta3, m7]), /forbidden|order_not_found/);
    await assert.rejects(as(BAR_A, `select public.transfer_order($1, $2)`, [cuenta3, m7]), /forbidden/);

    // 1) Trasladar a Mesa 7 (libre): la cuenta cambia de mesa y Mesa 3 queda libre.
    const [moved] = await as<{ r: { mode: string } }>(WAITER_A, `select public.transfer_order($1, $2) as r`, [cuenta3, m7]);
    assert.equal(moved!.r.mode, 'moved');
    assert.equal((await order(cuenta3)).table_id, m7);
    assert.equal(await status(m3), 'free');
    assert.equal(await status(m7), 'occupied');

    // Llegan clientes nuevos a Mesa 3 y abren su propia cuenta.
    const { order_id: nueva3 } = await submit(WAITER_A, [{ product_id: agua, quantity: 1 }], m3);
    assert.notEqual(nueva3, cuenta3);

    // 2) Unir: Mesa 8 tiene 1 agua; la cuenta de Mesa 7 (con su abono) se une a Mesa 8.
    const { order_id: cuenta8 } = await submit(WAITER_A, [{ product_id: agua, quantity: 1 }], m8);
    const [merged] = await as<{ r: { mode: string; order_id: string } }>(WAITER_A, `select public.transfer_order($1, $2) as r`, [cuenta3, m8]);
    assert.equal(merged!.r.mode, 'merged');
    assert.equal(merged!.r.order_id, cuenta8);
    const o8 = await order(cuenta8);
    assert.equal(Number(o8.total), 15000, '1 + 2 aguas');
    assert.equal(Number(o8.paid_amount), 3000, 'el abono viajó con la cuenta');
    assert.match(o8.notes ?? '', /Unida con cuenta/);
    assert.equal((await as(ADMIN_A, `select id from orders where id = $1`, [cuenta3])).length, 0, 'la cuenta unida no queda como anulada');
    assert.equal(await status(m7), 'free');
    const rounds = await as<{ round: number }>(ADMIN_A, `select distinct round from order_items where order_id = $1 order by round`, [cuenta8]);
    assert.deepEqual(rounds.map((r) => r.round), [1, 2], 'las rondas unidas no se mezclan en el KDS');

    // 3) Separar: 1 de los ítems de Mesa 8 pasa a Mesa 7 (libre) en una cuenta nueva.
    const [item] = await as<{ id: string }>(ADMIN_A, `select id from order_items where order_id = $1 and round = 2`, [cuenta8]);
    const [split] = await as<{ r: { mode: string; order_id: string } }>(WAITER_A, `select public.transfer_order_items($1::uuid[], $2) as r`, [[item!.id], m7]);
    assert.equal(split!.r.mode, 'split');
    assert.equal(Number((await order(split!.r.order_id)).total), 10000);
    assert.equal(Number((await order(cuenta8)).total), 5000);
    assert.equal(await status(m7), 'occupied');

    // Separar TODOS los productos de una cuenta equivale a moverla completa (aquí: se une a Mesa 8).
    const [last] = await as<{ id: string }>(ADMIN_A, `select id from order_items where order_id = $1`, [split!.r.order_id]);
    const [all] = await as<{ r: { mode: string } }>(WAITER_A, `select public.transfer_order_items($1::uuid[], $2) as r`, [[last!.id], m8]);
    assert.equal(all!.r.mode, 'merged');
    assert.equal(await status(m7), 'free');
    // Separar un ítem ya pagado por ítem: bloqueado.
    const { order_id: c3 } = await submit(WAITER_A, [{ product_id: agua, quantity: 1 }], m3);
    const [paidItem] = await as<{ id: string; line_total: string }>(ADMIN_A, `select id, line_total from order_items where order_id = $1 order by created_at limit 1`, [c3]);
    await as(WAITER_A, `select public.register_payments($1, 'by_item', $2::jsonb)`, [
      c3,
      JSON.stringify([{ amount: Number(paidItem!.line_total), method: 'card', allocations: [{ order_item_id: paidItem!.id, amount: Number(paidItem!.line_total) }] }]),
    ]);
    await assert.rejects(as(WAITER_A, `select public.transfer_order_items($1::uuid[], $2)`, [[paidItem!.id], m7]), /item_already_paid/);
  });
});

describe('comandas sin conexión', () => {
  test('reintentar un envío con el mismo client_id no duplica la comanda', async () => {
    const t10 = (await one<{ id: string }>(ADMIN_A, `insert into tables (zone_id, label) values ($1, 'T10') returning id`, [ids.zone])).id;
    const agua = (await one<{ id: string }>(ADMIN_A, `insert into products (category_id, name, price, track_stock) values ($1, 'Agua cola', 4000, false) returning id`, [ids.bar])).id;
    const clientId = crypto.randomUUID();
    const send = () =>
      one<{ r: { order_id: string; round: number; duplicate?: boolean } }>(WAITER_A, `select public.submit_order($1, $2::jsonb, null, null, $3) as r`, [
        t10,
        JSON.stringify([{ product_id: agua, quantity: 2 }]),
        clientId,
      ]).then((x) => x.r);
    const first = await send();
    const retry = await send();
    assert.equal(retry.order_id, first.order_id);
    assert.equal(retry.duplicate, true);
    const [c] = await as<{ n: number }>(ADMIN_A, `select count(*)::int as n from order_items where order_id = $1`, [first.order_id]);
    assert.equal(c!.n, 1, 'sigue habiendo una sola línea');
    // Otro envío (otro client_id) sí agrega una ronda.
    const next = await submit(WAITER_A, [{ product_id: agua }], t10);
    assert.equal(next.round, 2);
    // Otro gastrobar no ve los envíos de A.
    const [b] = await as<{ n: number }>(ADMIN_B, `select count(*)::int as n from order_submissions`);
    assert.equal(b!.n, 0);
  });
});

describe('impresión: estación, cola y aislamiento', () => {
  test('vincular con código, recibir trabajos sólo de sus impresoras, reportar y revocar', async () => {
    const hash = (s: string) => `encode(sha256(convert_to('${s}', 'UTF8')), 'hex')`;
    // El admin crea la estación con un código (así lo hace la acción del servidor).
    const station = (await one<{ id: string }>(ADMIN_A, `insert into print_stations (name, pairing_code_hash, pairing_expires_at) values ('PC caja', ${hash('ABCD2345')}, now() + interval '15 minutes') returning id`)).id;
    assert.equal((await as(WAITER_A, `select * from print_stations`)).length, 0, 'sólo el admin ve las estaciones');

    // El programa (anónimo) vincula con el código —con o sin guion— y recibe su token una sola vez.
    await assert.rejects(anon(`select public.print_agent_pair('ZZZZ-9999', 'PC')`), /invalid_pairing_code/);
    const [paired] = await anon<{ r: { token: string; station_id: string } }>(`select public.print_agent_pair('abcd-2345', 'PC-ELPUNTO') as r`);
    const token = paired!.r.token;
    assert.equal(paired!.r.station_id, station);
    await assert.rejects(anon(`select public.print_agent_pair('ABCD2345', 'otro')`), /invalid_pairing_code/, 'el código es de un solo uso');

    const cocina = (await one<{ id: string }>(ADMIN_A, `insert into printers (station_id, name, connection, target, paper_width) values ($1, 'Cocina', 'windows', 'SAT15TUS', 80) returning id`, [station])).id;
    const [hb] = await anon<{ r: { printers: Array<{ name: string; codepage: string }> } }>(`select public.print_agent_heartbeat($1, '1.0.0', '[{"name":"SAT15TUS"}]'::jsonb) as r`, [token]);
    assert.deepEqual(hb!.r.printers.map((p) => [p.name, p.codepage]), [['Cocina', 'cp850']]);

    // El mesero encola; el mesero no puede leer la cola.
    await as(WAITER_A, `insert into print_jobs (printer_id, document, title, payload) values ($1, 'kitchen_order', 'Comanda Mesa 1', '{"blocks":[]}')`, [cocina]);
    assert.equal((await as(WAITER_A, `select * from print_jobs`)).length, 0);

    // Otro gastrobar no puede mandar trabajos a esta impresora.
    await assert.rejects(as(ADMIN_B, `insert into print_jobs (printer_id, document, title, payload) values ($1, 'test', 'X', '{}')`, [cocina]));

    // El programa toma el trabajo (una sola vez), falla, se reintenta y luego sale.
    const [pull] = await anon<{ r: Array<{ id: string; title: string }> }>(`select public.print_agent_pull($1) as r`, [token]);
    assert.equal(pull!.r.length, 1);
    const jobId = pull!.r[0]!.id;
    const [again] = await anon<{ r: unknown[] }>(`select public.print_agent_pull($1) as r`, [token]);
    assert.equal(again!.r.length, 0, 'no se entrega dos veces');
    await anon(`select public.print_agent_report($1, $2, false, 'Sin papel')`, [token, jobId]);
    let job = await one<{ status: string; error: string }>(ADMIN_A, `select status, error from print_jobs where id = $1`, [jobId]);
    assert.deepEqual(job, { status: 'pending', error: 'Sin papel' });
    const printer = await one<{ status: string }>(ADMIN_A, `select status from printers where id = $1`, [cocina]);
    assert.equal(printer.status, 'error');
    await anon(`select public.print_agent_pull($1)`, [token]);
    await anon(`select public.print_agent_report($1, $2, true)`, [token, jobId]);
    job = await one(ADMIN_A, `select status, error from print_jobs where id = $1`, [jobId]);
    assert.deepEqual(job, { status: 'printed', error: null });

    // Token falso o estación revocada: no entra.
    await assert.rejects(anon(`select public.print_agent_pull('token-falso')`), /invalid_print_token/);
    await as(ADMIN_A, `update print_stations set revoked_at = now() where id = $1`, [station]);
    await assert.rejects(anon(`select public.print_agent_pull($1)`, [token]), /invalid_print_token/);
    // Con sesión de usuario tampoco se leen las tablas de estaciones de otro gastrobar.
    assert.equal((await as(ADMIN_B, `select * from print_stations`)).length, 0);
  });
});
