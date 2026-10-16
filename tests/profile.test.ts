/**
 * Datos del usuario y logo del negocio (migración 028): cada quien actualiza lo suyo, el administrador lo de su
 * equipo, y nadie puede usar esto para cambiarse el rol, los permisos o apuntar la foto a otra dirección.
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
const ADMIN = '33333333-0000-0000-0000-000000000001';
const WAITER = '33333333-0000-0000-0000-000000000002';
const OTHER = '33333333-0000-0000-0000-000000000003';
const db = new PGlite();
let tenant = '';

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const one = async <T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) => (await as<T>(uid, sql, params))[0]!;
const root = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  return (await db.query<T>(sql, params)).rows;
};
const avatar = (uid: string, file = 'a.webp') => `https://x.supabase.co/storage/v1/object/public/avatars/${tenant}/${uid}/${file}`;

before(async () => {
  await db.exec(STUBS);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${ADMIN}'), ('${WAITER}'), ('${OTHER}')`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
  tenant = (await db.query<{ id: string }>(`select public.create_tenant('Bar P', 'bar-p', 'Dueña') as id`)).rows[0]!.id;
  await db.exec(`insert into public.profiles (id, tenant_id, role, full_name) values ('${WAITER}', '${tenant}', 'waiter', 'Walter')`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${OTHER}', false)`);
  await db.query(`select public.create_tenant('Bar Q', 'bar-q', 'Beto')`);
});

describe('mis datos', () => {
  test('cada quien actualiza su nombre, teléfono y foto, sin tocar su rol ni su estado', async () => {
    const p = await one<{ full_name: string; phone: string; avatar_url: string; role: string }>(
      WAITER,
      `select * from public.update_my_profile('Walter Pérez', '+57 300 123 4567', $1)`,
      [avatar(WAITER)],
    );
    assert.deepEqual([p.full_name, p.phone, p.avatar_url, p.role], ['Walter Pérez', '+57 300 123 4567', avatar(WAITER), 'waiter']);
    // Lo que no se envía no se toca.
    const again = await one<{ phone: string; avatar_url: string }>(WAITER, `select * from public.update_my_profile('Walter Pérez')`);
    assert.deepEqual([again.phone, again.avatar_url], ['+57 300 123 4567', avatar(WAITER)]);
    // Quitar el teléfono y la foto.
    const cleared = await one<{ phone: string | null; avatar_url: string | null }>(WAITER, `select * from public.update_my_profile(null, null, null, true, true)`);
    assert.deepEqual([cleared.phone, cleared.avatar_url], [null, null]);
  });

  test('valida el nombre, el teléfono y que la foto esté en la carpeta propia', async () => {
    await assert.rejects(as(WAITER, `select public.update_my_profile('A')`), /invalid_name/);
    await assert.rejects(as(WAITER, `select public.update_my_profile('   ')`), /invalid_name/);
    await assert.rejects(as(WAITER, `select public.update_my_profile(null, 'llámame')`), /profiles_phone_valid/);
    await assert.rejects(as(WAITER, `select public.update_my_profile(null, '123')`), /profiles_phone_valid/);
    await assert.rejects(as(WAITER, `select public.update_my_profile(null, null, 'https://malo.com/foto.png')`), /invalid_avatar/);
    // La foto de otra persona del mismo negocio tampoco sirve.
    await assert.rejects(as(WAITER, `select public.update_my_profile(null, null, $1)`, [avatar(ADMIN)]), /invalid_avatar/);
    // Ni la carpeta de otro negocio.
    await assert.rejects(
      as(WAITER, `select public.update_my_profile(null, null, $1)`, [`https://x.supabase.co/storage/v1/object/public/avatars/${OTHER}/${WAITER}/a.webp`]),
      /invalid_avatar/,
    );
  });

  test('no sirve para ganar poder: el rol, los permisos y el estado siguen siendo del administrador', async () => {
    await as(WAITER, `select public.update_my_profile('Walter Pérez')`);
    const p = await root<{ role: string; is_active: boolean; permissions: string[] }>(`select role, is_active, permissions from profiles where id = $1`, [WAITER]);
    assert.deepEqual(p[0], { role: 'waiter', is_active: true, permissions: [] });
    // Y por la vía directa tampoco puede editar su perfil.
    await as(WAITER, `update profiles set role = 'admin', phone = '3001234567' where id = $1`, [WAITER]);
    assert.equal((await root<{ role: string }>(`select role from profiles where id = $1`, [WAITER]))[0]!.role, 'waiter');
    await assert.rejects(as(null, `select public.update_my_profile('Anónimo')`), /permission denied|not_authenticated/);
  });

  test('el cambio de nombre queda en la auditoría, a nombre de quien lo hizo', async () => {
    await as(WAITER, `select public.update_my_profile('Walter P.')`);
    const e = (await root<{ details: { from: string; to: string }; actor_name: string; severity: string }>(
      `select details, actor_name, severity from audit_log where action = 'staff.renamed' order by at desc limit 1`,
    ))[0]!;
    assert.deepEqual([e.details.from, e.details.to, e.severity], ['Walter Pérez', 'Walter P.', 'important']);
    assert.equal(e.actor_name, 'Walter P.');
  });
});

describe('administrador y logo', () => {
  test('el administrador edita los datos de su equipo, sólo del suyo', async () => {
    await as(ADMIN, `update profiles set full_name = 'Walter Mesero', phone = '3109998877' where id = $1`, [WAITER]);
    assert.equal((await root<{ phone: string }>(`select phone from profiles where id = $1`, [WAITER]))[0]!.phone, '3109998877');
    // El administrador de otro negocio no puede.
    await as(OTHER, `update profiles set full_name = 'Hackeado' where id = $1`, [WAITER]);
    assert.equal((await root<{ full_name: string }>(`select full_name from profiles where id = $1`, [WAITER]))[0]!.full_name, 'Walter Mesero');
  });

  test('el logo lo cambia sólo el administrador y aparece en el menú público', async () => {
    const logo = `https://x.supabase.co/storage/v1/object/public/product-images/${tenant}/branding/logo.webp`;
    await as(WAITER, `update tenants set logo_url = $1`, [logo]);
    assert.equal((await root<{ logo_url: string | null }>(`select logo_url from tenants where id = $1`, [tenant]))[0]!.logo_url, null);
    await as(ADMIN, `update tenants set logo_url = $1, public_menu_enabled = true`, [logo]);
    const menu = await one<{ m: { tenant: { logo_url: string; name: string } } }>(null, `select public.get_public_menu('bar-p') as m`);
    assert.deepEqual([menu.m.tenant.logo_url, menu.m.tenant.name], [logo, 'Bar P']);
    await as(ADMIN, `update tenants set logo_url = null`);
    assert.equal((await one<{ m: { tenant: { logo_url: string | null } } }>(null, `select public.get_public_menu('bar-p') as m`)).m.tenant.logo_url, null);
  });
});
