/**
 * Auditoría de aislamiento multi-tenant (PGlite).
 *
 * Construye dos gastrobares completos (A y B) con datos en TODAS las tablas y
 * ataca desde cada rol de B contra A: lectura, escritura, clonación de filas,
 * mover filas de dueño, funciones del sistema con IDs ajenos y referencias
 * cruzadas. La lista de tablas sale del catálogo de Postgres: una tabla nueva con
 * tenant_id queda cubierta sin tocar esta prueba.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const ROLES = ['admin', 'cashier', 'waiter', 'kitchen', 'bar', 'ai_agent'] as const;
type Role = (typeof ROLES)[number];
type Tenant = {
  id: string;
  slug: string;
  users: Record<Role, string>;
  zone: string;
  table: string;
  category: string;
  product: string;
  ingredient: string;
  subRecipe: string;
  modifier: string;
  paidOrder: string;
  openOrder: string;
  orderItem: string;
  payment: string;
  cashSession: string;
  einvoiceDoc: string;
};

const uid = (n: number, t: number) => `${String(t).repeat(8)}-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function asUser<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(
    user
      ? `reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`
      : `reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`,
  );
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('reset role');
  }
}
const rows = async <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
  (await asUser<T>(user, sql, params)).rows;
const first = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => (await rows<T>(user, sql, params))[0]!;
const superuser = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  return (await db.query<T>(sql, params)).rows;
};

async function seedTenant(n: number, slug: string): Promise<Tenant> {
  const users = Object.fromEntries(ROLES.map((r, i) => [r, uid(i + 1, n)])) as Record<Role, string>;
  await db.exec(`insert into auth.users values ${ROLES.map((r) => `('${users[r]}')`).join(',')}`);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${users.admin}', false);`);
  const id = (await db.query<{ id: string }>(`select public.create_tenant($1, $2, 'Dueño') as id`, [`Bar ${slug}`, slug])).rows[0]!.id;
  for (const r of ROLES.filter((r) => r !== 'admin')) {
    await superuser(`insert into public.profiles (id, tenant_id, role, full_name) values ($1, $2, $3, $4)`, [users[r], id, r, `${r} ${slug}`]);
  }
  const A = users.admin;
  const one = async (sql: string, params: unknown[] = []) => (await first<{ id: string }>(A, sql, params)).id;

  const zone = await one(`insert into zones (name) values ('Salón') returning id`);
  const table = await one(`insert into tables (zone_id, label) values ($1, 'M1') returning id`, [zone]);
  const category = await one(`insert into categories (name, station) values ('Cócteles', 'bar') returning id`);
  const ingredient = await one(`insert into ingredients (name, unit, stock_quantity, cost_per_unit, min_stock) values ('Ron', 'ml', 5000, 0.08, 100) returning id`);
  const subRecipe = await one(`insert into sub_recipes (name, yield_quantity, yield_unit) values ('Jarabe', 1000, 'ml') returning id`);
  await rows(A, `insert into sub_recipe_ingredients (sub_recipe_id, ingredient_id, quantity) values ($1, $2, 500)`, [subRecipe, ingredient]);
  const product = await one(`insert into products (category_id, name, price) values ($1, 'Mojito', 20000) returning id`, [category]);
  await rows(A, `insert into recipes (product_id, ingredient_id, quantity) values ($1, $2, 60)`, [product, ingredient]);
  await rows(A, `insert into recipes (product_id, sub_recipe_id, quantity) values ($1, $2, 20)`, [product, subRecipe]);
  const modifier = await one(`insert into modifiers (product_id, name, price_delta) values ($1, 'Doble', 5000) returning id`, [product]);
  await rows(A, `select public.record_inventory_movement($1, 'purchase', 1000, 'Compra', 0.08)`, [ingredient]);

  await superuser(`update public.tenants set einvoice_enabled = true, einvoice_provider = 'simulator' where id = $1`, [id]);
  await superuser(`insert into public.einvoice_credentials (tenant_id, provider, encrypted_config) values ($1, 'simulator', 'x')`, [id]);

  await rows(users.cashier, `select public.open_cash_session(100000)`);
  const cashSession = (await first<{ id: string }>(A, `select id from cash_sessions`)).id;
  await rows(users.cashier, `select public.add_cash_movement('in', 5000, 'Base extra')`);

  const submit = async (items: unknown[]) =>
    (await first<{ r: { order_id: string } }>(users.waiter, `select public.submit_order($1, $2::jsonb) as r`, [table, JSON.stringify(items)])).r.order_id;
  const paidOrder = await submit([{ product_id: product, quantity: 2, modifier_ids: [modifier] }]);
  const item = await first<{ id: string; line_total: string }>(users.waiter, `select id, line_total from order_items where order_id = $1`, [paidOrder]);
  await rows(users.cashier, `select public.register_payments($1, 'by_item', $2::jsonb)`, [
    paidOrder,
    JSON.stringify([{ amount: Number(item.line_total), method: 'card', allocations: [{ order_item_id: item.id, amount: Number(item.line_total) }] }]),
  ]);
  const payment = (await first<{ id: string }>(A, `select id from payments where order_id = $1`, [paidOrder])).id;
  const einvoiceDoc = (await first<{ id: string }>(A, `select id from einvoice_documents where order_id = $1`, [paidOrder])).id;
  const openOrder = await submit([{ product_id: product, quantity: 1 }]);
  await rows(users.waiter, `select public.set_billing_customer($1, $2::jsonb)`, [
    openOrder,
    JSON.stringify({ id_type: 'CC', id_number: `1000${n}`, name: 'Cliente', email: 'c@x.co' }),
  ]);

  await rows(A, `insert into api_keys (profile_id, name, key_prefix, key_hash) values ($1, 'Agente', 'gbk_${slug}', 'hash_${slug}')`, [users.ai_agent]);
  await rows(A, `insert into suppliers (name, phone, lead_time_days) values ('Licores ${slug}', '573000000000', 2)`);
  await rows(A, `update ingredients set supplier_id = (select id from suppliers limit 1), pack_size = 750 where id = $1`, [ingredient]);
  await rows(A, `insert into agent_schedules (agent, is_active, frequency, hour) values ('purchase', true, 'weekly', 7)`);
  await rows(A, `insert into purchase_suggestions (horizon_days, coverage_from, coverage_to, history_days, lines) values (7, current_date, current_date + 7, 56, '[]')`);
  await rows(A, `insert into messenger_settings (emails) values ('{dueno@${slug}.co}')`);
  await rows(A, `insert into messenger_deliveries (recipients, subject, status) values ('{dueno@${slug}.co}', 'Resumen', 'sent')`);
  await rows(A, `insert into ai_reports (period_from, period_to, model, facts_hash, facts, content) values (now() - interval '7 days', now(), 'm', 'h', '[]', '{}')`);
  await rows(A, `insert into ai_usage (feature, model, cost_usd) values ('analyst_report', 'm', 0.02)`);
  await superuser(`insert into public.tenant_ai_plans (tenant_id, plan) values ($1, 'pro')`, [id]);
  await rows(A, `insert into terminal_devices (name, token_hash) values ('Tablet salón', 'th_${slug}')`);
  await superuser(`insert into public.staff_pins (profile_id, tenant_id, pin_hash) values ($1, $2, 'scrypt$1$x$y')`, [users.waiter, id]);
  await superuser(`insert into public.tenant_agents (tenant_id, agent, enabled) values ($1, 'vigia', true), ($1, 'comprador', true)`, [id]);

  return {
    id, slug, users, zone, table, category, product, ingredient, subRecipe, modifier,
    paidOrder, openOrder, orderItem: item.id, payment, cashSession, einvoiceDoc,
  };
}

let A: Tenant;
let B: Tenant;
let tenantTables: string[] = [];

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  A = await seedTenant(1, 'bar-a');
  B = await seedTenant(2, 'bar-b');
  tenantTables = (
    await superuser<{ t: string }>(
      `select c.table_name as t from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
        order by 1`,
    )
  ).map((r) => r.t);
});

const countFor = async (table: string, tenant: string) =>
  Number((await superuser<{ c: string }>(`select count(*) as c from public.${table} where tenant_id = $1`, [tenant]))[0]!.c);

describe('aislamiento multi-tenant', () => {
  test('el escenario cubre todas las tablas con datos en ambos gastrobares', async () => {
    // 31 tablas en total; tenants y platform_admins no llevan tenant_id y se prueban aparte.
    assert.ok(tenantTables.length >= 29, `se esperaban al menos 29 tablas con tenant_id, hay ${tenantTables.length}`);
    const missing: string[] = [];
    for (const t of tenantTables) {
      if ((await countFor(t, A.id)) === 0 || (await countFor(t, B.id)) === 0) missing.push(t);
    }
    assert.deepEqual(missing, [], `tablas sin datos en algún gastrobar: ${missing.join(', ')}`);
  });

  test('ningún rol de B puede leer una sola fila de A, en ninguna tabla', async () => {
    const leaks: string[] = [];
    for (const role of ROLES) {
      for (const t of tenantTables) {
        const r = await rows<{ c: string }>(B.users[role], `select count(*) as c from public.${t} where tenant_id = $1`, [A.id]).catch(() => [{ c: '0' }]);
        if (Number(r[0]!.c) > 0) leaks.push(`${role} → ${t} (${r[0]!.c})`);
      }
      const tenants = await rows<{ id: string }>(B.users[role], `select id from public.tenants`);
      if (tenants.some((x) => x.id === A.id)) leaks.push(`${role} → tenants`);
      const profiles = await rows<{ c: string }>(B.users[role], `select count(*) as c from public.profiles where tenant_id = $1`, [A.id]);
      if (Number(profiles[0]!.c) > 0) leaks.push(`${role} → profiles`);
    }
    assert.deepEqual(leaks, []);
  });

  test('un visitante anónimo no lee ninguna tabla', async () => {
    const leaks: string[] = [];
    for (const t of [...tenantTables, 'tenants', 'platform_admins']) {
      const r = await rows<{ c: string }>(null, `select count(*) as c from public.${t}`).catch(() => [{ c: '0' }]);
      if (Number(r[0]!.c) > 0) leaks.push(t);
    }
    assert.deepEqual(leaks, []);
  });

  test('ningún rol de B puede modificar ni borrar filas de A', async () => {
    const before = Object.fromEntries(await Promise.all(tenantTables.map(async (t) => [t, await countFor(t, A.id)] as const)));
    const touched: string[] = [];
    for (const role of ROLES) {
      for (const t of tenantTables) {
        const upd = await asUser(B.users[role], `update public.${t} set tenant_id = tenant_id where tenant_id = $1`, [A.id]).catch(() => null);
        if (upd?.affectedRows) touched.push(`${role} update ${t} (${upd.affectedRows})`);
        const del = await asUser(B.users[role], `delete from public.${t} where tenant_id = $1`, [A.id]).catch(() => null);
        if (del?.affectedRows) touched.push(`${role} delete ${t} (${del.affectedRows})`);
      }
    }
    assert.deepEqual(touched, []);
    for (const t of tenantTables) assert.equal(await countFor(t, A.id), before[t], `cambiaron las filas de A en ${t}`);
  });

  test('B no puede crear filas a nombre de A (clonando cualquier fila de A)', async () => {
    const accepted: string[] = [];
    for (const t of tenantTables) {
      const sample = await superuser<{ j: Record<string, unknown> }>(`select to_jsonb(r) as j from public.${t} r where tenant_id = $1 limit 1`, [A.id]);
      const json = { ...sample[0]!.j };
      if ('id' in json) json.id = crypto.randomUUID();
      const beforeCount = await countFor(t, A.id);
      const res = await asUser(B.users.admin, `insert into public.${t} select (jsonb_populate_record(null::public.${t}, $1::jsonb)).*`, [JSON.stringify(json)]).catch(
        () => null,
      );
      if (res || (await countFor(t, A.id)) !== beforeCount) accepted.push(t);
    }
    assert.deepEqual(accepted, []);
  });

  test('B no puede mover sus propias filas al gastrobar A', async () => {
    const moved: string[] = [];
    for (const role of ROLES) {
      for (const t of tenantTables) {
        const beforeA = await countFor(t, A.id);
        await asUser(B.users[role], `update public.${t} set tenant_id = $1 where tenant_id = $2`, [A.id, B.id]).catch(() => null);
        if ((await countFor(t, A.id)) !== beforeA) moved.push(`${role} → ${t}`);
      }
    }
    assert.deepEqual(moved, []);
  });
});

describe('funciones del sistema con IDs de otro gastrobar', () => {
  const rejects = (user: string, sql: string, params: unknown[] = []) =>
    assert.rejects(rows(user, sql, params), `debió rechazarse: ${sql}`);

  test('comandas: no se usan mesas, productos ni modificadores ajenos', async () => {
    await rejects(B.users.waiter, `select public.submit_order($1, $2::jsonb)`, [A.table, JSON.stringify([{ product_id: B.product, quantity: 1 }])]);
    await rejects(B.users.waiter, `select public.submit_order(null, $1::jsonb)`, [JSON.stringify([{ product_id: A.product, quantity: 1 }])]);
    await rejects(B.users.waiter, `select public.submit_order(null, $1::jsonb)`, [
      JSON.stringify([{ product_id: B.product, quantity: 1, modifier_ids: [A.modifier] }]),
    ]);
    await rejects(B.users.admin, `insert into order_items (order_id, product_id, quantity) values ($1, $2, 1)`, [A.openOrder, B.product]);
    await rejects(B.users.admin, `insert into order_items (order_id, product_id, quantity) values ($1, $2, 1)`, [B.openOrder, A.product]);
  });

  test('cobros y caja: no se paga, anula ni consulta nada ajeno', async () => {
    await rejects(B.users.cashier, `select public.register_payments($1, 'full', $2::jsonb)`, [A.openOrder, JSON.stringify([{ amount: 1000, method: 'card' }])]);
    await rejects(B.users.admin, `select public.void_payment($1, 'intento')`, [A.payment]);
    await rejects(B.users.waiter, `select public.set_billing_customer($1, $2::jsonb)`, [
      A.openOrder,
      JSON.stringify({ id_type: 'CC', id_number: '1', name: 'X', email: 'x@x.co' }),
    ]);
    const session = await first<{ s: unknown }>(B.users.cashier, `select public.get_cash_session($1) as s`, [A.cashSession]);
    assert.ok(!session.s || JSON.stringify(session.s).indexOf(A.cashSession) === -1, 'no debe devolver la caja de A');
    await rejects(B.users.admin, `insert into payment_allocations (payment_id, order_item_id, amount) values ($1, $2, 1)`, [A.payment, A.orderItem]);
    await rejects(B.users.admin, `insert into cash_movements (session_id, movement_type, amount, reason) values ($1, 'out', 1, 'x')`, [A.cashSession]);
  });

  test('inventario, catálogo y facturación: no se tocan recursos ajenos', async () => {
    await rejects(B.users.admin, `select public.record_inventory_movement($1, 'purchase', 10, 'x', null)`, [A.ingredient]);
    await rejects(B.users.admin, `select public.save_product(null, $1, 'Hackeo', null, 1000, true, true, 0, null, null)`, [A.category]);
    await rejects(B.users.admin, `select public.save_product(null, $1, 'Hackeo', null, 1000, true, true, 0, $2::jsonb, null)`, [
      B.category,
      JSON.stringify([{ ingredient_id: A.ingredient, quantity: 10 }]),
    ]);
    await rejects(B.users.admin, `select public.save_sub_recipe(null, 'Hackeo', 1000, 'ml', null, $1::jsonb)`, [
      JSON.stringify([{ ingredient_id: A.ingredient, quantity: 10 }]),
    ]);
    await rejects(B.users.admin, `insert into recipes (product_id, ingredient_id, quantity) values ($1, $2, 10)`, [B.product, A.ingredient]);
    await rejects(B.users.admin, `insert into products (category_id, name, price) values ($1, 'X', 1)`, [A.category]);
    await superuser(`update public.einvoice_documents set status = 'error' where id = $1`, [A.einvoiceDoc]);
    await rejects(B.users.admin, `select public.retry_einvoice_document($1)`, [A.einvoiceDoc]);
    const [doc] = await superuser<{ status: string }>(`select status from public.einvoice_documents where id = $1`, [A.einvoiceDoc]);
    assert.equal(doc!.status, 'error');
  });

  test('análisis y compras: no se piden datos de otro gastrobar', async () => {
    const range = [new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 60_000).toISOString()];
    await rejects(B.users.admin, `select public.get_purchase_inputs($1, 28)`, [A.id]);
    await rejects(B.users.admin, `select public.get_business_snapshot($1, $2, $3)`, [...range, A.id]);
    const own = await first<{ s: { kpis: { orders: number } } }>(B.users.admin, `select public.get_business_snapshot($1, $2) as s`, range);
    assert.equal(own.s.kpis.orders, 1, 'el resumen de B sólo cuenta sus ventas');
  });
});

describe('gastrobar suspendido', () => {
  test('sus usuarios no ven ni hacen nada, su menú público desaparece y el otro gastrobar sigue igual', async () => {
    await superuser(`update public.tenants set status = 'suspended' where id = $1`, [A.id]);
    try {
      for (const role of ROLES) {
        for (const t of tenantTables) {
          // Excepción de diseño: cada usuario ve su propio perfil (para mostrarle "cuenta suspendida").
          const filter = t === 'profiles' ? ` where id <> '${A.users[role]}'` : '';
          const r = await rows<{ c: string }>(A.users[role], `select count(*) as c from public.${t}${filter}`).catch(() => [{ c: '0' }]);
          assert.equal(Number(r[0]!.c), 0, `${role} de A suspendido aún ve ${t}`);
        }
        const [hasRole] = await rows<{ ok: boolean }>(A.users[role], `select private.has_role($1::public.app_role) as ok`, [role]);
        assert.equal(hasRole!.ok, false, `${role} de A suspendido conserva su rol`);
      }
      await assert.rejects(rows(A.users.waiter, `select public.submit_order($1, $2::jsonb)`, [A.table, JSON.stringify([{ product_id: A.product, quantity: 1 }])]));
      await assert.rejects(rows(A.users.cashier, `select public.open_cash_session(0)`));
      const [menuA] = await rows<{ m: unknown }>(null, `select public.get_public_menu($1) as m`, [A.slug]);
      assert.equal(menuA!.m, null, 'el menú público de un gastrobar suspendido no se muestra');
      const [menuB] = await rows<{ m: { tenant: { slug: string } } }>(null, `select public.get_public_menu($1) as m`, [B.slug]);
      assert.equal(menuB!.m.tenant.slug, B.slug);
      const [ownB] = await rows<{ c: string }>(B.users.admin, `select count(*) as c from public.products`);
      assert.equal(Number(ownB!.c), 1);
    } finally {
      await superuser(`update public.tenants set status = 'active' where id = $1`, [A.id]);
    }
    const [back] = await rows<{ c: string }>(A.users.admin, `select count(*) as c from public.products`);
    assert.equal(Number(back!.c), 1, 'al reactivar, A recupera todo');
  });
});

describe('terminales compartidas y PIN del personal', () => {
  test('nadie lee ni escribe los PIN con su sesión, ni siquiera el admin de su propio gastrobar', async () => {
    for (const role of ROLES) {
      await assert.rejects(rows(A.users[role], `select pin_hash from public.staff_pins`), `${role} leyó staff_pins`);
      await assert.rejects(
        rows(A.users[role], `insert into public.staff_pins (profile_id, tenant_id, pin_hash) values ($1, $2, 'x')`, [A.users.cashier, A.id]),
        `${role} insertó en staff_pins`,
      );
      await assert.rejects(rows(A.users[role], `update public.staff_pins set failed_attempts = 0`), `${role} actualizó staff_pins`);
    }
    await assert.rejects(rows(null, `select pin_hash from public.staff_pins`));
  });

  test('sólo el admin ve y revoca las terminales, y sólo las de su gastrobar', async () => {
    const [own] = await rows<{ c: string }>(A.users.admin, `select count(*) as c from public.terminal_devices`);
    assert.equal(Number(own!.c), 1);
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      const [r] = await rows<{ c: string }>(A.users[role], `select count(*) as c from public.terminal_devices`);
      assert.equal(Number(r!.c), 0, `${role} ve las terminales`);
      await assert.rejects(rows(A.users[role], `insert into public.terminal_devices (name, token_hash) values ('Pirata', 'th_pirata_${role}')`));
    }
    const revoked = await asUser(B.users.admin, `update public.terminal_devices set revoked_at = now() where tenant_id = $1`, [A.id]);
    assert.equal(revoked.affectedRows ?? 0, 0, 'B revocó una terminal de A');
    // El trigger fija el tenant del admin aunque intente declarar otro.
    const [row] = await rows<{ tenant_id: string }>(
      B.users.admin,
      `insert into public.terminal_devices (tenant_id, name, token_hash) values ($1, 'Intrusa', 'th_intrusa') returning tenant_id`,
      [A.id],
    ).catch(() => [{ tenant_id: B.id }]);
    assert.equal(row!.tenant_id, B.id);
  });
});
