-- ════════════════════════════════════════════════════════════════════════════════
-- 027 · Auditoría: registro inalterable de lo que importa
--
-- Cada cambio que afecta el dinero, el inventario, el menú, las personas o los ajustes
-- queda en audit_log con quién lo hizo, cuándo y qué cambió. Lo escribe la propia base
-- de datos mediante disparadores (no la aplicación), así que no se puede evitar desde
-- una pantalla ni desde una consulta directa.
--
--   · Sólo el administrador del gastrobar lo lee.
--   · Nadie lo edita ni lo borra (ni siquiera con el rol de servicio); sólo desaparece
--     junto con el gastrobar completo.
--   · Gravedad: info (operación normal), important (conviene revisarlo) y critical
--     (anulaciones, diferencias de caja, ajustes grandes, cambios de permisos…).
-- ════════════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  at         timestamptz not null default now(),
  actor_id   uuid,                 -- null = el sistema (cargas masivas, tareas programadas)
  actor_name text,                 -- nombre y rol de ese momento: sobreviven si la persona se elimina
  actor_role text,
  action     text not null check (char_length(action) between 3 and 60),
  category   text not null check (category in ('ventas', 'caja', 'inventario', 'menu', 'compras', 'personal', 'ajustes', 'seguridad')),
  severity   text not null check (severity in ('info', 'important', 'critical')),
  entity     text,
  entity_id  uuid,
  details    jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_tenant_at_idx   on public.audit_log (tenant_id, at desc);
create index if not exists audit_log_severity_idx    on public.audit_log (tenant_id, severity, at desc);
create index if not exists audit_log_actor_idx       on public.audit_log (tenant_id, actor_id, at desc);
create index if not exists audit_log_category_idx    on public.audit_log (tenant_id, category, at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- Sin escritura desde clientes: sólo lectura para el admin; el servidor puede agregar eventos (inicio de sesión
-- con PIN, alta de personal…) pero ni él puede cambiarlos ni borrarlos.
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;

create or replace function private.audit_log_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Único caso permitido: el borrado en cascada cuando el gastrobar completo ya fue eliminado.
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  raise exception 'audit_log_immutable' using errcode = '42501';
end $$;
drop trigger if exists audit_log_00_immutable on public.audit_log;
create trigger audit_log_00_immutable before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
drop trigger if exists audit_log_01_no_truncate on public.audit_log;
create trigger audit_log_01_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- Escritor único de los disparadores. El autor es quien tiene la sesión abierta (auth.uid()); sin sesión, «el sistema».
create or replace function private.audit_write(
  p_tenant   uuid,
  p_action   text,
  p_category text,
  p_severity text,
  p_entity   text,
  p_entity_id uuid,
  p_details  jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_name  text;
  v_role  text;
begin
  if v_actor is not null then
    select pr.full_name, pr.role::text into v_name, v_role from public.profiles pr where pr.id = v_actor;
  end if;
  insert into public.audit_log (tenant_id, actor_id, actor_name, actor_role, action, category, severity, entity, entity_id, details)
  values (p_tenant, v_actor, v_name, v_role, p_action, p_category, p_severity, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function private.audit_write(uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated;

-- ─── Ventas: cuentas ───────────────────────────────────────────────────────────
create or replace function private.audit_orders()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_table text;
  v_from  text;
  v_to    text;
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.tenant_id, 'order.opened', 'ventas', 'info', 'order', new.id,
      jsonb_build_object('order_number', new.order_number, 'source', new.source,
                         'table', (select t.label from public.tables t where t.id = new.table_id)));
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      perform private.audit_write(old.tenant_id, 'order.deleted', 'ventas', 'critical', 'order', old.id,
        jsonb_build_object('order_number', old.order_number, 'total', old.total, 'paid', old.paid_amount, 'status', old.status));
    end if;
    return old;
  end if;

  select t.label into v_table from public.tables t where t.id = new.table_id;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.audit_write(new.tenant_id, 'order.cancelled', 'ventas', 'critical', 'order', new.id,
      jsonb_build_object('order_number', new.order_number, 'table', v_table, 'total', old.total, 'paid', old.paid_amount,
                         'reason', nullif(current_setting('app.cancel_reason', true), '')));
  end if;
  if new.table_id is distinct from old.table_id and old.table_id is not null and new.table_id is not null then
    select t.label into v_from from public.tables t where t.id = old.table_id;
    select t.label into v_to   from public.tables t where t.id = new.table_id;
    perform private.audit_write(new.tenant_id, 'order.table_moved', 'ventas', 'important', 'order', new.id,
      jsonb_build_object('order_number', new.order_number, 'from', v_from, 'to', v_to));
  end if;
  if (new.discount_type, new.discount_value) is distinct from (old.discount_type, old.discount_value) then
    if new.discount_value > 0 then
      perform private.audit_write(new.tenant_id, 'order.discount_applied', 'ventas', 'important', 'order', new.id,
        jsonb_build_object('order_number', new.order_number, 'table', v_table, 'type', new.discount_type, 'value', new.discount_value,
                           'discount_total', new.discount_total, 'subtotal', new.subtotal, 'reason', new.discount_reason,
                           'previous_value', old.discount_value));
    else
      perform private.audit_write(new.tenant_id, 'order.discount_removed', 'ventas', 'important', 'order', new.id,
        jsonb_build_object('order_number', new.order_number, 'table', v_table, 'previous_value', old.discount_value, 'previous_type', old.discount_type));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_90_audit on public.orders;
create trigger orders_90_audit after insert or delete or update of status, table_id, discount_type, discount_value on public.orders
  for each row execute function private.audit_orders();

-- ─── Ventas: ítems (quitar, cortesías, mover entre cuentas) ──────────────────────
create or replace function private.audit_order_items()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_order  public.orders;
  v_target public.orders;
  v_key    text;
begin
  select * into v_order from public.orders o where o.id = new.order_id;
  if new.status = 'cancelled' and old.status <> 'cancelled' and pg_trigger_depth() = 1 then
    -- Quitar un producto de una comanda ya enviada (si viene de anular la cuenta completa, ya quedó registrada ahí).
    perform private.audit_write(new.tenant_id, 'item.removed', 'ventas', 'critical', 'order_item', new.id,
      jsonb_build_object('order_number', v_order.order_number, 'product', new.product_name, 'quantity', new.quantity,
                         'amount', old.line_total, 'status_before', old.status, 'reason', new.cancel_reason,
                         'table', (select t.label from public.tables t where t.id = v_order.table_id)));
  end if;
  if new.comped is distinct from old.comped then
    perform private.audit_write(new.tenant_id, case when new.comped then 'item.comped' else 'item.comp_removed' end, 'ventas', 'important', 'order_item', new.id,
      jsonb_build_object('order_number', v_order.order_number, 'product', new.product_name, 'quantity', new.quantity,
                         'amount', new.gross_total, 'reason', coalesce(new.comp_reason, old.comp_reason)));
  end if;
  if new.order_id is distinct from old.order_id then
    -- Unión o separación de cuentas: una sola línea por par de cuentas y operación.
    v_key := 'app.audit_move_' || replace(old.order_id::text, '-', '') || '_' || replace(new.order_id::text, '-', '');
    if coalesce(current_setting(v_key, true), '') = '' then
      perform set_config(v_key, '1', true);
      select * into v_target from public.orders o where o.id = old.order_id;
      perform private.audit_write(new.tenant_id, 'order.items_moved', 'ventas', 'important', 'order', new.order_id,
        jsonb_build_object('from_order', v_target.order_number, 'to_order', v_order.order_number));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists order_items_90_audit on public.order_items;
create trigger order_items_90_audit after update of status, comped, order_id on public.order_items
  for each row execute function private.audit_order_items();

-- ─── Ventas: pagos ──────────────────────────────────────────────────────────────
create or replace function private.audit_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_number bigint;
begin
  if tg_op = 'INSERT' then
    select o.order_number into v_number from public.orders o where o.id = new.order_id;
    perform private.audit_write(new.tenant_id, 'payment.registered', 'ventas', 'info', 'payment', new.id,
      jsonb_build_object('order_number', v_number, 'amount', new.amount, 'tip', new.tip, 'method', new.method,
                         'split_type', new.split_type, 'split_label', new.split_label));
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      perform private.audit_write(old.tenant_id, 'payment.deleted', 'ventas', 'critical', 'payment', old.id,
        jsonb_build_object('amount', old.amount, 'method', old.method));
    end if;
    return old;
  end if;
  if new.voided_at is not null and old.voided_at is null then
    select o.order_number into v_number from public.orders o where o.id = new.order_id;
    perform private.audit_write(new.tenant_id, 'payment.voided', 'ventas', 'critical', 'payment', new.id,
      jsonb_build_object('order_number', v_number, 'amount', new.amount, 'tip', new.tip, 'method', new.method, 'reason', new.void_reason));
  end if;
  return new;
end $$;
drop trigger if exists payments_90_audit on public.payments;
create trigger payments_90_audit after insert or delete or update of voided_at on public.payments
  for each row execute function private.audit_payments();

-- ─── Caja ───────────────────────────────────────────────────────────────────────
create or replace function private.audit_cash_sessions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.tenant_id, 'cash.opened', 'caja', 'info', 'cash_session', new.id,
      jsonb_build_object('opening_float', new.opening_float));
  elsif new.closed_at is not null and old.closed_at is null then
    perform private.audit_write(new.tenant_id, 'cash.closed', 'caja', case when coalesce(new.difference, 0) <> 0 then 'critical' else 'info' end,
      'cash_session', new.id,
      jsonb_build_object('opening_float', new.opening_float, 'counted_cash', new.counted_cash, 'expected_cash', new.expected_cash,
                         'difference', new.difference, 'notes', new.notes));
  end if;
  return new;
end $$;
drop trigger if exists cash_sessions_90_audit on public.cash_sessions;
create trigger cash_sessions_90_audit after insert or update of closed_at on public.cash_sessions
  for each row execute function private.audit_cash_sessions();

create or replace function private.audit_cash_movements()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.audit_write(new.tenant_id, 'cash.movement', 'caja', 'important', 'cash_session', new.session_id,
    jsonb_build_object('type', new.movement_type, 'amount', new.amount, 'reason', new.reason));
  return new;
end $$;
drop trigger if exists cash_movements_90_audit on public.cash_movements;
create trigger cash_movements_90_audit after insert on public.cash_movements
  for each row execute function private.audit_cash_movements();

-- ─── Inventario ─────────────────────────────────────────────────────────────────
create or replace function private.audit_inventory_movements()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ing   public.ingredients;
  v_value numeric;
begin
  -- Las ventas y sus reversos ya quedan en la cuenta; aquí sólo lo que una persona decide.
  if new.movement_type not in ('purchase', 'adjustment', 'waste') then
    return new;
  end if;
  select * into v_ing from public.ingredients i where i.id = new.ingredient_id;
  v_value := round(abs(new.quantity) * coalesce(new.unit_cost, 0), 0);
  perform private.audit_write(new.tenant_id, 'inventory.' || new.movement_type, 'inventario',
    case when new.movement_type = 'purchase' then 'info' when v_value >= 100000 then 'critical' else 'important' end,
    'ingredient', new.ingredient_id,
    jsonb_build_object('ingredient', v_ing.name, 'unit', v_ing.unit, 'quantity', new.quantity, 'unit_cost', new.unit_cost,
                       'value', v_value, 'reason', new.reason, 'stock_after', v_ing.stock_quantity));
  return new;
end $$;
drop trigger if exists inventory_movements_90_audit on public.inventory_movements;
create trigger inventory_movements_90_audit after insert on public.inventory_movements
  for each row execute function private.audit_inventory_movements();

create or replace function private.audit_ingredients()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.tenant_id, 'ingredient.created', 'inventario', 'info', 'ingredient', new.id,
      jsonb_build_object('name', new.name, 'unit', new.unit));
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      perform private.audit_write(old.tenant_id, 'ingredient.deleted', 'inventario', 'important', 'ingredient', old.id,
        jsonb_build_object('name', old.name, 'unit', old.unit, 'stock', old.stock_quantity));
    end if;
    return old;
  end if;
  -- El costo cambia solo con las compras (promedio ponderado); un cambio a mano sí se registra.
  if new.cost_per_unit is distinct from old.cost_per_unit
     and coalesce(current_setting('app.inv_move', true), 'off') <> 'on' and pg_trigger_depth() = 1 then
    perform private.audit_write(new.tenant_id, 'ingredient.cost_changed', 'inventario', 'important', 'ingredient', new.id,
      jsonb_build_object('name', new.name, 'unit', new.unit, 'from', old.cost_per_unit, 'to', new.cost_per_unit));
  end if;
  if new.unit is distinct from old.unit then
    perform private.audit_write(new.tenant_id, 'ingredient.unit_changed', 'inventario', 'important', 'ingredient', new.id,
      jsonb_build_object('name', new.name, 'from', old.unit, 'to', new.unit, 'stock_from', old.stock_quantity, 'stock_to', new.stock_quantity));
  end if;
  if new.min_stock is distinct from old.min_stock then
    perform private.audit_write(new.tenant_id, 'ingredient.min_changed', 'inventario', 'info', 'ingredient', new.id,
      jsonb_build_object('name', new.name, 'unit', new.unit, 'from', old.min_stock, 'to', new.min_stock));
  end if;
  return new;
end $$;
drop trigger if exists ingredients_90_audit on public.ingredients;
create trigger ingredients_90_audit after insert or delete or update of cost_per_unit, unit, min_stock on public.ingredients
  for each row execute function private.audit_ingredients();

-- ─── Menú: precios, disponibilidad y recetas ─────────────────────────────────────
create or replace function private.audit_products()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.tenant_id, 'product.created', 'menu', 'info', 'product', new.id,
      jsonb_build_object('name', new.name, 'price', new.price));
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      perform private.audit_write(old.tenant_id, 'product.deleted', 'menu', 'important', 'product', old.id,
        jsonb_build_object('name', old.name, 'price', old.price));
    end if;
    return old;
  end if;
  if new.price is distinct from old.price then
    perform private.audit_write(new.tenant_id, 'product.price_changed', 'menu', 'important', 'product', new.id,
      jsonb_build_object('name', new.name, 'from', old.price, 'to', new.price));
  end if;
  if new.is_active is distinct from old.is_active then
    perform private.audit_write(new.tenant_id, case when new.is_active then 'product.activated' else 'product.deactivated' end, 'menu', 'info', 'product', new.id,
      jsonb_build_object('name', new.name));
  end if;
  if new.tax_rate is distinct from old.tax_rate then
    perform private.audit_write(new.tenant_id, 'product.tax_changed', 'menu', 'important', 'product', new.id,
      jsonb_build_object('name', new.name, 'from', old.tax_rate, 'to', new.tax_rate));
  end if;
  return new;
end $$;
drop trigger if exists products_90_audit on public.products;
create trigger products_90_audit after insert or delete or update of price, is_active, tax_rate on public.products
  for each row execute function private.audit_products();

create or replace function private.audit_recipes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row  public.recipes := case when tg_op = 'DELETE' then old else new end;
  v_key  text;
  v_name text;
begin
  -- Borrar un producto borra sus recetas en cascada: ya quedó registrado como producto eliminado.
  if tg_op = 'DELETE' and not exists (select 1 from public.products p where p.id = old.product_id) then
    return old;
  end if;
  -- Guardar una receta borra e inserta sus líneas: una sola entrada por producto y operación.
  v_key := 'app.audit_recipe_' || replace(v_row.product_id::text, '-', '');
  if coalesce(current_setting(v_key, true), '') = '' then
    perform set_config(v_key, '1', true);
    select p.name into v_name from public.products p where p.id = v_row.product_id;
    perform private.audit_write(v_row.tenant_id, 'recipe.changed', 'menu', 'important', 'product', v_row.product_id,
      jsonb_build_object('product', v_name));
  end if;
  return v_row;
end $$;
drop trigger if exists recipes_90_audit on public.recipes;
create trigger recipes_90_audit after insert or update or delete on public.recipes
  for each row execute function private.audit_recipes();

-- ─── Compras y proveedores ───────────────────────────────────────────────────────
create or replace function private.audit_suppliers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.tenant_id, 'supplier.created', 'compras', 'info', 'supplier', new.id, jsonb_build_object('name', new.name));
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      perform private.audit_write(old.tenant_id, 'supplier.deleted', 'compras', 'important', 'supplier', old.id, jsonb_build_object('name', old.name));
    end if;
    return old;
  end if;
  if new.is_active is distinct from old.is_active then
    perform private.audit_write(new.tenant_id, case when new.is_active then 'supplier.activated' else 'supplier.deactivated' end, 'compras', 'info', 'supplier', new.id,
      jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;
drop trigger if exists suppliers_90_audit on public.suppliers;
create trigger suppliers_90_audit after insert or delete or update of is_active on public.suppliers
  for each row execute function private.audit_suppliers();

create or replace function private.audit_purchase_suggestions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('received', 'discarded') then
    perform private.audit_write(new.tenant_id, 'purchase.' || new.status, 'compras', case when new.status = 'received' then 'important' else 'info' end,
      'purchase_suggestion', new.id,
      jsonb_build_object('total_estimated', new.total_estimated, 'lines', jsonb_array_length(new.lines),
                         'coverage_from', new.coverage_from, 'coverage_to', new.coverage_to));
  end if;
  return new;
end $$;
drop trigger if exists purchase_suggestions_90_audit on public.purchase_suggestions;
create trigger purchase_suggestions_90_audit after update of status on public.purchase_suggestions
  for each row execute function private.audit_purchase_suggestions();

-- ─── Personas, permisos y ajustes del negocio ────────────────────────────────────
create or replace function private.audit_profiles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      perform private.audit_write(old.tenant_id, 'staff.deleted', 'personal', 'critical', 'profile', old.id,
        jsonb_build_object('name', old.full_name, 'role', old.role));
    end if;
    return old;
  end if;
  if new.role is distinct from old.role then
    perform private.audit_write(new.tenant_id, 'staff.role_changed', 'personal', 'critical', 'profile', new.id,
      jsonb_build_object('name', new.full_name, 'from', old.role, 'to', new.role));
  end if;
  if new.permissions is distinct from old.permissions then
    perform private.audit_write(new.tenant_id, 'staff.permissions_changed', 'personal', 'critical', 'profile', new.id,
      jsonb_build_object('name', new.full_name, 'role', new.role, 'from', old.permissions, 'to', new.permissions));
  end if;
  if new.is_active is distinct from old.is_active then
    perform private.audit_write(new.tenant_id, case when new.is_active then 'staff.activated' else 'staff.deactivated' end, 'personal', 'important', 'profile', new.id,
      jsonb_build_object('name', new.full_name, 'role', new.role));
  end if;
  return new;
end $$;
drop trigger if exists profiles_90_audit on public.profiles;
create trigger profiles_90_audit after delete or update of role, permissions, is_active on public.profiles
  for each row execute function private.audit_profiles();

create or replace function private.audit_tenants()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new  jsonb := to_jsonb(new);
  v_old  jsonb := to_jsonb(old);
  v_diff jsonb := '{}'::jsonb;
  k      text;
begin
  foreach k in array array['name', 'timezone', 'currency', 'tax_name', 'tax_rate', 'prices_include_tax', 'allow_negative_stock',
                           'public_menu_enabled', 'uses_kitchen_screen', 'uses_bar_screen', 'einvoice_enabled',
                           'einvoice_provider', 'einvoice_environment'] loop
    if v_new -> k is distinct from v_old -> k then
      v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
    end if;
  end loop;
  if v_diff <> '{}'::jsonb then
    perform private.audit_write(new.id, 'settings.changed', 'ajustes', 'important', 'tenant', new.id, jsonb_build_object('changes', v_diff));
  end if;
  return new;
end $$;
drop trigger if exists tenants_90_audit on public.tenants;
create trigger tenants_90_audit after update of name, timezone, currency, tax_name, tax_rate, prices_include_tax, allow_negative_stock,
    public_menu_enabled, uses_kitchen_screen, uses_bar_screen, einvoice_enabled, einvoice_provider, einvoice_environment on public.tenants
  for each row execute function private.audit_tenants();

-- ─── Seguridad: claves y equipos ─────────────────────────────────────────────────
create or replace function private.audit_api_keys()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.tenant_id, 'apikey.created', 'seguridad', 'important', 'api_key', new.id,
      jsonb_build_object('name', new.name, 'prefix', new.key_prefix));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform private.audit_write(new.tenant_id, 'apikey.revoked', 'seguridad', 'important', 'api_key', new.id,
      jsonb_build_object('name', new.name, 'prefix', new.key_prefix));
  end if;
  return new;
end $$;
drop trigger if exists api_keys_90_audit on public.api_keys;
create trigger api_keys_90_audit after insert or update of revoked_at on public.api_keys
  for each row execute function private.audit_api_keys();

create or replace function private.audit_terminals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.tenant_id, 'terminal.paired', 'seguridad', 'important', 'terminal', new.id, jsonb_build_object('name', new.name));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform private.audit_write(new.tenant_id, 'terminal.revoked', 'seguridad', 'important', 'terminal', new.id, jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;
drop trigger if exists terminal_devices_90_audit on public.terminal_devices;
create trigger terminal_devices_90_audit after insert or update of revoked_at on public.terminal_devices
  for each row execute function private.audit_terminals();

-- ─── Resumen para la pantalla: cuántas acciones sensibles hizo cada persona ───────
create or replace function public.get_audit_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if v_tenant is null or not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'by_severity', (select coalesce(jsonb_object_agg(s.severity, s.n), '{}'::jsonb)
                      from (select a.severity, count(*) as n from public.audit_log a
                             where a.tenant_id = v_tenant and a.at >= p_from and a.at < p_to group by a.severity) s),
    'by_actor', (select coalesce(jsonb_agg(jsonb_build_object('actor_id', x.actor_id, 'name', x.name, 'role', x.role, 'action', x.action, 'n', x.n)), '[]'::jsonb)
                   from (select a.actor_id, max(a.actor_name) as name, max(a.actor_role) as role, a.action, count(*) as n
                           from public.audit_log a
                          where a.tenant_id = v_tenant and a.at >= p_from and a.at < p_to and a.severity <> 'info'
                          group by a.actor_id, a.action) x),
    'by_action', (select coalesce(jsonb_object_agg(y.action, y.n), '{}'::jsonb)
                    from (select a.action, count(*) as n from public.audit_log a
                           where a.tenant_id = v_tenant and a.at >= p_from and a.at < p_to group by a.action) y));
end $$;
revoke execute on function public.get_audit_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_audit_summary(timestamptz, timestamptz) to authenticated;

-- ─── Cada ronda enviada queda registrada ─────────────────────────────────────────
-- Disparador diferido: se ejecuta al final de la transacción, cuando ya están todos los
-- productos de la ronda, y deja una sola entrada por cuenta y ronda.
create or replace function private.audit_round_sent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_key   text := 'app.audit_round_' || replace(new.order_id::text, '-', '') || '_' || new.round::text;
  v_order public.orders;
begin
  if coalesce(current_setting(v_key, true), '') <> '' then
    return null;
  end if;
  perform set_config(v_key, '1', true);
  select * into v_order from public.orders o where o.id = new.order_id;
  perform private.audit_write(new.tenant_id, 'order.round_sent', 'ventas', 'info', 'order', new.order_id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'round', new.round,
      'table', (select t.label from public.tables t where t.id = v_order.table_id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.product_name, 'qty', i.quantity, 'total', i.line_total) order by i.created_at), '[]'::jsonb)
                  from public.order_items i where i.order_id = new.order_id and i.round = new.round)));
  return null;
end $$;
drop trigger if exists order_items_91_audit_round on public.order_items;
create constraint trigger order_items_91_audit_round after insert on public.order_items
  deferrable initially deferred for each row execute function private.audit_round_sent();

