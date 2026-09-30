-- ════════════════════════════════════════════════════════════════════════════════
-- 016 · Sólo el administrador anula
--
-- · Quitar un producto de una comanda ya enviada (cancelar el ítem) y anular la
--   comanda completa quedan reservados al rol admin (antes: también caja, mesero y
--   agentes IA). Anular pagos / facturas ya era sólo admin (void_payment).
-- · Ambas anulaciones exigen motivo y registran quién la hizo, para auditoría.
-- · El motivo viaja en app.cancel_reason y se consume con las RPC de abajo.
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.order_items add column if not exists cancel_reason text;
alter table public.order_items add column if not exists cancelled_by  uuid;
alter table public.orders      add column if not exists cancel_reason text;
alter table public.orders      add column if not exists cancelled_by  uuid;

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
      -- Anular una comanda enviada: sólo el administrador, con motivo.
      if not private.has_role('admin') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if nullif(trim(current_setting('app.cancel_reason', true)), '') is null then
        raise exception 'void_reason_required' using errcode = '22023';
      end if;
      new.cancel_reason := trim(current_setting('app.cancel_reason', true));
      new.cancelled_by  := auth.uid();
    else
      new.cancel_reason := old.cancel_reason;
      new.cancelled_by  := old.cancelled_by;
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

-- Quita productos de una comanda enviada (admin, con motivo).
create or replace function public.cancel_order_items(p_item_ids uuid[], p_reason text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_count integer;
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'void_reason_required' using errcode = '22023';
  end if;
  perform set_config('app.cancel_reason', trim(p_reason), true);
  update public.order_items
     set status = 'cancelled'
   where id = any(p_item_ids)
     and tenant_id = (select private.current_tenant_id())
     and status <> 'cancelled';
  get diagnostics v_count = row_count;
  perform set_config('app.cancel_reason', '', true);
  return v_count;
end $$;

-- Anula la comanda completa (admin, con motivo, sin pagos).
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'void_reason_required' using errcode = '22023';
  end if;
  perform set_config('app.cancel_reason', trim(p_reason), true);
  update public.orders
     set status = 'cancelled'
   where id = p_order_id
     and tenant_id = (select private.current_tenant_id())
     and status not in ('paid', 'cancelled');
  if not found then
    raise exception 'order_closed' using errcode = '22023';
  end if;
  perform set_config('app.cancel_reason', '', true);
end $$;

revoke execute on function public.cancel_order_items(uuid[], text) from public, anon;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.cancel_order_items(uuid[], text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
