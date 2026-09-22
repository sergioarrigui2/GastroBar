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
