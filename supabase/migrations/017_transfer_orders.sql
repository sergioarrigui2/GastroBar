-- ════════════════════════════════════════════════════════════════════════════════
-- 017 · Cambio de mesa, unión y separación de cuentas
--
-- · transfer_order(orden, mesa): si la mesa destino está libre, la cuenta se traslada;
--   si ya tiene cuenta abierta, se UNEN (ítems y abonos pasan a la cuenta destino).
--   En ambos casos la mesa de origen queda libre para nuevos clientes.
-- · transfer_order_items(ítems, mesa): separa productos hacia otra mesa (a su cuenta
--   abierta o a una nueva). Un ítem ya pagado no se separa (su pago va ligado a él).
-- · Meseros, caja y admin. Los abonos viajan con la cuenta. No devuelve stock: es sólo
--   un cambio de cuenta. La cuenta unida se elimina (queda nota en la destino) para no
--   contar como anulación en reportes.
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function private.before_order_item_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_role public.app_role := private.current_app_role();
begin
  new.tenant_id       := old.tenant_id;
  -- Cambio de mesa / unión de cuentas: sólo las RPC de traslado mueven ítems entre órdenes.
  if coalesce(current_setting('app.item_move', true), 'off') <> 'on' then
    new.order_id := old.order_id;
    new.round    := old.round;
  end if;
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

  -- Motivo y autor de la anulación: sólo se fijan al cancelar.
  new.cancel_reason := old.cancel_reason;
  new.cancelled_by  := old.cancelled_by;

  if new.status is distinct from old.status then
    if old.status in ('cancelled', 'delivered') and pg_trigger_depth() = 1 then
      raise exception 'item_status_final: %', old.status using errcode = '22023';
    end if;
    -- Quitar un producto de una comanda ya enviada: sólo el administrador, con motivo
    -- y antes de cobrarlo. (Si viene de anular la orden completa, pg_trigger_depth() > 1.)
    if new.status = 'cancelled' and pg_trigger_depth() = 1 then
      if not private.has_role('admin') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if exists (select 1 from public.payment_allocations a
                   join public.payments p on p.id = a.payment_id
                  where a.order_item_id = old.id and p.voided_at is null) then
        raise exception 'item_already_paid' using errcode = '22023';
      end if;
      if nullif(trim(current_setting('app.cancel_reason', true)), '') is null then
        raise exception 'void_reason_required' using errcode = '22023';
      end if;
      new.cancel_reason := trim(current_setting('app.cancel_reason', true));
      new.cancelled_by  := auth.uid();
    elsif new.status = 'cancelled' then
      -- Cancelado junto con la orden completa: hereda su motivo.
      new.cancel_reason := nullif(trim(current_setting('app.cancel_reason', true)), '');
      new.cancelled_by  := auth.uid();
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

-- Libera la mesa si ya no tiene cuentas abiertas; si tiene, la marca ocupada.
create or replace function private.sync_table_status(p_table_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_table_id is null then
    return;
  end if;
  update public.tables t
     set status = case when exists (select 1 from public.orders o
                                     where o.table_id = t.id and o.status not in ('paid', 'cancelled'))
                       then 'occupied'::public.table_status else 'free'::public.table_status end
   where t.id = p_table_id;
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
  if v_tenant is null or not private.has_role('admin', 'cashier', 'waiter') then
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
  if v_tenant is null or not private.has_role('admin', 'cashier', 'waiter') then
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

revoke all on function private.sync_table_status(uuid) from public, anon, authenticated;
revoke execute on function public.transfer_order(uuid, uuid) from public, anon;
revoke execute on function public.transfer_order_items(uuid[], uuid) from public, anon;
grant execute on function public.transfer_order(uuid, uuid) to authenticated;
grant execute on function public.transfer_order_items(uuid[], uuid) to authenticated;
