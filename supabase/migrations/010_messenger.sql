-- =============================================================================
-- 010 · Mensajero (resumen por correo y WhatsApp) y resumen del negocio para
--       tareas programadas
--
-- get_business_snapshot acepta ahora p_tenant, sólo para el rol de servicio: así
-- el Mensajero programado arma el resumen sin sesión de usuario. Las llamadas
-- existentes (sin p_tenant) funcionan igual.
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- ─── Resumen del negocio también para el rol de servicio ───────────────────────
drop function if exists public.get_business_snapshot(timestamptz, timestamptz);
create or replace function public.get_business_snapshot(p_from timestamptz, p_to timestamptz, p_tenant uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tenant    uuid;
  v_tz        text;
  v_currency  text;
  v_warn      integer;
  v_late      integer;
  v_len       interval := p_to - p_from;
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_result    jsonb;
begin
  -- Sin p_tenant: el gastrobar de la sesión (admin o agente). Con p_tenant: sólo el
  -- rol de servicio (Mensajero programado). Dos pasos: service_role no usa private.
  if p_tenant is null then
    if not private.has_role('admin', 'ai_agent') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_tenant := private.current_tenant_id();
  else
    if current_user <> 'service_role' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_tenant := p_tenant;
  end if;
  if p_to <= p_from or v_len > interval '366 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  select t.timezone, t.currency, t.kds_warning_minutes, t.kds_late_minutes
    into v_tz, v_currency, v_warn, v_late
    from public.tenants t where t.id = v_tenant;

  with
  closed as (
    select o.* from public.orders o
     where o.tenant_id = v_tenant and o.status = 'paid'
       and o.closed_at >= p_from and o.closed_at < p_to
  ),
  items as (
    select i.* from public.order_items i
      join closed c on c.id = i.order_id
     where i.tenant_id = v_tenant and i.status <> 'cancelled'
  ),
  item_cost as (
    select m.order_item_id, -sum(m.quantity * m.unit_cost) as cost
      from public.inventory_movements m
      join items i on i.id = m.order_item_id
     where m.tenant_id = v_tenant and m.movement_type in ('sale', 'sale_reversal')
     group by m.order_item_id
  ),
  items_costed as (
    select i.*, coalesce(ic.cost, 0) as cost
      from items i left join item_cost ic on ic.order_item_id = i.id
  ),
  mov as (
    select m.* from public.inventory_movements m
     where m.tenant_id = v_tenant and m.created_at >= p_from and m.created_at < p_to
  ),
  days as (
    select d::date as day
      from generate_series((p_from at time zone v_tz)::date,
                           ((p_to - interval '1 second') at time zone v_tz)::date,
                           interval '1 day') d
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from, 'to', p_to,
      'previous_from', v_prev_from, 'previous_to', p_from,
      'days', (select count(*) from days),
      'timezone', v_tz, 'currency', v_currency,
      'kds_warning_minutes', v_warn, 'kds_late_minutes', v_late),

    'kpis', private.snapshot_kpis(v_tenant, p_from, p_to),
    'previous_kpis', private.snapshot_kpis(v_tenant, v_prev_from, p_from),

    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'orders', coalesce(s.orders, 0),
                                                   'revenue', coalesce(s.revenue, 0)) order by d.day), '[]'::jsonb)
        from days d
        left join (select (c.closed_at at time zone v_tz)::date as day, count(*) as orders, sum(c.total) as revenue
                     from closed c group by 1) s on s.day = d.day),

    'weekdays', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', w.dow, 'days', w.days, 'orders', coalesce(s.orders, 0),
                                                   'revenue', coalesce(s.revenue, 0)) order by w.dow), '[]'::jsonb)
        from (select extract(isodow from day)::int as dow, count(*) as days from days group by 1) w
        left join (select extract(isodow from c.closed_at at time zone v_tz)::int as dow,
                          count(*) as orders, sum(c.total) as revenue
                     from closed c group by 1) s on s.dow = w.dow),

    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'orders', orders, 'revenue', revenue)
                                order by dow, hour), '[]'::jsonb)
        from (select extract(isodow from c.created_at at time zone v_tz)::int as dow,
                     extract(hour from c.created_at at time zone v_tz)::int as hour,
                     count(*) as orders, sum(c.total) as revenue
                from closed c group by 1, 2) h),

    'products', (
      select coalesce(jsonb_agg(p order by p.revenue desc), '[]'::jsonb)
        from (select ic.product_id,
                     max(ic.product_name) as name,
                     max(cat.name) as category,
                     max(ic.station::text) as station,
                     coalesce(sum(ic.quantity) filter (where not ic.comped), 0) as quantity,
                     coalesce(sum(ic.quantity) filter (where ic.comped), 0) as comped_quantity,
                     coalesce(sum(ic.gross_total) filter (where not ic.comped), 0) as revenue,
                     coalesce(sum(ic.gross_total - ic.tax_amount) filter (where not ic.comped), 0) as net_revenue,
                     round(coalesce(sum(ic.cost) filter (where not ic.comped), 0), 2) as cost,
                     round(coalesce(sum(ic.cost) filter (where ic.comped), 0), 2) as comped_cost
                from items_costed ic
                left join public.products pr on pr.id = ic.product_id
                left join public.categories cat on cat.id = pr.category_id
               group by ic.product_id
               order by 7 desc
               limit 60) p),

    'unsold_products', (
      select coalesce(jsonb_agg(jsonb_build_object('product_id', pr.id, 'name', pr.name) order by pr.name), '[]'::jsonb)
        from public.products pr
       where pr.tenant_id = v_tenant and pr.is_active
         and not exists (select 1 from items i where i.product_id = pr.id)),

    'categories', (
      select coalesce(jsonb_agg(c order by c.revenue desc), '[]'::jsonb)
        from (select cat.name, coalesce(sum(i.quantity), 0) as quantity, coalesce(sum(i.line_total), 0) as revenue
                from items i
                join public.products pr on pr.id = i.product_id
                join public.categories cat on cat.id = pr.category_id
               group by cat.name) c),

    'staff', (
      select coalesce(jsonb_agg(s order by s.revenue desc), '[]'::jsonb)
        from (select c.waiter_id as profile_id,
                     coalesce(max(pf.full_name), 'Sin asignar') as name,
                     max(pf.role::text) as role,
                     count(*) as orders,
                     sum(c.total) as revenue,
                     round(avg(c.total), 2) as avg_ticket,
                     sum(c.discount_total) as discounts,
                     count(*) filter (where c.discount_total > 0) as discounted_orders,
                     coalesce((select sum(i.gross_total) from items i
                                join closed c2 on c2.id = i.order_id
                               where i.comped and c2.waiter_id is not distinct from c.waiter_id), 0) as comps,
                     (select count(*) from public.payments p
                        join public.orders o on o.id = p.order_id
                       where p.tenant_id = v_tenant and o.waiter_id is not distinct from c.waiter_id
                         and p.voided_at >= p_from and p.voided_at < p_to) as voided_payments
                from closed c
                left join public.profiles pf on pf.id = c.waiter_id
               group by c.waiter_id) s),

    'stations', (
      select coalesce(jsonb_agg(s order by s.station), '[]'::jsonb)
        from (select i.station::text as station,
                     count(*) as items,
                     round(extract(epoch from avg(i.ready_at - i.created_at)) / 60.0, 1) as avg_minutes,
                     round((extract(epoch from percentile_cont(0.9) within group (order by i.ready_at - i.created_at)) / 60.0)::numeric, 1)
                       as p90_minutes,
                     round(100.0 * count(*) filter (where i.ready_at - i.created_at > make_interval(mins => v_warn)) / count(*), 1)
                       as pct_warning,
                     round(100.0 * count(*) filter (where i.ready_at - i.created_at > make_interval(mins => v_late)) / count(*), 1)
                       as pct_late
                from items i
               where i.ready_at is not null
               group by i.station) s),

    'table_minutes', (
      select round(extract(epoch from avg(c.closed_at - c.created_at)) / 60.0, 1)
        from closed c where c.table_id is not null),

    'payments', (
      select coalesce(jsonb_object_agg(method, total), '{}'::jsonb)
        from (select p.method, sum(p.amount) as total
                from public.payments p join closed c on c.id = p.order_id
               where p.tenant_id = v_tenant and p.voided_at is null
               group by p.method) m),

    'channels', (
      select coalesce(jsonb_object_agg(source, jsonb_build_object('orders', orders, 'revenue', revenue)), '{}'::jsonb)
        from (select c.source, count(*) as orders, sum(c.total) as revenue from closed c group by c.source) s),

    'cash', (
      select jsonb_build_object(
        'sessions', count(*),
        'total_difference', coalesce(sum(cs.difference), 0),
        'differences', coalesce(jsonb_agg(jsonb_build_object('closed_at', cs.closed_at, 'difference', cs.difference,
                                                              'closed_by', pf.full_name) order by cs.closed_at)
                                 filter (where cs.difference <> 0), '[]'::jsonb))
        from public.cash_sessions cs
        left join public.profiles pf on pf.id = cs.closed_by
       where cs.tenant_id = v_tenant and cs.closed_at >= p_from and cs.closed_at < p_to),

    'inventory', jsonb_build_object(
      'stock_value', (select coalesce(round(sum(greatest(g.stock_quantity, 0) * g.cost_per_unit), 2), 0)
                        from public.ingredients g where g.tenant_id = v_tenant),
      'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'unit', g.unit, 'stock', g.stock_quantity,
                                                                'min', g.min_stock) order by g.name), '[]'::jsonb)
                      from public.ingredients g
                     where g.tenant_id = v_tenant and g.stock_quantity <= g.min_stock),
      'usage', (select coalesce(jsonb_agg(u order by u.cost desc), '[]'::jsonb)
                  from (select g.id as ingredient_id, g.name, g.unit::text as unit,
                               round(-coalesce(sum(m.quantity) filter (where m.movement_type in ('sale', 'sale_reversal')), 0), 3) as sold,
                               round(-coalesce(sum(m.quantity) filter (where m.movement_type = 'waste'), 0), 3) as waste,
                               round(-coalesce(sum(m.quantity) filter (where m.movement_type = 'adjustment' and m.quantity < 0), 0), 3) as shrinkage,
                               round(coalesce(sum(m.quantity) filter (where m.movement_type = 'purchase'), 0), 3) as purchased,
                               round(-coalesce(sum(m.quantity * m.unit_cost) filter (where m.movement_type <> 'purchase'), 0), 2) as cost
                          from mov m
                          join public.ingredients g on g.id = m.ingredient_id
                         group by g.id, g.name, g.unit
                         order by 8 desc
                         limit 40) u))
  ) into v_result;

  return v_result;
end $$;

revoke execute on function public.get_business_snapshot(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_business_snapshot(timestamptz, timestamptz, uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema private to service_role;
    grant execute on function private.snapshot_kpis(uuid, timestamptz, timestamptz) to service_role;
    grant execute on function public.get_business_snapshot(timestamptz, timestamptz, uuid) to service_role;
  end if;
end $$;

-- ─── El Mensajero también se programa ───────────────────────────────────────────
alter table public.agent_schedules drop constraint if exists agent_schedules_agent_check;
alter table public.agent_schedules add constraint agent_schedules_agent_check check (agent in ('purchase', 'messenger'));

-- ─── A quién le escribe el Mensajero ────────────────────────────────────────────
create table if not exists public.messenger_settings (
  tenant_id      uuid primary key references public.tenants (id) on delete cascade,
  emails         text[] not null default '{}' check (cardinality(emails) <= 5),
  whatsapp_phone text check (whatsapp_phone is null or char_length(whatsapp_phone) <= 20),
  updated_at     timestamptz not null default now()
);
drop trigger if exists messenger_settings_00_set_tenant on public.messenger_settings;
create trigger messenger_settings_00_set_tenant before insert on public.messenger_settings
  for each row execute function private.set_tenant_id();
alter table public.messenger_settings enable row level security;
drop policy if exists messenger_settings_admin on public.messenger_settings;
create policy messenger_settings_admin on public.messenger_settings
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- ─── Registro de envíos ─────────────────────────────────────────────────────────
create table if not exists public.messenger_deliveries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  channel     text not null default 'email' check (channel in ('email')),
  trigger     text not null default 'manual' check (trigger in ('manual', 'schedule')),
  recipients  text[] not null default '{}',
  subject     text not null,
  status      text not null check (status in ('sent', 'error')),
  provider_id text,
  error       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists messenger_deliveries_tenant_idx on public.messenger_deliveries (tenant_id, created_at desc);
drop trigger if exists messenger_deliveries_00_set_tenant on public.messenger_deliveries;
create trigger messenger_deliveries_00_set_tenant before insert on public.messenger_deliveries
  for each row execute function private.set_tenant_id();
alter table public.messenger_deliveries enable row level security;
drop policy if exists messenger_deliveries_admin_select on public.messenger_deliveries;
create policy messenger_deliveries_admin_select on public.messenger_deliveries
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
drop policy if exists messenger_deliveries_admin_insert on public.messenger_deliveries;
create policy messenger_deliveries_admin_insert on public.messenger_deliveries
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
