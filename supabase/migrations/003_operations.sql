-- =============================================================================
-- 003 · Operación: caja (apertura / cierre / reporte Z), claves API para
-- agentes, menú QR público, datos de recibo e imágenes de productos.
-- Ejecutar en el SQL Editor sobre una base que ya tenga schema.sql + 002.
-- (schema.sql ya incluye este archivo para instalaciones nuevas.)
-- =============================================================================

-- ─── 1. Datos del negocio para recibos y menú público ──────────────────────────
alter table public.tenants add column if not exists tax_id              text;
alter table public.tenants add column if not exists address             text;
alter table public.tenants add column if not exists phone               text;
alter table public.tenants add column if not exists receipt_footer      text;
alter table public.tenants add column if not exists public_menu_enabled boolean not null default true;

-- ─── 2. Claves API de larga duración para agentes de IA ───────────────────────
-- Sólo se guarda el hash SHA-256 de la clave; la clave completa se muestra una vez.
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  profile_id   uuid not null,
  name         text not null check (char_length(name) between 1 and 80),
  key_prefix   text not null,
  key_hash     text not null unique,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  foreign key (tenant_id, profile_id) references public.profiles (tenant_id, id) on delete cascade
);
create index if not exists api_keys_tenant_idx on public.api_keys (tenant_id, created_at desc);

create or replace function private.before_api_key_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles
                  where id = new.profile_id and tenant_id = new.tenant_id and role = 'ai_agent' and is_active) then
    raise exception 'api_key_requires_ai_agent' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists api_keys_00_set_tenant on public.api_keys;
create trigger api_keys_00_set_tenant before insert on public.api_keys
  for each row execute function private.set_tenant_id();
drop trigger if exists api_keys_before_insert on public.api_keys;
create trigger api_keys_before_insert before insert on public.api_keys
  for each row execute function private.before_api_key_insert();

alter table public.api_keys enable row level security;
drop policy if exists api_keys_admin on public.api_keys;
create policy api_keys_admin on public.api_keys
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- ─── 3. Caja: sesiones, movimientos y reporte Z ─────────────────────────────────
create table if not exists public.cash_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  opened_by     uuid default auth.uid(),
  opened_at     timestamptz not null default now(),
  opening_float numeric(12, 2) not null default 0 check (opening_float >= 0),
  closed_by     uuid,
  closed_at     timestamptz,
  counted_cash  numeric(12, 2),
  expected_cash numeric(12, 2),
  difference    numeric(12, 2),
  notes         text,
  report        jsonb,
  unique (tenant_id, id)
);
-- Una sola caja abierta por gastrobar.
create unique index if not exists cash_sessions_one_open on public.cash_sessions (tenant_id) where closed_at is null;
create index if not exists cash_sessions_tenant_idx on public.cash_sessions (tenant_id, opened_at desc);

create table if not exists public.cash_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  session_id    uuid not null,
  movement_type text not null check (movement_type in ('in', 'out')),
  amount        numeric(12, 2) not null check (amount > 0),
  reason        text not null check (char_length(reason) between 1 and 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, session_id) references public.cash_sessions (tenant_id, id) on delete cascade
);
create index if not exists cash_movements_session_idx on public.cash_movements (tenant_id, session_id);

alter table public.cash_sessions  enable row level security;
alter table public.cash_movements enable row level security;
drop policy if exists cash_sessions_select on public.cash_sessions;
create policy cash_sessions_select on public.cash_sessions
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'cashier')));
drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'cashier')));
-- Escrituras sólo vía las funciones de abajo.

-- Reporte de una sesión hasta p_until (en vivo o de cierre).
create or replace function private.cash_report(p_session public.cash_sessions, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with pay as (
    select p.* from public.payments p
     where p.tenant_id = p_session.tenant_id
       and p.created_at >= p_session.opened_at and p.created_at < p_until
  ),
  mov as (
    select m.* from public.cash_movements m where m.session_id = p_session.id
  ),
  totals as (
    select
      coalesce((select sum(amount) from pay), 0)                               as sales,
      coalesce((select sum(tip) from pay), 0)                                  as tips,
      coalesce((select sum(amount) from pay where method = 'cash'), 0)         as cash_sales,
      coalesce((select sum(tip) from pay where method = 'cash'), 0)            as cash_tips,
      coalesce((select sum(amount) from mov where movement_type = 'in'), 0)    as cash_in,
      coalesce((select sum(amount) from mov where movement_type = 'out'), 0)   as cash_out
  )
  select jsonb_build_object(
    'from', p_session.opened_at,
    'to', p_until,
    'opening_float', p_session.opening_float,
    'sales', t.sales,
    'tips', t.tips,
    'payments_count', (select count(*) from pay),
    'orders_paid', (select count(*) from public.orders o
                     where o.tenant_id = p_session.tenant_id and o.status = 'paid'
                       and o.closed_at >= p_session.opened_at and o.closed_at < p_until),
    'orders_cancelled', (select count(*) from public.orders o
                          where o.tenant_id = p_session.tenant_id and o.status = 'cancelled'
                            and o.closed_at >= p_session.opened_at and o.closed_at < p_until),
    'by_method', (select coalesce(jsonb_object_agg(method, jsonb_build_object('amount', amount, 'tips', tips, 'count', n)), '{}'::jsonb)
                    from (select method, sum(amount) as amount, sum(tip) as tips, count(*) as n from pay group by method) s),
    'cash_sales', t.cash_sales,
    'cash_tips', t.cash_tips,
    'cash_in', t.cash_in,
    'cash_out', t.cash_out,
    'expected_cash', p_session.opening_float + t.cash_sales + t.cash_tips + t.cash_in - t.cash_out,
    'movements', (select coalesce(jsonb_agg(jsonb_build_object('type', movement_type, 'amount', amount, 'reason', reason, 'at', created_at)
                                            order by created_at), '[]'::jsonb) from mov)
  )
  from totals t
$$;

create or replace function public.open_cash_session(p_opening_float numeric default 0)
returns public.cash_sessions language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session public.cash_sessions;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.cash_sessions where tenant_id = v_tenant and closed_at is null) then
    raise exception 'cash_session_already_open' using errcode = '23505';
  end if;
  insert into public.cash_sessions (tenant_id, opening_float, opened_by)
  values (v_tenant, coalesce(p_opening_float, 0), auth.uid())
  returning * into v_session;
  return v_session;
end $$;

create or replace function public.add_cash_movement(p_type text, p_amount numeric, p_reason text)
returns public.cash_movements language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session uuid;
  v_row     public.cash_movements;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select id into v_session from public.cash_sessions where tenant_id = v_tenant and closed_at is null;
  if v_session is null then
    raise exception 'cash_session_not_open' using errcode = 'P0002';
  end if;
  insert into public.cash_movements (tenant_id, session_id, movement_type, amount, reason, created_by)
  values (v_tenant, v_session, p_type, p_amount, trim(p_reason), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- Sesión abierta (p_session_id null) o una específica, con su reporte.
create or replace function public.get_cash_session(p_session_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session public.cash_sessions;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_session_id is null then
    select * into v_session from public.cash_sessions where tenant_id = v_tenant and closed_at is null;
  else
    select * into v_session from public.cash_sessions where tenant_id = v_tenant and id = p_session_id;
  end if;
  if v_session.id is null then
    return null;
  end if;
  return to_jsonb(v_session) || jsonb_build_object(
    'report', coalesce(v_session.report, private.cash_report(v_session, now())));
end $$;

create or replace function public.close_cash_session(p_counted_cash numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session public.cash_sessions;
  v_now     timestamptz := now();
  v_report  jsonb;
  v_expect  numeric;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  select * into v_session from public.cash_sessions
   where tenant_id = v_tenant and closed_at is null for update;
  if v_session.id is null then
    raise exception 'cash_session_not_open' using errcode = 'P0002';
  end if;

  v_report := private.cash_report(v_session, v_now);
  v_expect := (v_report ->> 'expected_cash')::numeric;

  update public.cash_sessions
     set closed_at = v_now, closed_by = auth.uid(), counted_cash = p_counted_cash,
         expected_cash = v_expect, difference = p_counted_cash - v_expect,
         notes = nullif(trim(p_notes), ''), report = v_report
   where id = v_session.id
  returning * into v_session;

  return to_jsonb(v_session);
end $$;

-- ─── 4. Menú público (QR) ─────────────────────────────────────────────────────
create or replace function public.get_public_menu(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'slug', t.slug, 'currency', t.currency, 'locale', t.locale,
                                 'address', t.address, 'phone', t.phone),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'station', c.station)
                                order by c.sort_order, c.name), '[]'::jsonb)
        from public.categories c
       where c.tenant_id = t.id and c.is_active
         and exists (select 1 from public.products p where p.category_id = c.id and p.is_active)),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', pa.product_id, 'category_id', pa.category_id, 'name', pa.name,
               'description', pa.description, 'price', pa.price, 'image_url', pa.image_url,
               'available', pa.is_available) order by pa.sort_order, pa.name), '[]'::jsonb)
        from public.product_availability pa
       where pa.tenant_id = t.id and pa.is_active),
    'modifiers', (
      select coalesce(jsonb_agg(jsonb_build_object('product_id', m.product_id, 'category_id', m.category_id,
                                                   'name', m.name, 'price_delta', m.price_delta)
                                order by m.sort_order, m.name), '[]'::jsonb)
        from public.modifiers m
       where m.tenant_id = t.id and m.is_active and m.price_delta <> 0)
  )
  from public.tenants t
  where t.slug = lower(p_slug) and t.public_menu_enabled
$$;

-- ─── 5. Privilegios ────────────────────────────────────────────────────────────
revoke all on function private.before_api_key_insert() from public, anon, authenticated;
revoke all on function private.cash_report(public.cash_sessions, timestamptz) from public, anon, authenticated;

revoke execute on function public.open_cash_session(numeric)              from public, anon;
revoke execute on function public.add_cash_movement(text, numeric, text)  from public, anon;
revoke execute on function public.get_cash_session(uuid)                  from public, anon;
revoke execute on function public.close_cash_session(numeric, text)       from public, anon;
grant execute on function public.open_cash_session(numeric)               to authenticated;
grant execute on function public.add_cash_movement(text, numeric, text)   to authenticated;
grant execute on function public.get_cash_session(uuid)                   to authenticated;
grant execute on function public.close_cash_session(numeric, text)        to authenticated;
grant execute on function public.get_public_menu(text)                    to anon, authenticated;

-- ─── 6. Storage: imágenes de productos (carpeta por tenant) ─────────────────────
do $$
begin
  if to_regclass('storage.buckets') is null then
    return; -- entorno sin Supabase Storage (p. ej. pruebas locales)
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  drop policy if exists product_images_admin_insert on storage.objects;
  drop policy if exists product_images_admin_update on storage.objects;
  drop policy if exists product_images_admin_delete on storage.objects;

  create policy product_images_admin_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'product-images'
                and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
                and (select private.has_role('admin')));
  create policy product_images_admin_update on storage.objects
    for update to authenticated
    using (bucket_id = 'product-images'
           and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
           and (select private.has_role('admin')));
  create policy product_images_admin_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'product-images'
           and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
           and (select private.has_role('admin')));
end $$;
