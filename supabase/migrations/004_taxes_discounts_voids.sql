-- =============================================================================
-- 004 · Impuestos (INC / IVA), cortesías, descuentos de cuenta y anulación de pagos.
-- Ejecutar en el SQL Editor sobre una base con schema.sql + 002 + 003.
-- (schema.sql ya incluye este archivo para instalaciones nuevas.)
--
-- Modelo de montos de una orden:
--   subtotal       = Σ line_total de ítems no cancelados (cortesías valen 0)
--   discount_total = descuento de la cuenta (porcentaje o monto fijo)
--   total          = subtotal − discount_total            (lo que paga el cliente)
--   tax_total      = impuesto contenido en total (prorrateado por el descuento)
--   paid_amount    = Σ pagos no anulados
-- =============================================================================

-- ─── 1. Columnas ─────────────────────────────────────────────────────────────
alter table public.tenants add column if not exists tax_name           text not null default 'INC';
alter table public.tenants add column if not exists tax_rate           numeric(5, 2) not null default 8
  check (tax_rate between 0 and 100);
alter table public.tenants add column if not exists prices_include_tax boolean not null default true;

-- null = usa la tarifa del gastrobar; 0 = exento.
alter table public.products add column if not exists tax_rate numeric(5, 2) check (tax_rate between 0 and 100);

alter table public.order_items add column if not exists gross_total  numeric(12, 2) not null default 0;
alter table public.order_items add column if not exists tax_rate     numeric(5, 2) not null default 0;
alter table public.order_items add column if not exists tax_amount   numeric(12, 2) not null default 0;
alter table public.order_items add column if not exists comped       boolean not null default false;
alter table public.order_items add column if not exists comp_reason  text check (comp_reason is null or char_length(comp_reason) <= 200);
alter table public.order_items add column if not exists comped_by    uuid;
update public.order_items set gross_total = line_total where gross_total = 0 and line_total <> 0;

alter table public.orders add column if not exists discount_type   text check (discount_type in ('percent', 'amount'));
alter table public.orders add column if not exists discount_value  numeric(12, 2) not null default 0 check (discount_value >= 0);
alter table public.orders add column if not exists discount_reason text check (discount_reason is null or char_length(discount_reason) <= 200);
alter table public.orders add column if not exists discount_by     uuid;
alter table public.orders add column if not exists discount_total  numeric(12, 2) not null default 0;
alter table public.orders add column if not exists tax_total       numeric(12, 2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_percent_max') then
    alter table public.orders add constraint orders_discount_percent_max
      check (discount_type is distinct from 'percent' or discount_value <= 100);
  end if;
end $$;

alter table public.payments add column if not exists voided_at   timestamptz;
alter table public.payments add column if not exists voided_by   uuid;
alter table public.payments add column if not exists void_reason text;

-- ─── 2. Ítems: impuesto al comandar, cortesías controladas ─────────────────────
create or replace function private.before_order_item_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_product  record;
  v_status   public.order_status;
  v_mods     jsonb;
  v_mods_tot numeric;
  v_mods_cnt integer;
  v_rate     numeric;
  v_include  boolean;
  v_net      numeric;
begin
  select o.status into v_status
    from public.orders o where o.id = new.order_id and o.tenant_id = new.tenant_id;
  if v_status is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_status in ('paid', 'cancelled') then
    raise exception 'order_closed' using errcode = '22023';
  end if;

  select p.name, p.price, p.is_active, p.category_id, p.tax_rate as product_tax_rate,
         c.station, c.is_active as category_active
    into v_product
    from public.products p
    join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
   where p.id = new.product_id and p.tenant_id = new.tenant_id;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if not (v_product.is_active and v_product.category_active) then
    raise exception 'product_inactive: %', v_product.name using errcode = '22023';
  end if;

  new.modifier_ids := coalesce(
    (select array_agg(distinct x) from unnest(new.modifier_ids) as x), '{}');

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price_delta', m.price_delta)
                            order by m.sort_order, m.name), '[]'::jsonb),
         coalesce(sum(m.price_delta), 0),
         count(*)
    into v_mods, v_mods_tot, v_mods_cnt
    from public.modifiers m
   where m.tenant_id = new.tenant_id
     and m.is_active
     and m.id = any (new.modifier_ids)
     and (m.product_id = new.product_id
          or m.category_id = v_product.category_id
          or (m.product_id is null and m.category_id is null));

  if v_mods_cnt <> cardinality(new.modifier_ids) then
    raise exception 'invalid_modifier' using errcode = '22023';
  end if;

  select t.tax_rate, t.prices_include_tax into v_rate, v_include
    from public.tenants t where t.id = new.tenant_id;
  v_rate := coalesce(v_product.product_tax_rate, v_rate, 0);
  v_net  := new.quantity * (v_product.price + v_mods_tot);

  new.product_name    := v_product.name;
  new.unit_price      := v_product.price;
  new.station         := v_product.station;
  new.modifiers       := v_mods;
  new.modifiers_total := v_mods_tot;
  new.tax_rate        := v_rate;
  if v_include then
    new.gross_total := v_net;
    new.tax_amount  := round(v_net - v_net / (1 + v_rate / 100), 2);
  else
    new.tax_amount  := round(v_net * v_rate / 100, 2);
    new.gross_total := v_net + new.tax_amount;
  end if;
  new.line_total      := new.gross_total;
  new.comped          := false;
  new.comp_reason     := null;
  new.comped_by       := null;
  new.status          := 'pending';
  new.started_at      := null;
  new.ready_at        := null;
  new.delivered_at    := null;
  new.cancelled_at    := null;
  return new;
end $$;

create or replace function private.before_order_item_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_role public.app_role := private.current_app_role();
begin
  new.tenant_id       := old.tenant_id;
  new.order_id        := old.order_id;
  new.product_id      := old.product_id;
  new.product_name    := old.product_name;
  new.station         := old.station;
  new.quantity        := old.quantity;
  new.unit_price      := old.unit_price;
  new.modifier_ids    := old.modifier_ids;
  new.modifiers       := old.modifiers;
  new.modifiers_total := old.modifiers_total;
  new.gross_total     := old.gross_total;
  new.tax_rate        := old.tax_rate;
  new.tax_amount      := old.tax_amount;
  new.round           := old.round;
  new.created_at      := old.created_at;

  -- Cortesía: sólo admin / caja, con motivo, antes de cobrar el ítem.
  if new.comped is distinct from old.comped then
    if not private.has_role('admin', 'cashier') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if (select o.status from public.orders o where o.id = old.order_id) in ('paid', 'cancelled') then
      raise exception 'order_closed' using errcode = '22023';
    end if;
    if exists (select 1 from public.payment_allocations a
                 join public.payments p on p.id = a.payment_id
                where a.order_item_id = old.id and p.voided_at is null) then
      raise exception 'item_already_paid' using errcode = '22023';
    end if;
    if new.comped then
      if nullif(trim(new.comp_reason), '') is null then
        raise exception 'comp_reason_required' using errcode = '22023';
      end if;
      new.comp_reason := trim(new.comp_reason);
      new.comped_by   := auth.uid();
    else
      new.comp_reason := null;
      new.comped_by   := null;
    end if;
  else
    new.comp_reason := old.comp_reason;
    new.comped_by   := old.comped_by;
  end if;
  new.line_total := case when new.comped then 0 else old.gross_total end;

  if new.status is distinct from old.status then
    if old.status in ('cancelled', 'delivered') and pg_trigger_depth() = 1 then
      raise exception 'item_status_final: %', old.status using errcode = '22023';
    end if;
    if pg_trigger_depth() = 1 and v_role in ('kitchen', 'bar') and new.status in ('cancelled', 'delivered') then
      raise exception 'forbidden_transition' using errcode = '42501';
    end if;
    case new.status
      when 'pending'        then new.started_at := null; new.ready_at := null;
      when 'in_preparation' then new.started_at := coalesce(old.started_at, now()); new.ready_at := null;
      when 'ready'          then new.started_at := coalesce(old.started_at, now()); new.ready_at := now();
      when 'delivered'      then new.delivered_at := now(); new.ready_at := coalesce(old.ready_at, now());
      when 'cancelled'      then new.cancelled_at := now();
    end case;
  end if;
  return new;
end $$;

drop trigger if exists order_items_after_change on public.order_items;
create trigger order_items_after_change
  after insert or update of status, comped on public.order_items
  for each row execute function private.after_order_item_change();

-- ─── 3. Totales y estado de la orden (única fuente de verdad) ──────────────────
create or replace function private.refresh_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order    record;
  v_gross    numeric;
  v_tax      numeric;
  v_disc     numeric;
  v_total    numeric;
  v_paid     numeric;
  v_items    integer;
  v_active   integer;
  v_pending  integer;
  v_ready    integer;
  v_deliv    integer;
  v_status   public.order_status;
begin
  select o.status, o.discount_type, o.discount_value into v_order
    from public.orders o where o.id = p_order_id for update;
  if not found then return; end if;

  select coalesce(sum(i.line_total) filter (where i.status <> 'cancelled'), 0),
         coalesce(sum(i.tax_amount) filter (where i.status <> 'cancelled' and not i.comped), 0),
         count(*),
         count(*) filter (where i.status <> 'cancelled'),
         count(*) filter (where i.status = 'pending'),
         count(*) filter (where i.status = 'ready'),
         count(*) filter (where i.status = 'delivered')
    into v_gross, v_tax, v_items, v_active, v_pending, v_ready, v_deliv
    from public.order_items i where i.order_id = p_order_id;

  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p where p.order_id = p_order_id and p.voided_at is null;

  v_disc := case v_order.discount_type
              when 'percent' then round(v_gross * v_order.discount_value / 100, 2)
              when 'amount'  then least(v_order.discount_value, v_gross)
              else 0 end;
  v_total := v_gross - v_disc;
  v_tax   := case when v_gross > 0 then round(v_tax * v_total / v_gross, 2) else 0 end;

  if v_order.status = 'cancelled' then
    v_status := 'cancelled';
  elsif v_active = 0 then
    v_status := case when v_items > 0 and v_paid = 0 then 'cancelled'::public.order_status
                     else 'pending'::public.order_status end;
  elsif v_paid >= v_total - 0.009 and (v_total > 0 or v_deliv = v_active) then
    v_status := 'paid';                       -- cuenta saldada (o 100% cortesía ya entregada)
  elsif v_deliv = v_active then
    v_status := 'delivered';
  elsif v_ready + v_deliv = v_active then
    v_status := 'ready';
  elsif v_pending = v_active then
    v_status := 'pending';
  else
    v_status := 'in_preparation';
  end if;

  perform set_config('app.order_guard_bypass', 'on', true);
  update public.orders
     set subtotal = v_gross, discount_total = v_disc, total = v_total,
         tax_total = v_tax, paid_amount = v_paid, status = v_status
   where id = p_order_id;
  perform set_config('app.order_guard_bypass', 'off', true);
end $$;

create or replace function private.after_payment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_order(new.order_id);
  return null;
end $$;

create or replace function private.before_order_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Columnas del sistema: sólo refresh_order las cambia (activa app.order_guard_bypass).
  if pg_trigger_depth() = 1 and coalesce(current_setting('app.order_guard_bypass', true), 'off') <> 'on' then
    new.tenant_id      := old.tenant_id;
    new.order_number   := old.order_number;
    new.subtotal       := old.subtotal;
    new.total          := old.total;
    new.paid_amount    := old.paid_amount;
    new.discount_total := old.discount_total;
    new.tax_total      := old.tax_total;
    new.created_at     := old.created_at;
    new.created_by     := old.created_by;

    if new.status is distinct from old.status then
      if new.status <> 'cancelled' then
        raise exception 'order_status_is_derived' using errcode = '22023';
      end if;
      if old.paid_amount > 0 then
        raise exception 'order_has_payments' using errcode = '22023';
      end if;
    end if;

    -- Descuento de cuenta: sólo admin / caja, con motivo, con la orden abierta.
    if new.discount_type is distinct from old.discount_type or new.discount_value is distinct from old.discount_value then
      if not private.has_role('admin', 'cashier') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if old.status in ('paid', 'cancelled') then
        raise exception 'order_closed' using errcode = '22023';
      end if;
      if new.discount_type is null or new.discount_value = 0 then
        new.discount_type := null; new.discount_value := 0; new.discount_reason := null; new.discount_by := null;
      else
        if nullif(trim(new.discount_reason), '') is null then
          raise exception 'discount_reason_required' using errcode = '22023';
        end if;
        new.discount_reason := trim(new.discount_reason);
        new.discount_by := auth.uid();
      end if;
    else
      new.discount_reason := old.discount_reason;
      new.discount_by     := old.discount_by;
    end if;
  end if;

  if new.status in ('paid', 'cancelled') and old.status not in ('paid', 'cancelled') then
    new.closed_at := now();
  elsif old.status = 'paid' and new.status not in ('paid', 'cancelled') then
    new.closed_at := null;                    -- reapertura por anulación de pago
  end if;
  return new;
end $$;

create or replace function private.after_order_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.order_items
       set status = 'cancelled'
     where order_id = new.id and tenant_id = new.tenant_id and status <> 'cancelled';
  end if;

  if new.discount_type is distinct from old.discount_type or new.discount_value is distinct from old.discount_value then
    perform private.refresh_order(new.id);
    if exists (select 1 from public.orders o where o.id = new.id and o.paid_amount > o.total + 0.009) then
      raise exception 'discount_exceeds_balance' using errcode = '22023';
    end if;
  end if;

  if new.table_id is not null then
    if new.status in ('paid', 'cancelled') and old.status not in ('paid', 'cancelled')
       and not exists (select 1 from public.orders o
                        where o.table_id = new.table_id and o.id <> new.id
                          and o.status not in ('paid', 'cancelled')) then
      update public.tables set status = 'free' where id = new.table_id and tenant_id = new.tenant_id;
    elsif old.status = 'paid' and new.status not in ('paid', 'cancelled') then
      update public.tables set status = 'occupied' where id = new.table_id and tenant_id = new.tenant_id;
    end if;
  end if;
  return null;
end $$;

-- Asignaciones por ítem: ignora pagos anulados.
create or replace function private.before_allocation_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_line      numeric;
  v_allocated numeric;
begin
  select i.line_total into v_line
    from public.order_items i
    join public.payments p on p.order_id = i.order_id and p.tenant_id = i.tenant_id
   where i.id = new.order_item_id and p.id = new.payment_id and i.status <> 'cancelled'
     and i.tenant_id = new.tenant_id;
  if v_line is null then
    raise exception 'allocation_item_mismatch' using errcode = '22023';
  end if;

  select coalesce(sum(a.amount), 0) into v_allocated
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
   where a.order_item_id = new.order_item_id and p.voided_at is null;
  if v_allocated + new.amount > v_line + 0.009 then
    raise exception 'item_overallocated' using errcode = '22023';
  end if;
  return new;
end $$;

-- ─── 4. Anulación de pagos (sólo admin, fuera de cajas cerradas) ──────────────────
create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_pay    public.payments;
  v_result jsonb;
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'void_reason_required' using errcode = '22023';
  end if;

  select * into v_pay from public.payments
   where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_pay.voided_at is not null then
    raise exception 'payment_already_voided' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_sessions s
              where s.tenant_id = v_tenant and s.closed_at is not null
                and v_pay.created_at >= s.opened_at and v_pay.created_at < s.closed_at) then
    raise exception 'payment_in_closed_cash_session' using errcode = '22023';
  end if;

  update public.payments
     set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = v_pay.id;

  perform private.refresh_order(v_pay.order_id);

  select jsonb_build_object('order_id', o.id, 'status', o.status, 'total', o.total,
                            'paid_amount', o.paid_amount, 'remaining', greatest(o.total - o.paid_amount, 0))
    into v_result
    from public.orders o where o.id = v_pay.order_id;
  return v_result;
end $$;

-- ─── 5. Productos: tarifa de impuesto propia en save_product ───────────────────
drop function if exists public.save_product(uuid, uuid, text, text, numeric, boolean, boolean, integer, jsonb);
create or replace function public.save_product(
  p_id          uuid,
  p_category_id uuid,
  p_name        text,
  p_description text,
  p_price       numeric,
  p_is_active   boolean,
  p_track_stock boolean,
  p_sort_order  integer,
  p_recipe      jsonb default null,
  p_tax_rate    numeric default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id   uuid;
  v_line jsonb;
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.products (category_id, name, description, price, is_active, track_stock, sort_order, tax_rate)
    values (p_category_id, trim(p_name), nullif(trim(p_description), ''), p_price,
            coalesce(p_is_active, true), coalesce(p_track_stock, true), coalesce(p_sort_order, 0), p_tax_rate)
    returning id into v_id;
  else
    update public.products
       set category_id = p_category_id, name = trim(p_name), description = nullif(trim(p_description), ''),
           price = p_price, is_active = coalesce(p_is_active, is_active),
           track_stock = coalesce(p_track_stock, track_stock), sort_order = coalesce(p_sort_order, sort_order),
           tax_rate = p_tax_rate
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
  end if;

  if p_recipe is not null then
    delete from public.recipes where product_id = v_id;
    for v_line in select value from jsonb_array_elements(p_recipe) loop
      insert into public.recipes (product_id, ingredient_id, sub_recipe_id, quantity)
      values (v_id, (v_line ->> 'ingredient_id')::uuid, (v_line ->> 'sub_recipe_id')::uuid,
              (v_line ->> 'quantity')::numeric);
    end loop;
  end if;

  return v_id;
end $$;

-- ─── 6. Reportes: excluyen pagos anulados; suman descuentos, cortesías e impuestos ─
create or replace function private.cash_report(p_session public.cash_sessions, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with pay as (
    select p.* from public.payments p
     where p.tenant_id = p_session.tenant_id and p.voided_at is null
       and p.created_at >= p_session.opened_at and p.created_at < p_until
  ),
  voided as (
    select p.* from public.payments p
     where p.tenant_id = p_session.tenant_id and p.voided_at is not null
       and p.voided_at >= p_session.opened_at and p.voided_at < p_until
  ),
  paid_orders as (
    select o.* from public.orders o
     where o.tenant_id = p_session.tenant_id and o.status = 'paid'
       and o.closed_at >= p_session.opened_at and o.closed_at < p_until
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
    'orders_paid', (select count(*) from paid_orders),
    'orders_cancelled', (select count(*) from public.orders o
                          where o.tenant_id = p_session.tenant_id and o.status = 'cancelled'
                            and o.closed_at >= p_session.opened_at and o.closed_at < p_until),
    'discounts', (select coalesce(sum(discount_total), 0) from paid_orders),
    'comps', (select coalesce(sum(i.gross_total), 0) from public.order_items i
               join paid_orders o on o.id = i.order_id
              where i.comped and i.status <> 'cancelled'),
    'tax', (select coalesce(sum(tax_total), 0) from paid_orders),
    'voided_count', (select count(*) from voided),
    'voided_amount', (select coalesce(sum(amount), 0) from voided),
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

create or replace function public.get_shift_metrics(
  p_from timestamptz default date_trunc('day', now()),
  p_to   timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_result jsonb;
begin
  if not private.has_role('admin', 'cashier', 'ai_agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with
  pay as (
    select p.* from public.payments p
     where p.tenant_id = v_tenant and p.voided_at is null
       and p.created_at >= p_from and p.created_at < p_to
  ),
  closed as (
    select o.* from public.orders o
     where o.tenant_id = v_tenant and o.status = 'paid'
       and o.closed_at >= p_from and o.closed_at < p_to
  ),
  items as (
    select i.* from public.order_items i
     where i.tenant_id = v_tenant and i.status <> 'cancelled'
       and i.created_at >= p_from and i.created_at < p_to
  ),
  mov as (
    select m.* from public.inventory_movements m
     where m.tenant_id = v_tenant and m.created_at >= p_from and m.created_at < p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'revenue',         (select coalesce(sum(amount), 0) from pay),
    'tips',            (select coalesce(sum(tip), 0) from pay),
    'orders_closed',   (select count(*) from closed),
    'avg_ticket',      (select coalesce(round(avg(total), 2), 0) from closed),
    'items_sold',      (select coalesce(sum(quantity), 0) from items),
    'discounts',       (select coalesce(sum(discount_total), 0) from closed),
    'comps',           (select coalesce(sum(gross_total), 0) from items where comped),
    'tax_collected',   (select coalesce(sum(tax_total), 0) from closed),
    'voided_payments', (select count(*) from public.payments p
                         where p.tenant_id = v_tenant and p.voided_at >= p_from and p.voided_at < p_to),
    'open_orders',     (select count(*) from public.orders o
                         where o.tenant_id = v_tenant and o.status not in ('paid', 'cancelled')),
    'open_orders_value', (select coalesce(sum(o.total - o.paid_amount), 0) from public.orders o
                         where o.tenant_id = v_tenant and o.status not in ('paid', 'cancelled')),
    'occupied_tables', (select count(*) from public.tables t
                         where t.tenant_id = v_tenant and t.status = 'occupied'),
    'total_tables',    (select count(*) from public.tables t where t.tenant_id = v_tenant),
    'ingredient_cost', (select coalesce(round(-sum(quantity * unit_cost), 2), 0) from mov
                         where movement_type in ('sale', 'sale_reversal')),
    'waste_cost',      (select coalesce(round(-sum(quantity * unit_cost), 2), 0) from mov
                         where movement_type = 'waste'),
    'payments_by_method', (select coalesce(jsonb_object_agg(method, total), '{}'::jsonb)
                             from (select method, sum(amount) as total from pay group by method) s),
    'sales_by_station', (select coalesce(jsonb_object_agg(station, total), '{}'::jsonb)
                           from (select station, sum(line_total) as total from items group by station) s),
    'avg_prep_minutes', (select coalesce(jsonb_object_agg(station, mins), '{}'::jsonb)
                           from (select station,
                                        round(extract(epoch from avg(ready_at - created_at)) / 60.0, 1) as mins
                                   from items where ready_at is not null group by station) s),
    'top_products', (select coalesce(jsonb_agg(t order by t.quantity desc), '[]'::jsonb)
                       from (select product_id, product_name, station,
                                    sum(quantity)::integer as quantity,
                                    sum(line_total) as revenue
                               from items
                              group by product_id, product_name, station
                              order by sum(quantity) desc
                              limit 10) t),
    'hourly_revenue', (select coalesce(jsonb_agg(h order by h.hour), '[]'::jsonb)
                         from (select date_trunc('hour', created_at) as hour, sum(amount) as revenue
                                 from pay group by 1) h)
  ) into v_result;

  return v_result;
end $$;

-- ─── 7. Privilegios ────────────────────────────────────────────────────────────
revoke execute on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated;
revoke execute on function public.save_product(uuid, uuid, text, text, numeric, boolean, boolean, integer, jsonb, numeric) from public, anon;
grant execute on function public.save_product(uuid, uuid, text, text, numeric, boolean, boolean, integer, jsonb, numeric) to authenticated;
revoke all on function private.refresh_order(uuid) from public, anon, authenticated;
