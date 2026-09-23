-- =============================================================================
-- 005 · Facturación electrónica (base agnóstica de proveedor, no bloqueante).
-- Ejecutar en el SQL Editor sobre una base con schema.sql + 002 + 003 + 004.
-- (schema.sql ya incluye este archivo para instalaciones nuevas.)
--
-- Principios:
--   * Desactivada por defecto (tenants.einvoice_enabled = false): el POS opera igual.
--   * Nunca bloquea un cobro: el documento se ENCOLA al pagarse la cuenta y un
--     proceso en segundo plano lo envía al proveedor, con reintentos.
--   * Los datos del documento se congelan (payload) en el momento del pago.
--   * Anular un pago de una cuenta ya aceptada genera una nota crédito.
-- =============================================================================

-- ─── 1. Configuración por gastrobar ────────────────────────────────────────────
alter table public.tenants add column if not exists einvoice_enabled     boolean not null default false;
alter table public.tenants add column if not exists einvoice_provider    text not null default 'none'
  check (einvoice_provider in ('none', 'simulator', 'alegra', 'siigo'));
alter table public.tenants add column if not exists einvoice_environment text not null default 'test'
  check (einvoice_environment in ('test', 'production'));
-- Documento cuando el cliente no pide factura a su nombre.
alter table public.tenants add column if not exists einvoice_default_doc text not null default 'pos'
  check (einvoice_default_doc in ('pos', 'invoice'));

-- Credenciales del proveedor, cifradas por la aplicación (AES-256-GCM).
create table if not exists public.einvoice_credentials (
  tenant_id        uuid primary key references public.tenants (id) on delete cascade,
  provider         text not null check (provider in ('simulator', 'alegra', 'siigo')),
  encrypted_config text not null,
  config_hint      text,                       -- p. ej. "usuario: api@bar.co · clave ••••a1b2"
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now()
);
alter table public.einvoice_credentials enable row level security;
drop policy if exists einvoice_credentials_admin on public.einvoice_credentials;
create policy einvoice_credentials_admin on public.einvoice_credentials
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- Datos del adquiriente (cliente que pide factura a su nombre).
alter table public.orders add column if not exists billing_customer jsonb
  check (billing_customer is null or jsonb_typeof(billing_customer) = 'object');

-- ─── 2. Documentos electrónicos ─────────────────────────────────────────────────
create table if not exists public.einvoice_documents (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  order_id             uuid not null,
  doc_type             text not null check (doc_type in ('pos', 'invoice', 'credit_note')),
  status               text not null default 'pending'
    check (status in ('pending', 'processing', 'accepted', 'rejected', 'error', 'cancelled')),
  provider             text not null,
  environment          text not null,
  related_document_id  uuid references public.einvoice_documents (id) on delete set null,
  reason               text,
  customer             jsonb,
  payload              jsonb not null,
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  last_error           text,
  provider_document_id text,
  number               text,
  cufe                 text,                   -- CUFE (factura) / CUDE (POS, notas)
  qr_data              text,
  pdf_url              text,
  xml_url              text,
  issued_at            timestamptz,
  credited_at          timestamptz,            -- se emitió nota crédito sobre este documento
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade
);
create index if not exists einvoice_documents_queue_idx
  on public.einvoice_documents (status, next_attempt_at) where status in ('pending', 'error');
create index if not exists einvoice_documents_tenant_idx on public.einvoice_documents (tenant_id, created_at desc);
create index if not exists einvoice_documents_order_idx on public.einvoice_documents (tenant_id, order_id);
-- Un solo documento de venta vigente por orden.
create unique index if not exists einvoice_one_sale_doc_per_order
  on public.einvoice_documents (order_id)
  where doc_type in ('pos', 'invoice') and status in ('pending', 'processing', 'accepted', 'error') and credited_at is null;

drop trigger if exists einvoice_documents_updated_at on public.einvoice_documents;
create trigger einvoice_documents_updated_at before update on public.einvoice_documents
  for each row execute function private.set_updated_at();

alter table public.einvoice_documents enable row level security;
drop policy if exists einvoice_documents_select on public.einvoice_documents;
create policy einvoice_documents_select on public.einvoice_documents
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'cashier')));
-- Escrituras sólo por funciones del sistema y el procesador (service role).

-- ─── 3. Snapshot del documento (se congela al pagarse la cuenta) ────────────────
create or replace function private.einvoice_payload(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with o as (
    select o.*, t.label as table_label
      from public.orders o left join public.tables t on t.id = o.table_id
     where o.id = p_order_id
  ),
  factor as (
    select case when o.subtotal > 0 then o.total / o.subtotal else 0 end as f from o
  ),
  items as (
    select i.* from public.order_items i where i.order_id = p_order_id and i.status <> 'cancelled'
  )
  select jsonb_build_object(
    'order', (select jsonb_build_object('id', o.id, 'number', o.order_number, 'table', o.table_label,
                                        'closed_at', o.closed_at, 'guests', o.guests) from o),
    'seller', (select jsonb_build_object('name', t.name, 'tax_id', t.tax_id, 'address', t.address,
                                         'phone', t.phone, 'currency', t.currency)
                 from public.tenants t join o on o.tenant_id = t.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'product_id', i.product_id, 'name', i.product_name, 'quantity', i.quantity,
                'unit_price', round(i.gross_total / i.quantity, 2), 'gross_total', i.gross_total,
                'line_total', i.line_total, 'tax_rate', i.tax_rate,
                'tax_amount', case when i.comped then 0 else i.tax_amount end,
                'comped', i.comped, 'modifiers', i.modifiers) order by i.round, i.created_at), '[]'::jsonb)
                from items i),
    'totals', (select jsonb_build_object('subtotal', o.subtotal, 'discount', o.discount_total,
                                         'total', o.total, 'tax', o.tax_total, 'base', o.total - o.tax_total)
                 from o),
    'taxes', (select coalesce(jsonb_agg(jsonb_build_object('rate', x.rate, 'base', x.base, 'amount', x.amount)
                                        order by x.rate), '[]'::jsonb)
                from (select i.tax_rate as rate,
                             round(sum(i.line_total) * (select f from factor) - sum(i.tax_amount) * (select f from factor), 2) as base,
                             round(sum(i.tax_amount) * (select f from factor), 2) as amount
                        from items i where not i.comped group by i.tax_rate) x),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount, 'tip', p.tip)
                                           order by p.created_at), '[]'::jsonb)
                   from public.payments p where p.order_id = p_order_id and p.voided_at is null)
  )
$$;

-- Encola el documento de venta de una orden pagada (idempotente, nunca lanza).
create or replace function private.enqueue_sale_document(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order  public.orders;
  v_tenant public.tenants;
begin
  select * into v_order from public.orders where id = p_order_id;
  select * into v_tenant from public.tenants where id = v_order.tenant_id;
  if not v_tenant.einvoice_enabled or v_tenant.einvoice_provider = 'none' or v_order.status <> 'paid' then
    return;
  end if;

  insert into public.einvoice_documents
    (tenant_id, order_id, doc_type, provider, environment, customer, payload, created_by)
  values
    (v_order.tenant_id, v_order.id,
     case when v_order.billing_customer is not null then 'invoice' else v_tenant.einvoice_default_doc end,
     v_tenant.einvoice_provider, v_tenant.einvoice_environment, v_order.billing_customer,
     private.einvoice_payload(v_order.id), auth.uid())
  on conflict do nothing;
exception when others then
  -- La facturación jamás debe impedir cobrar: se registra y se reconcilia luego.
  raise warning 'einvoice enqueue failed for order %: %', p_order_id, sqlerrm;
end $$;

-- Reacciona a los cambios de estado de pago de la orden.
create or replace function private.einvoice_on_order_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.einvoice_documents;
begin
  if new.status = 'paid' and old.status <> 'paid' then
    perform private.enqueue_sale_document(new.id);

  elsif old.status = 'paid' and new.status <> 'paid' then
    -- Reapertura por anulación de pago: cancela lo no enviado; nota crédito sobre lo aceptado.
    begin
      update public.einvoice_documents
         set status = 'cancelled', last_error = 'Cuenta reabierta antes del envío'
       where order_id = new.id and doc_type in ('pos', 'invoice') and status in ('pending', 'error');

      for v_doc in
        select * from public.einvoice_documents
         where order_id = new.id and doc_type in ('pos', 'invoice') and status = 'accepted' and credited_at is null
      loop
        insert into public.einvoice_documents
          (tenant_id, order_id, doc_type, provider, environment, related_document_id, reason, customer, payload, created_by)
        values
          (v_doc.tenant_id, v_doc.order_id, 'credit_note', v_doc.provider, v_doc.environment, v_doc.id,
           coalesce((select p.void_reason from public.payments p
                      where p.order_id = new.id and p.voided_at is not null
                      order by p.voided_at desc limit 1), 'Anulación de pago'),
           v_doc.customer, v_doc.payload, auth.uid());
        update public.einvoice_documents set credited_at = now() where id = v_doc.id;
      end loop;
    exception when others then
      raise warning 'einvoice credit note failed for order %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists orders_einvoice on public.orders;
create trigger orders_einvoice
  after update of status on public.orders
  for each row execute function private.einvoice_on_order_change();

-- ─── 4. RPCs de administración ─────────────────────────────────────────────────
-- Datos del cliente para factura a su nombre (antes de cobrar).
create or replace function public.set_billing_customer(p_order_id uuid, p_customer jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.has_role('admin', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.orders
     set billing_customer = case when p_customer is null or p_customer = '{}'::jsonb then null else p_customer end
   where id = p_order_id and status not in ('paid', 'cancelled');
  if not found then
    raise exception 'order_closed' using errcode = '22023';
  end if;
end $$;

-- Reintento manual de un documento con error / rechazado.
create or replace function public.retry_einvoice_document(p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.einvoice_documents
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
   where id = p_document_id and tenant_id = private.current_tenant_id()
     and status in ('error', 'rejected');
  if not found then
    raise exception 'einvoice_not_retryable' using errcode = '22023';
  end if;
end $$;

-- Encola documentos para cuentas pagadas sin documento (p. ej. al activar la
-- facturación a mitad del día o si un encolado falló).
create or replace function public.enqueue_missing_einvoices(p_since timestamptz default now() - interval '1 day')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_order  uuid;
  v_count  integer := 0;
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t
                  where t.id = v_tenant and t.einvoice_enabled and t.einvoice_provider <> 'none') then
    raise exception 'einvoice_disabled' using errcode = '22023';
  end if;
  for v_order in
    select o.id from public.orders o
     where o.tenant_id = v_tenant and o.status = 'paid' and o.closed_at >= p_since
       and not exists (select 1 from public.einvoice_documents d
                        where d.order_id = o.id and d.doc_type in ('pos', 'invoice')
                          and d.status <> 'cancelled' and d.credited_at is null)
  loop
    perform private.enqueue_sale_document(v_order);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ─── 5. Privilegios ────────────────────────────────────────────────────────────
revoke all on function private.einvoice_payload(uuid) from public, anon, authenticated;
revoke all on function private.enqueue_sale_document(uuid) from public, anon, authenticated;
revoke all on function private.einvoice_on_order_change() from public, anon, authenticated;
revoke execute on function public.set_billing_customer(uuid, jsonb) from public, anon;
revoke execute on function public.retry_einvoice_document(uuid) from public, anon;
revoke execute on function public.enqueue_missing_einvoices(timestamptz) from public, anon;
grant execute on function public.set_billing_customer(uuid, jsonb) to authenticated;
grant execute on function public.retry_einvoice_document(uuid) to authenticated;
grant execute on function public.enqueue_missing_einvoices(timestamptz) to authenticated;

-- Realtime: el panel de facturación ve los cambios de estado al instante.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'einvoice_documents') then
    alter publication supabase_realtime add table public.einvoice_documents;
  end if;
end $$;
