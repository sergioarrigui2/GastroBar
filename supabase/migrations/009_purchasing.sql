-- =============================================================================
-- 009 · Agente Comprador: proveedores, empaques, horarios y pedidos sugeridos
--
-- El pronóstico y la cantidad a pedir se calculan sin IA (lib/purchasing) a partir
-- del consumo real registrado por las recetas (movimientos 'sale'). La IA sólo se
-- usa si el administrador pide una revisión opcional.
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- ─── Proveedores ───────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  contact_name   text,
  phone          text,                      -- WhatsApp, con indicativo (p. ej. 573001234567)
  email          text,
  lead_time_days integer not null default 1 check (lead_time_days between 0 and 30),
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);
drop trigger if exists suppliers_00_set_tenant on public.suppliers;
create trigger suppliers_00_set_tenant before insert on public.suppliers
  for each row execute function private.set_tenant_id();
alter table public.suppliers enable row level security;
drop policy if exists suppliers_admin on public.suppliers;
create policy suppliers_admin on public.suppliers
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- ─── Cómo se compra cada insumo ─────────────────────────────────────────────────
alter table public.ingredients add column if not exists supplier_id uuid;
alter table public.ingredients add column if not exists pack_size  numeric(14, 3) check (pack_size is null or pack_size > 0);
alter table public.ingredients add column if not exists pack_label text check (pack_label is null or char_length(pack_label) <= 60);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ingredients_supplier_fk') then
    alter table public.ingredients
      add constraint ingredients_supplier_fk foreign key (tenant_id, supplier_id)
      references public.suppliers (tenant_id, id) on delete set null (supplier_id);
  end if;
end $$;

-- ─── Horarios de los agentes ────────────────────────────────────────────────────
create table if not exists public.agent_schedules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  agent        text not null check (agent in ('purchase')),
  is_active    boolean not null default false,
  frequency    text not null default 'weekly' check (frequency in ('daily', 'weekly', 'biweekly', 'monthly')),
  weekday      integer not null default 1 check (weekday between 1 and 7),       -- ISO: 1 = lunes
  day_of_month integer not null default 1 check (day_of_month between 1 and 28),
  hour         integer not null default 7 check (hour between 0 and 23),       -- hora local del negocio
  horizon_days integer not null default 7 check (horizon_days between 1 and 31), -- días que debe cubrir el pedido
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  last_error   text,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, agent)
);
create index if not exists agent_schedules_due_idx on public.agent_schedules (next_run_at) where is_active;
drop trigger if exists agent_schedules_00_set_tenant on public.agent_schedules;
create trigger agent_schedules_00_set_tenant before insert on public.agent_schedules
  for each row execute function private.set_tenant_id();
alter table public.agent_schedules enable row level security;
drop policy if exists agent_schedules_admin on public.agent_schedules;
create policy agent_schedules_admin on public.agent_schedules
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- ─── Pedidos sugeridos por el Comprador ─────────────────────────────────────────
create table if not exists public.purchase_suggestions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  trigger         text not null default 'manual' check (trigger in ('manual', 'schedule')),
  status          text not null default 'draft' check (status in ('draft', 'received', 'discarded')),
  horizon_days    integer not null,
  coverage_from   date not null,
  coverage_to     date not null,
  history_days    integer not null,
  lines           jsonb not null default '[]'::jsonb,
  notes           jsonb not null default '[]'::jsonb,   -- avisos deterministas (festivos, poca historia…)
  total_estimated numeric(14, 2) not null default 0,
  ai_review       jsonb,                                -- revisión opcional con IA
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  received_at     timestamptz,
  received_by     uuid,
  unique (tenant_id, id)
);
create index if not exists purchase_suggestions_tenant_idx on public.purchase_suggestions (tenant_id, created_at desc);
drop trigger if exists purchase_suggestions_00_set_tenant on public.purchase_suggestions;
create trigger purchase_suggestions_00_set_tenant before insert on public.purchase_suggestions
  for each row execute function private.set_tenant_id();
alter table public.purchase_suggestions enable row level security;
drop policy if exists purchase_suggestions_admin on public.purchase_suggestions;
create policy purchase_suggestions_admin on public.purchase_suggestions
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- ─── Insumos + consumo diario real (ventas por receta y mermas) ──────────────────
-- Admin: sólo su gastrobar. service_role (cron del Comprador): cualquier gastrobar.
create or replace function public.get_purchase_inputs(p_tenant uuid, p_days integer default 56)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tz     text;
  v_to     timestamptz := now();
  v_from   timestamptz;
  v_result jsonb;
begin
  -- Se evalúa en dos pasos: el rol de servicio no tiene acceso al esquema private.
  if current_user <> 'service_role' then
    if not (p_tenant = private.current_tenant_id() and private.has_role('admin')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  if p_days is null or p_days < 7 or p_days > 180 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = p_tenant;
  if v_tz is null then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  v_from := date_trunc('day', v_to at time zone v_tz) at time zone v_tz - make_interval(days => p_days);

  with mov as (
    select m.ingredient_id,
           (m.created_at at time zone v_tz)::date as day,
           m.movement_type,
           m.quantity
      from public.inventory_movements m
     where m.tenant_id = p_tenant and m.created_at >= v_from and m.created_at < v_to
  ),
  daily as (
    select ingredient_id, day, -sum(quantity) as qty
      from mov where movement_type in ('sale', 'sale_reversal')
     group by ingredient_id, day
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'today', (v_to at time zone v_tz)::date,
    'history_days', p_days,
    'timezone', v_tz,
    'ingredients', coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'unit', g.unit,
      'stock', g.stock_quantity, 'min_stock', g.min_stock, 'cost_per_unit', g.cost_per_unit,
      'pack_size', g.pack_size, 'pack_label', g.pack_label,
      'supplier_id', s.id, 'supplier_name', s.name, 'supplier_phone', s.phone, 'lead_time_days', coalesce(s.lead_time_days, 1),
      'sold', coalesce((select sum(d.qty) from daily d where d.ingredient_id = g.id), 0),
      'waste', coalesce((select -sum(m.quantity) from mov m where m.ingredient_id = g.id and m.movement_type = 'waste'), 0),
      'first_day', (select min(d.day) from daily d where d.ingredient_id = g.id),
      'daily', coalesce((select jsonb_object_agg(d.day, d.qty) from daily d where d.ingredient_id = g.id), '{}'::jsonb)
    ) order by g.name), '[]'::jsonb)
  ) into v_result
  from public.ingredients g
  left join public.suppliers s on s.id = g.supplier_id and s.is_active
  where g.tenant_id = p_tenant;

  return v_result;
end $$;

revoke execute on function public.get_purchase_inputs(uuid, integer) from public, anon;
grant execute on function public.get_purchase_inputs(uuid, integer) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_purchase_inputs(uuid, integer) to service_role;
  end if;
end $$;
