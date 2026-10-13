-- ════════════════════════════════════════════════════════════════════════════════
-- 023 · Historial de ventas importado (resumen diario y por producto/mes)
--
-- Las ventas anteriores a GastroBar (p. ej. las de SIGEC) entran como RESUMEN, no
-- como cuentas: no descuentan inventario, no aparecen en cierres de caja ni en la
-- operación. Sirven para comparar «este mes contra el mismo mes del año pasado»
-- desde el primer día (Análisis y asistente de IA).
-- Las escribe sólo el servidor (rol de servicio) al importar; las leen el admin y
-- los agentes de IA de su propio gastrobar.
-- ════════════════════════════════════════════════════════════════════════════════

create table if not exists public.sales_history_days (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day       date not null,
  orders    integer not null default 0 check (orders >= 0),
  revenue   numeric(14, 2) not null default 0 check (revenue >= 0),   -- venta con impuestos, como la factura
  tips      numeric(14, 2) not null default 0 check (tips >= 0),
  discounts numeric(14, 2) not null default 0 check (discounts >= 0),
  payments  jsonb not null default '{}'::jsonb,                        -- {cash, card, transfer, other}
  source    text not null default 'import' check (char_length(source) between 1 and 40),
  primary key (tenant_id, day)
);

create table if not exists public.sales_history_products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  product_id   uuid,                                                    -- el producto equivalente en la carta, si existe
  product_name text not null check (char_length(product_name) between 1 and 160),
  category     text,
  quantity     numeric(14, 3) not null default 0,
  revenue      numeric(14, 2) not null default 0,
  source       text not null default 'import' check (char_length(source) between 1 and 40),
  unique (tenant_id, month, product_name),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete set null (product_id)
);
create index if not exists sales_history_products_month_idx on public.sales_history_products (tenant_id, month);

alter table public.sales_history_days     enable row level security;
alter table public.sales_history_products enable row level security;

drop policy if exists sales_history_days_select on public.sales_history_days;
create policy sales_history_days_select on public.sales_history_days
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'ai_agent')));
drop policy if exists sales_history_products_select on public.sales_history_products;
create policy sales_history_products_select on public.sales_history_products
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'ai_agent')));
