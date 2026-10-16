-- ════════════════════════════════════════════════════════════════════════════════
-- 024 · Modo de operación: negocios sin pantalla de cocina o de barra
--
-- Un negocio pequeño (un solo comedor, la cocina es una persona con una libreta)
-- no necesita que alguien marque «en preparación» y «listo» en una pantalla. Con
-- uses_kitchen_screen / uses_bar_screen en false, los platos de esa estación nacen
-- «entregados»: la comanda se envía, descuenta inventario y se cobra igual, sin
-- pasar por el flujo de la pantalla. Con true (el valor por defecto) NADA cambia.
--
-- El resto de la función submit_order es idéntico al de la migración 018.
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.tenants add column if not exists uses_kitchen_screen boolean not null default true;
alter table public.tenants add column if not exists uses_bar_screen     boolean not null default true;

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
  if not private.has_role('admin', 'cashier', 'waiter', 'ai_agent') then
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
            case when private.has_role('waiter', 'cashier', 'admin') then auth.uid() end,
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
