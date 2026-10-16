-- ════════════════════════════════════════════════════════════════════════════════
-- 026 · Rol «supervisor» con permisos configurables (paso 2 de 2)
--
-- Requiere haber corrido antes 025_supervisor_role.sql.
--
-- El supervisor es una persona de confianza (compras, recepción de mercancía, conteos,
-- apoyo en sala) que NO ve el negocio completo: ni ventas, ni pagos, ni caja, ni recetas.
-- Qué puede hacer lo decide el administrador casilla por casilla (profiles.permissions):
--
--   orders.take        tomar pedidos (como un mesero, sin cobrar)
--   inventory.view     ver existencias y costo de cada insumo
--   inventory.receive  registrar compras / recibir mercancía
--   inventory.count    conteos y ajustes de inventario
--   inventory.waste    registrar mermas
--   suppliers.manage   crear y editar proveedores
--   purchasing.use     usar el Comprador (pedidos sugeridos) y datos de compra de cada insumo
--
-- Se aplica en la base de datos (no sólo en las pantallas): además de lo que se le da,
-- se cierra la lectura de pagos, recetas e historial de cuentas para ese rol.
-- Para el resto de los roles NADA cambia.
-- ════════════════════════════════════════════════════════════════════════════════

-- ─── Permisos por usuario ──────────────────────────────────────────────────────
alter table public.profiles add column if not exists permissions text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_permissions_valid') then
    alter table public.profiles add constraint profiles_permissions_valid check (
      permissions <@ array['orders.take', 'inventory.view', 'inventory.receive', 'inventory.count',
                           'inventory.waste', 'suppliers.manage', 'purchasing.use']::text[]);
  end if;
end $$;

-- El administrador tiene todo; el supervisor sólo lo que figura en su lista; los demás roles, nada extra.
create or replace function private.has_permission(p text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select pr.role = 'admin' or (pr.role = 'supervisor' and p = any (pr.permissions))
      from public.profiles pr where pr.id = auth.uid() and pr.is_active), false)
$$;

create or replace function private.has_any_permission(variadic ps text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select pr.role = 'admin' or (pr.role = 'supervisor' and pr.permissions && ps)
      from public.profiles pr where pr.id = auth.uid() and pr.is_active), false)
$$;
revoke all on function private.has_permission(text) from public, anon;
revoke all on function private.has_any_permission(text[]) from public, anon;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.has_any_permission(text[]) to authenticated;

-- ─── Lo que SÍ se le da ────────────────────────────────────────────────────────
-- Proveedores y compras.
drop policy if exists suppliers_supervisor_read on public.suppliers;
create policy suppliers_supervisor_read on public.suppliers
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id())
         and (select private.has_any_permission('suppliers.manage', 'purchasing.use', 'inventory.receive')));
drop policy if exists suppliers_supervisor_write on public.suppliers;
create policy suppliers_supervisor_write on public.suppliers
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_permission('suppliers.manage')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_permission('suppliers.manage')));

drop policy if exists purchase_suggestions_supervisor on public.purchase_suggestions;
create policy purchase_suggestions_supervisor on public.purchase_suggestions
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_permission('purchasing.use')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_permission('purchasing.use')));

-- Datos de compra de cada insumo (proveedor, empaque, stock mínimo): sólo esas columnas.
drop policy if exists ingredients_supervisor_update on public.ingredients;
create policy ingredients_supervisor_update on public.ingredients
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_permission('purchasing.use')))
  with check (tenant_id = (select private.current_tenant_id()));

create or replace function private.ingredients_supervisor_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Sólo los cambios directos del supervisor; los movimientos de inventario y las ventas
  -- (que actualizan el stock dentro de funciones y disparadores) siguen su camino normal.
  if private.current_app_role() = 'supervisor'
     and pg_trigger_depth() = 1
     and coalesce(current_setting('app.inv_move', true), 'off') <> 'on' then
    if (to_jsonb(new) - array['supplier_id', 'pack_size', 'pack_label', 'min_stock', 'updated_at'])
       is distinct from (to_jsonb(old) - array['supplier_id', 'pack_size', 'pack_label', 'min_stock', 'updated_at']) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ingredients_05_supervisor_guard on public.ingredients;
create trigger ingredients_05_supervisor_guard before update on public.ingredients
  for each row execute function private.ingredients_supervisor_guard();

-- Tomar pedidos (apoyo en sala): mismas puertas que un mesero, sin cobrar ni anular.
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and ((select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')) or (select private.has_permission('orders.take'))));

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id())
         and ((select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')) or (select private.has_permission('orders.take'))))
  with check (tenant_id = (select private.current_tenant_id()));

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and ((select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')) or (select private.has_permission('orders.take'))));

drop policy if exists order_items_update on public.order_items;
create policy order_items_update on public.order_items
  for update to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (
      (select private.has_role('admin', 'cashier', 'waiter', 'ai_agent'))
      or (select private.has_permission('orders.take'))
      or (station = 'kitchen' and (select private.has_role('kitchen')))
      or (station = 'bar'     and (select private.has_role('bar')))
    ))
  with check (tenant_id = (select private.current_tenant_id()));

drop policy if exists order_submissions_insert on public.order_submissions;
create policy order_submissions_insert on public.order_submissions
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and ((select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')) or (select private.has_permission('orders.take'))));

drop policy if exists print_jobs_insert on public.print_jobs;
create policy print_jobs_insert on public.print_jobs
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and ((select private.has_role('admin', 'cashier', 'waiter', 'kitchen', 'bar', 'ai_agent')) or (select private.has_permission('orders.take'))));

-- ─── Lo que NO ve (políticas restrictivas: sólo afectan al rol supervisor) ───────
-- Una política restrictiva se suma con «y» a las demás, así que para cualquier otro rol la
-- condición es siempre verdadera y no cambia nada.
do $$
declare t text;
begin
  -- Pagos y recetas (costo de los platos): ni leerlos.
  foreach t in array array['payments', 'payment_allocations', 'recipes', 'sub_recipes', 'sub_recipe_ingredients'] loop
    execute format($f$
      drop policy if exists %I on public.%I;
      create policy %I on public.%I
        as restrictive for select to authenticated
        using ((select private.current_app_role()) is distinct from 'supervisor'::public.app_role)
    $f$, t || '_no_supervisor', t, t || '_no_supervisor', t);
  end loop;
end $$;

-- Cuentas: sólo las abiertas (lo que necesita para apoyar en sala), nunca el historial ni los totales del día.
drop policy if exists orders_supervisor_open_only on public.orders;
create policy orders_supervisor_open_only on public.orders
  as restrictive for select to authenticated
  using ((select private.current_app_role()) is distinct from 'supervisor'::public.app_role
         or (status not in ('paid', 'cancelled') and (select private.has_permission('orders.take'))));

drop policy if exists order_items_supervisor_open_only on public.order_items;
create policy order_items_supervisor_open_only on public.order_items
  as restrictive for select to authenticated
  using ((select private.current_app_role()) is distinct from 'supervisor'::public.app_role
         or ((select private.has_permission('orders.take'))
             and exists (select 1 from public.orders o
                          where o.id = order_id and o.tenant_id = order_items.tenant_id and o.status not in ('paid', 'cancelled'))));

-- Inventario: lo ve sólo si se le dio algún permiso de inventario o de compras.
drop policy if exists ingredients_supervisor_scope on public.ingredients;
create policy ingredients_supervisor_scope on public.ingredients
  as restrictive for select to authenticated
  using ((select private.current_app_role()) is distinct from 'supervisor'::public.app_role
         or (select private.has_any_permission('inventory.view', 'inventory.receive', 'inventory.count', 'inventory.waste', 'purchasing.use')));

drop policy if exists inventory_movements_supervisor_scope on public.inventory_movements;
create policy inventory_movements_supervisor_scope on public.inventory_movements
  as restrictive for select to authenticated
  using ((select private.current_app_role()) is distinct from 'supervisor'::public.app_role
         or (select private.has_permission('inventory.view')));

-- Envíos sin conexión: cada quien ve los suyos (el resultado trae el total de la cuenta).
drop policy if exists order_submissions_supervisor_own on public.order_submissions;
create policy order_submissions_supervisor_own on public.order_submissions
  as restrictive for select to authenticated
  using ((select private.current_app_role()) is distinct from 'supervisor'::public.app_role
         or created_by = (select auth.uid()));

-- ─── Funciones que ahora aceptan el permiso ──────────────────────────────────────
create or replace function public.record_inventory_movement(
  p_ingredient_id uuid,
  p_type          public.movement_type,
  p_quantity      numeric,
  p_reason        text    default null,
  p_unit_cost     numeric default null)
returns public.ingredients language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_ing    public.ingredients;
  v_delta  numeric;
begin
  if v_tenant is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_type in ('sale', 'sale_reversal') then
    raise exception 'movement_type_reserved' using errcode = '22023';
  end if;
  if p_type = 'waste' and not (private.has_role('admin', 'kitchen', 'bar', 'cashier') or private.has_permission('inventory.waste')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_type = 'purchase' and not private.has_permission('inventory.receive') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_type = 'adjustment' and not private.has_permission('inventory.count') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity = 0 or (p_type <> 'adjustment' and p_quantity < 0) then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if p_type = 'waste' and nullif(trim(p_reason), '') is null then
    raise exception 'waste_reason_required' using errcode = '22023';
  end if;

  v_delta := case p_type when 'waste' then -p_quantity else p_quantity end;

  select * into v_ing from public.ingredients
   where id = p_ingredient_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;

  perform set_config('app.inv_move', 'on', true);
  update public.ingredients i
     set stock_quantity = i.stock_quantity + v_delta,
         -- costo promedio ponderado en compras
         cost_per_unit = case
           when p_type = 'purchase' and p_unit_cost is not null and i.stock_quantity + v_delta > 0
             then round((greatest(i.stock_quantity, 0) * i.cost_per_unit + p_quantity * p_unit_cost)
                        / (greatest(i.stock_quantity, 0) + p_quantity), 4)
           else i.cost_per_unit end
   where i.id = p_ingredient_id
  returning * into v_ing;
  perform set_config('app.inv_move', 'off', true);

  insert into public.inventory_movements (tenant_id, ingredient_id, movement_type, quantity, unit_cost, reason, created_by)
  values (v_tenant, p_ingredient_id, p_type, v_delta, coalesce(p_unit_cost, v_ing.cost_per_unit),
          nullif(trim(p_reason), ''), auth.uid());

  return v_ing;
end $$;

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
    if not (p_tenant = private.current_tenant_id() and private.has_permission('purchasing.use')) then
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

create or replace function public.transfer_order(p_order_id uuid, p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_src    public.orders;
  v_dst    public.orders;
  v_from   text;
  v_to     text;
  v_offset integer;
begin
  if v_tenant is null or not (private.has_role('admin', 'cashier', 'waiter') or private.has_permission('orders.take')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_src from public.orders
   where id = p_order_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_src.status in ('paid', 'cancelled') then
    raise exception 'order_closed' using errcode = '22023';
  end if;
  select label into v_to from public.tables where id = p_table_id and tenant_id = v_tenant;
  if v_to is null then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  if v_src.table_id = p_table_id then
    raise exception 'same_table' using errcode = '22023';
  end if;
  select label into v_from from public.tables where id = v_src.table_id;

  select * into v_dst from public.orders
   where table_id = p_table_id and tenant_id = v_tenant and status not in ('paid', 'cancelled')
     for update;

  -- Mesa libre: la cuenta completa cambia de mesa.
  if not found then
    update public.orders set table_id = p_table_id where id = v_src.id;
    perform private.sync_table_status(v_src.table_id);
    perform private.sync_table_status(p_table_id);
    return jsonb_build_object('mode', 'moved', 'order_id', v_src.id, 'table', v_to);
  end if;

  -- Mesa con cuenta: se unen. Un descuento de cuenta no se fusiona con la otra.
  if v_src.discount_type is not null then
    raise exception 'order_has_discount' using errcode = '22023';
  end if;
  if exists (select 1 from public.einvoice_documents d where d.order_id = v_src.id) then
    raise exception 'order_has_einvoice' using errcode = '22023';
  end if;

  select coalesce(max(round), 0) into v_offset from public.order_items where order_id = v_dst.id;
  perform set_config('app.item_move', 'on', true);
  update public.order_items
     set order_id = v_dst.id, round = round + v_offset
   where order_id = v_src.id;
  perform set_config('app.item_move', 'off', true);
  -- Los abonos viajan con la cuenta.
  update public.payments set order_id = v_dst.id where order_id = v_src.id;

  update public.orders
     set guests = case when v_src.guests is null and v_dst.guests is null then null
                       else coalesce(v_src.guests, 0) + coalesce(v_dst.guests, 0) end,
         billing_customer = coalesce(v_dst.billing_customer, v_src.billing_customer),
         notes = concat_ws(' | ', v_dst.notes,
                           format('Unida con cuenta #%s (%s)', v_src.order_number, coalesce(v_from, 'sin mesa')),
                           v_src.notes)
   where id = v_dst.id;
  delete from public.orders where id = v_src.id;

  perform private.refresh_order(v_dst.id);
  perform private.sync_table_status(v_src.table_id);
  perform private.sync_table_status(p_table_id);
  return jsonb_build_object('mode', 'merged', 'order_id', v_dst.id, 'table', v_to);
end $$;

create or replace function public.transfer_order_items(p_item_ids uuid[], p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_src_id  uuid;
  v_orders  integer;
  v_moving  integer;
  v_active  integer;
  v_src     public.orders;
  v_dst_id  uuid;
  v_offset  integer;
  v_to      text;
begin
  if v_tenant is null or not (private.has_role('admin', 'cashier', 'waiter') or private.has_permission('orders.take')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    raise exception 'empty_order' using errcode = '22023';
  end if;

  -- Todos los ítems deben ser de UNA cuenta abierta de este gastrobar.
  select min(i.order_id::text)::uuid, count(distinct i.order_id)::int, count(*)::int
    into v_src_id, v_orders, v_moving
    from public.order_items i
   where i.id = any(p_item_ids) and i.tenant_id = v_tenant and i.status <> 'cancelled';
  if v_src_id is null or v_moving <> cardinality(p_item_ids) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_orders <> 1 then
    raise exception 'items_from_several_orders' using errcode = '22023';
  end if;
  select * into v_src from public.orders where id = v_src_id for update;
  if v_src.status in ('paid', 'cancelled') then
    raise exception 'order_closed' using errcode = '22023';
  end if;

  -- Si se separan TODOS los productos, es cambiar la cuenta completa de mesa.
  select count(*) into v_active from public.order_items where order_id = v_src.id and status <> 'cancelled';
  if v_moving = v_active then
    return public.transfer_order(v_src.id, p_table_id);
  end if;

  if exists (select 1 from public.payment_allocations a
               join public.payments p on p.id = a.payment_id
              where a.order_item_id = any(p_item_ids) and p.voided_at is null) then
    raise exception 'item_already_paid' using errcode = '22023';
  end if;
  select label into v_to from public.tables where id = p_table_id and tenant_id = v_tenant;
  if v_to is null then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  if v_src.table_id = p_table_id then
    raise exception 'same_table' using errcode = '22023';
  end if;

  select id into v_dst_id from public.orders
   where table_id = p_table_id and tenant_id = v_tenant and status not in ('paid', 'cancelled')
     for update;
  if v_dst_id is null then
    insert into public.orders (table_id, waiter_id, source)
    values (p_table_id, auth.uid(), 'pos')
    returning id into v_dst_id;
  end if;

  select coalesce(max(round), 0) into v_offset from public.order_items where order_id = v_dst_id;
  perform set_config('app.item_move', 'on', true);
  update public.order_items
     set order_id = v_dst_id, round = round + v_offset
   where id = any(p_item_ids);
  perform set_config('app.item_move', 'off', true);

  perform private.refresh_order(v_src.id);
  perform private.refresh_order(v_dst_id);
  -- Los abonos sin asignar se quedan en la cuenta de origen: no pueden superar lo que queda.
  if exists (select 1 from public.orders where id = v_src.id and paid_amount > total + 0.009) then
    raise exception 'overpayment' using errcode = '22023';
  end if;
  perform private.sync_table_status(p_table_id);
  return jsonb_build_object('mode', 'split', 'order_id', v_dst_id, 'table', v_to);
end $$;

create or replace function public.submit_order(
  p_table_id uuid,
  p_items    jsonb,
  p_notes    text    default null,
  p_guests   integer default null,
  p_client_id uuid   default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_order_id uuid;
  v_round    integer := 1;
  v_item     jsonb;
  v_source   public.order_source;
  v_result   jsonb;
  v_kitchen  boolean;
  v_bar      boolean;
begin
  if not (private.has_role('admin', 'cashier', 'waiter', 'ai_agent') or private.has_permission('orders.take')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Reintento de una comanda que ya entró (cola sin conexión): se devuelve lo mismo, sin duplicar.
  if p_client_id is not null then
    select s.result into v_result from public.order_submissions s where s.client_id = p_client_id;
    if found then
      return v_result || jsonb_build_object('duplicate', true);
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order' using errcode = '22023';
  end if;

  v_source := case when private.has_role('ai_agent') then 'ai_agent'::public.order_source
                   else 'pos'::public.order_source end;

  if p_table_id is not null then
    if not exists (select 1 from public.tables where id = p_table_id) then
      raise exception 'table_not_found' using errcode = 'P0002';
    end if;

    select o.id into v_order_id
      from public.orders o
     where o.table_id = p_table_id and o.status not in ('paid', 'cancelled')
       for update;
  end if;

  if v_order_id is null then
    insert into public.orders (table_id, waiter_id, notes, guests, source)
    values (p_table_id,
            case when private.has_role('waiter', 'cashier', 'admin') or private.has_permission('orders.take') then auth.uid() end,
            nullif(trim(p_notes), ''), p_guests, v_source)
    returning id into v_order_id;
  else
    select coalesce(max(i.round), 0) + 1 into v_round
      from public.order_items i where i.order_id = v_order_id;
    update public.orders
       set notes  = concat_ws(' | ', notes, nullif(trim(p_notes), '')),
           guests = coalesce(p_guests, guests)
     where id = v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.order_items (order_id, product_id, quantity, modifier_ids, notes, round)
    values (
      v_order_id,
      (v_item ->> 'product_id')::uuid,
      coalesce((v_item ->> 'quantity')::integer, 1),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item -> 'modifier_ids', '[]'::jsonb)))::uuid[], '{}'),
      nullif(trim(v_item ->> 'notes'), ''),
      v_round);
  end loop;

  -- Estaciones sin pantalla: sus platos de esta ronda se dan por entregados.
  select t.uses_kitchen_screen, t.uses_bar_screen into v_kitchen, v_bar
    from public.tenants t where t.id = private.current_tenant_id();
  if not coalesce(v_kitchen, true) or not coalesce(v_bar, true) then
    update public.order_items i
       set status = 'delivered'
     where i.order_id = v_order_id
       and i.round = v_round
       and i.status = 'pending'
       and ((i.station = 'kitchen' and not coalesce(v_kitchen, true))
         or (i.station = 'bar'     and not coalesce(v_bar, true)));
  end if;

  select jsonb_build_object(
           'order_id', o.id, 'order_number', o.order_number, 'round', v_round,
           'status', o.status, 'total', o.total, 'table_id', o.table_id)
    into v_result
    from public.orders o where o.id = v_order_id;
  if p_client_id is not null then
    insert into public.order_submissions (client_id, result) values (p_client_id, v_result);
  end if;
  return v_result;
end $$;

revoke execute on function public.submit_order(uuid, jsonb, text, integer, uuid) from public, anon;
grant execute on function public.submit_order(uuid, jsonb, text, integer, uuid) to authenticated;
