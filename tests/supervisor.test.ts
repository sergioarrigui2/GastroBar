/**
 * Rol «supervisor» con permisos configurables (migraciones 025–026), sobre PostgreSQL embebido.
 * Lo que se prueba es lo que importa: que el supervisor haga lo que se le dio, NO vea ventas,
 * pagos, caja ni recetas aunque consulte la base directamente, y que el resto de los roles
 * quede exactamente como estaba.
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
const ADMIN = '11111111-0000-0000-0000-000000000001';
const SUP = '11111111-0000-0000-0000-000000000002'; // supervisor con todos los permisos
const SUP0 = '11111111-0000-0000-0000-000000000003'; // supervisor sin ningún permiso
const WAITER = '11111111-0000-0000-0000-000000000004';
const CASHIER = '11111111-0000-0000-0000-000000000005';
const KITCHEN = '11111111-0000-0000-0000-000000000006';
const ALL = ['orders.take', 'inventory.view', 'inventory.receive', 'inventory.count', 'inventory.waste', 'suppliers.manage', 'purchasing.use'];

const db = new PGlite();
const ids: Record<string, string> = {};

async function as<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const one = async <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) => (await as<T>(uid, sql, params))[0]!;
const count = async (uid: string, table: string) => Number((await one<{ c: string }>(uid, `select count(*) as c from public.${table}`)).c);
const root = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  return (await db.query<T>(sql, params)).rows;
};

before(async () => {
  await db.exec(STUBS);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${ADMIN}'), ('${SUP}'), ('${SUP0}'), ('${WAITER}'), ('${CASHIER}'), ('${KITCHEN}')`);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
  ids.tenant = (await db.query<{ id: string }>(`select public.create_tenant('Bar S', 'bar-s', 'Dueña') as id`)).rows[0]!.id;
  await db.exec(`insert into public.profiles (id, tenant_id, role, full_name, permissions) values
    ('${SUP}', '${ids.tenant}', 'supervisor', 'Sup Completo', '{${ALL.join(',')}}'),
    ('${SUP0}', '${ids.tenant}', 'supervisor', 'Sup Vacío', '{}'),
    ('${WAITER}', '${ids.tenant}', 'waiter', 'Walter', '{inventory.count}'),
    ('${CASHIER}', '${ids.tenant}', 'cashier', 'Cami', '{}'),
    ('${KITCHEN}', '${ids.tenant}', 'kitchen', 'Kiko', '{}')`);

  ids.zone = (await one<{ id: string }>(ADMIN, `insert into zones (name) values ('Salón') returning id`)).id;
  ids.t1 = (await one<{ id: string }>(ADMIN, `insert into tables (zone_id, label) values ($1, 'M1') returning id`, [ids.zone])).id;
  ids.t2 = (await one<{ id: string }>(ADMIN, `insert into tables (zone_id, label) values ($1, 'M2') returning id`, [ids.zone])).id;
  ids.t3 = (await one<{ id: string }>(ADMIN, `insert into tables (zone_id, label) values ($1, 'M3') returning id`, [ids.zone])).id;
  ids.cat = (await one<{ id: string }>(ADMIN, `insert into categories (name, station) values ('Bar', 'bar') returning id`)).id;
  ids.ron = (await one<{ id: string }>(ADMIN, `insert into ingredients (name, unit, stock_quantity, cost_per_unit) values ('Ron', 'ml', 5000, 0.08) returning id`)).id;
  ids.mojito = (await one<{ id: string }>(ADMIN, `insert into products (category_id, name, price) values ($1, 'Mojito', 25000) returning id`, [ids.cat])).id;
  await one(ADMIN, `insert into recipes (product_id, ingredient_id, quantity) values ($1, $2, 60) returning id`, [ids.mojito, ids.ron]);
  ids.sup = (await one<{ id: string }>(ADMIN, `insert into suppliers (name) values ('Licores SA') returning id`)).id;

  // Una cuenta ya pagada (historial) y una abierta.
  const paid = (await one<{ r: { order_id: string; total: number } }>(WAITER, `select public.submit_order($1, $2::jsonb) as r`, [ids.t1, JSON.stringify([{ product_id: ids.mojito, quantity: 2 }])])).r;
  await one(CASHIER, `select public.register_payments($1, 'full', $2::jsonb) as r`, [paid.order_id, JSON.stringify([{ amount: paid.total, method: 'cash' }])]);
  ids.paidOrder = paid.order_id;
  ids.open = (await one<{ r: { order_id: string } }>(WAITER, `select public.submit_order($1, $2::jsonb) as r`, [ids.t2, JSON.stringify([{ product_id: ids.mojito }])])).r.order_id;
  await one(CASHIER, `select public.open_cash_session(100000) as r`).catch(() => undefined);
});

describe('supervisor: lo que no ve (aunque consulte la base directamente)', () => {
  test('pagos, recetas e historial de cuentas están cerrados; las cuentas abiertas sólo con permiso de pedidos', async () => {
    assert.ok((await count(ADMIN, 'payments')) > 0 && (await count(ADMIN, 'recipes')) > 0, 'la prueba necesita datos');
    for (const t of ['payments', 'payment_allocations', 'recipes', 'sub_recipes', 'sub_recipe_ingredients', 'cash_sessions', 'cash_movements']) {
      assert.equal(await count(SUP, t), 0, `el supervisor lee ${t}`);
      assert.equal(await count(SUP0, t), 0, `el supervisor sin permisos lee ${t}`);
    }
    // Con orders.take ve la cuenta abierta, jamás la pagada.
    const seen = await as<{ id: string; status: string }>(SUP, `select id, status from orders`);
    assert.deepEqual(seen.map((o) => o.id), [ids.open]);
    assert.ok((await count(SUP, 'order_items')) > 0);
    // Sin orders.take no ve ninguna.
    assert.equal(await count(SUP0, 'orders'), 0);
    assert.equal(await count(SUP0, 'order_items'), 0);
    // Los demás roles siguen como siempre.
    assert.equal(await count(WAITER, 'orders'), 2);
    assert.ok((await count(WAITER, 'payments')) > 0);
  });

  test('ni reportes de ventas ni métricas, ni las listas de caja', async () => {
    for (const sql of [
      `select public.get_business_snapshot(now() - interval '7 days', now())`,
      `select public.get_shift_metrics()`,
      `select public.get_cash_session()`,
    ]) {
      await assert.rejects(as(SUP, sql), /forbidden|permission denied|not_authenticated/, sql);
    }
    assert.equal(await count(SUP, 'sales_history_days'), 0);
    assert.equal(await count(SUP, 'ai_reports'), 0);
    assert.equal(await count(SUP, 'einvoice_documents'), 0);
  });

  test('inventario: lo ve sólo con permiso; las cuentas de un supervisor sin permisos no ven nada', async () => {
    assert.equal(await count(SUP0, 'ingredients'), 0);
    assert.equal(await count(SUP0, 'inventory_movements'), 0);
    assert.equal(await count(SUP, 'ingredients'), 1);
    assert.equal((await one<{ c: string }>(SUP, `select cost_per_unit as c from ingredients`)).c, '0.0800');
    assert.equal(await count(SUP0, 'suppliers'), 0);
  });
});

describe('supervisor: lo que sí hace', () => {
  test('recibir mercancía, contar y registrar mermas dependen de cada permiso', async () => {
    const mov = (uid: string, type: string, qty: number, reason = 'x') =>
      one(uid, `select public.record_inventory_movement($1, $2::movement_type, $3, $4, 0.09) as r`, [ids.ron, type, qty, reason]);
    await mov(SUP, 'purchase', 1000);
    await mov(SUP, 'adjustment', -50, 'Conteo');
    await mov(SUP, 'waste', 20, 'Se cayó');
    await assert.rejects(mov(SUP0, 'purchase', 1), /forbidden/);
    await assert.rejects(mov(SUP0, 'adjustment', 1), /forbidden/);
    await assert.rejects(mov(SUP0, 'waste', 1), /forbidden/);
    // Permisos sueltos: sólo recibir, sin contar.
    await root(`update profiles set permissions = '{inventory.receive}' where id = $1`, [SUP0]);
    await mov(SUP0, 'purchase', 1);
    await assert.rejects(mov(SUP0, 'adjustment', 1), /forbidden/);
    await root(`update profiles set permissions = '{}' where id = $1`, [SUP0]);
    // Los demás roles: igual que antes (caja registra mermas; un mesero no ajusta aunque tenga la casilla).
    await mov(CASHIER, 'waste', 5, 'Vencido');
    await assert.rejects(mov(WAITER, 'adjustment', 1), /forbidden/);
    await assert.rejects(mov(WAITER, 'purchase', 1), /forbidden/);
    await assert.rejects(mov(CASHIER, 'purchase', 1), /forbidden/);
    const stock = Number((await one<{ s: string }>(ADMIN, `select stock_quantity as s from ingredients`)).s);
    assert.equal(stock, 5000 - 180 + 1000 - 50 - 20 + 1 - 5); // 180 ml: los 3 mojitos de los pedidos de ejemplo
  });

  test('proveedores y compras: sólo con su permiso, y sólo las columnas de compra del insumo', async () => {
    const s2 = await one<{ id: string }>(SUP, `insert into suppliers (name) values ('Carnes Don Pepe') returning id`);
    assert.ok(s2.id);
    await assert.rejects(as(SUP0, `insert into suppliers (name) values ('X')`), /row-level security/);
    await as(SUP, `update ingredients set supplier_id = $1, pack_size = 750, pack_label = 'Botella 750 ml', min_stock = 1500`, [ids.sup]);
    // El costo, el stock y el nombre no se tocan directamente.
    for (const sql of [`update ingredients set cost_per_unit = 1`, `update ingredients set stock_quantity = 99999`, `update ingredients set name = 'Otro'`, `update ingredients set unit = 'g'`]) {
      await assert.rejects(as(SUP, sql), /forbidden/, sql);
    }
    await assert.rejects(as(SUP, `delete from ingredients`), /./).catch(() => undefined);
    assert.equal(await count(ADMIN, 'ingredients'), 1);
    await as(SUP, `insert into purchase_suggestions (trigger, horizon_days, coverage_from, coverage_to, history_days, lines, notes, total_estimated) values ('manual', 7, now()::date, now()::date, 56, '[]', '[]', 0)`);
    await assert.rejects(as(SUP0, `insert into purchase_suggestions (trigger, horizon_days, coverage_from, coverage_to, history_days, lines, notes, total_estimated) values ('manual', 7, now()::date, now()::date, 56, '[]', '[]', 0)`), /row-level security/);
    // El plan del Comprador (lee consumo) sólo con purchasing.use.
    await one(SUP, `select public.get_purchase_inputs($1) as r`, [ids.tenant]);
    await assert.rejects(one(SUP0, `select public.get_purchase_inputs($1) as r`, [ids.tenant]), /forbidden/);
    // Los horarios del Comprador siguen siendo del administrador.
    assert.equal(await count(SUP, 'agent_schedules'), 0);
  });

  test('apoyo en sala: toma pedidos y mueve cuentas, pero no cobra, no anula ni toca descuentos', async () => {
    const r = (await one<{ r: { order_id: string; total: number } }>(SUP, `select public.submit_order($1, $2::jsonb) as r`, [ids.t3, JSON.stringify([{ product_id: ids.mojito, quantity: 1 }])])).r;
    assert.equal(r.total, 25000);
    const wid = (await one<{ w: string }>(ADMIN, `select waiter_id as w from orders where id = $1`, [r.order_id])).w;
    assert.equal(wid, SUP);
    await one(SUP, `select public.transfer_order($1, $2) as r`, [r.order_id, ids.t1]);
    await assert.rejects(as(SUP, `select public.register_payments($1, 'full', $2::jsonb)`, [r.order_id, JSON.stringify([{ amount: 25000, method: 'cash' }])]), /forbidden/);
    await assert.rejects(as(SUP, `select public.cancel_order($1, 'x')`, [r.order_id]), /forbidden/);
    await assert.rejects(as(SUP, `update orders set discount_type = 'percent', discount_value = 50 where id = $1`, [r.order_id]), /forbidden|row-level|discount/);
    await assert.rejects(as(SUP, `select public.open_cash_session(0)`), /forbidden/);
    // Sin el permiso de pedidos no puede ni abrir una cuenta.
    await assert.rejects(as(SUP0, `select public.submit_order($1, $2::jsonb)`, [ids.t3, JSON.stringify([{ product_id: ids.mojito }])]), /forbidden/);
    // Se devuelve la mesa para no afectar otras pruebas.
    await root(`delete from orders where id = $1`, [r.order_id]);
  });
});

describe('supervisor: quién cambia los permisos', () => {
  test('sólo el administrador; un supervisor no puede darse más permisos ni cambiar su rol', async () => {
    await as(SUP0, `update profiles set permissions = '{inventory.view}' where id = $1`, [SUP0]);
    assert.deepEqual((await root(`select permissions from profiles where id = $1`, [SUP0]))[0], { permissions: [] });
    await as(SUP, `update profiles set role = 'admin' where id = $1`, [SUP]);
    assert.equal((await root<{ role: string }>(`select role from profiles where id = $1`, [SUP]))[0]!.role, 'supervisor');
    await as(ADMIN, `update profiles set permissions = '{inventory.view}' where id = $1`, [SUP0]);
    assert.equal(await count(SUP0, 'ingredients'), 1);
    await as(ADMIN, `update profiles set permissions = '{}' where id = $1`, [SUP0]);
  });

  test('sólo se aceptan permisos de la lista', async () => {
    await assert.rejects(root(`update profiles set permissions = '{ver.todo}' where id = $1`, [SUP0]), /profiles_permissions_valid/);
    await assert.rejects(root(`update profiles set permissions = '{ventas.ver}' where id = $1`, [SUP0]), /profiles_permissions_valid/);
  });

  test('un supervisor desactivado pierde todo', async () => {
    await root(`update profiles set is_active = false where id = $1`, [SUP]);
    assert.equal(await count(SUP, 'ingredients'), 0);
    await assert.rejects(one(SUP, `select public.record_inventory_movement($1, 'purchase', 1, 'x', 0.1)`, [ids.ron]), /not_authenticated|forbidden/);
    await root(`update profiles set is_active = true where id = $1`, [SUP]);
  });
});
