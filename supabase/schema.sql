-- =============================================================================
-- GastroBar POS · Esquema Supabase multi-tenant
-- -----------------------------------------------------------------------------
-- Aislamiento por inquilino (tenant_id) con Row Level Security, FKs compuestas
-- (tenant_id, id) para impedir referencias cruzadas entre tenants, triggers de
-- stock por receta (g / ml / unidad) y publicación Realtime para KDS/sala.
--
-- Ejecutar completo en el SQL Editor de Supabase (proyecto nuevo) o con:
--   supabase db reset   (si se copia a supabase/migrations)
-- =============================================================================

-- gen_random_uuid() es nativo desde PostgreSQL 13 (no requiere pgcrypto).

-- Funciones internas (security definer, helpers de RLS y triggers) viven en un
-- esquema NO expuesto por PostgREST, así no pueden invocarse vía /rest/v1/rpc.
create schema if not exists private;

-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================
create type public.app_role       as enum ('admin', 'cashier', 'waiter', 'kitchen', 'bar', 'ai_agent');
create type public.station        as enum ('kitchen', 'bar');
create type public.order_status   as enum ('pending', 'in_preparation', 'ready', 'delivered', 'paid', 'cancelled');
create type public.item_status    as enum ('pending', 'in_preparation', 'ready', 'delivered', 'cancelled');
create type public.table_status   as enum ('free', 'occupied', 'reserved', 'cleaning');
create type public.measure_unit   as enum ('g', 'ml', 'unit');
create type public.payment_method as enum ('cash', 'card', 'transfer', 'other');
create type public.split_type     as enum ('full', 'by_item', 'equal', 'custom');
create type public.movement_type  as enum ('sale', 'sale_reversal', 'waste', 'purchase', 'adjustment');
create type public.order_source   as enum ('pos', 'ai_agent', 'qr');

-- =============================================================================
-- 2. TABLAS
-- =============================================================================

-- 2.1 Tenants ------------------------------------------------------------------
create table public.tenants (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 2 and 120),
  slug                 text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$'),
  currency             text not null default 'COP' check (char_length(currency) = 3),
  locale               text not null default 'es-CO',
  timezone             text not null default 'America/Bogota',
  kds_warning_minutes  integer not null default 10 check (kds_warning_minutes > 0),
  kds_late_minutes     integer not null default 20 check (kds_late_minutes > 0),
  allow_negative_stock boolean not null default false,
  order_seq            bigint not null default 0,
  created_at           timestamptz not null default now(),
  check (kds_late_minutes > kds_warning_minutes)
);

-- 2.2 Profiles (1 usuario = 1 tenant) ----------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  role       public.app_role not null default 'waiter',
  full_name  text not null check (char_length(full_name) between 1 and 120),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index profiles_tenant_idx on public.profiles (tenant_id);

-- 2.3 Zonas y mesas ---------------------------------------------------------------
create table public.zones (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.tables (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  zone_id    uuid not null,
  label      text not null,
  seats      integer not null default 4 check (seats > 0),
  status     public.table_status not null default 'free',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, label),
  foreign key (tenant_id, zone_id) references public.zones (tenant_id, id) on delete cascade
);
create index tables_zone_idx on public.tables (tenant_id, zone_id);

-- 2.4 Menú ----------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  station    public.station not null,            -- enrutamiento: cocina o barra
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  category_id uuid not null,
  name        text not null,
  description text,
  price       numeric(12, 2) not null check (price >= 0),
  image_url   text,
  is_active   boolean not null default true,
  track_stock boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references public.categories (tenant_id, id) on delete restrict
);
create index products_category_idx on public.products (tenant_id, category_id);

-- Modificadores ("sin hielo", "término medio", "doble shot +3.000").
-- product_id  -> aplica a un producto; category_id -> a toda la categoría;
-- ambos nulos -> modificador global del tenant.
create table public.modifiers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  category_id uuid,
  product_id  uuid,
  name        text not null,
  price_delta numeric(12, 2) not null default 0,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references public.categories (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id)  references public.products (tenant_id, id) on delete cascade
);
create index modifiers_scope_idx on public.modifiers (tenant_id, product_id, category_id);

-- 2.5 Inventario y recetas --------------------------------------------------------------
create table public.ingredients (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  name           text not null,
  unit           public.measure_unit not null,        -- g | ml | unit
  stock_quantity numeric(14, 3) not null default 0,
  min_stock      numeric(14, 3) not null default 0 check (min_stock >= 0),
  cost_per_unit  numeric(14, 4) not null default 0 check (cost_per_unit >= 0), -- costo por g / ml / unidad
  is_liquor      boolean not null default false,
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

-- Preparaciones intermedias (jarabe simple, salsa de la casa, mix de sour...)
create table public.sub_recipes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  name           text not null,
  yield_quantity numeric(14, 3) not null check (yield_quantity > 0),  -- rendimiento del lote
  yield_unit     public.measure_unit not null,
  notes          text,
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.sub_recipe_ingredients (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  sub_recipe_id uuid not null,
  ingredient_id uuid not null,
  quantity      numeric(14, 3) not null check (quantity > 0),  -- por lote (yield_quantity)
  unique (sub_recipe_id, ingredient_id),
  foreign key (tenant_id, sub_recipe_id) references public.sub_recipes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references public.ingredients (tenant_id, id) on delete restrict
);

-- Ficha técnica: cada línea consume un insumo directo o una porción de sub-receta.
create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  product_id    uuid not null,
  ingredient_id uuid,
  sub_recipe_id uuid,
  quantity      numeric(14, 3) not null check (quantity > 0),  -- g / ml / unidades por porción
  check (num_nonnulls(ingredient_id, sub_recipe_id) = 1),
  foreign key (tenant_id, product_id)    references public.products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references public.ingredients (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sub_recipe_id) references public.sub_recipes (tenant_id, id) on delete restrict
);
create index recipes_product_idx on public.recipes (tenant_id, product_id);

-- 2.6 Comandas ------------------------------------------------------------------
create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  order_number bigint not null default 0,
  table_id     uuid,                                   -- null = para llevar / barra
  waiter_id    uuid,
  status       public.order_status not null default 'pending',
  source       public.order_source not null default 'pos',
  guests       integer check (guests is null or guests > 0),
  notes        text,
  subtotal     numeric(12, 2) not null default 0,
  total        numeric(12, 2) not null default 0,
  paid_amount  numeric(12, 2) not null default 0,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, table_id)  references public.tables (tenant_id, id) on delete restrict,
  foreign key (tenant_id, waiter_id) references public.profiles (tenant_id, id) on delete set null (waiter_id)
);
create index orders_tenant_status_idx on public.orders (tenant_id, status, created_at desc);
-- Una sola comanda abierta por mesa (las rondas nuevas se agregan a ella).
create unique index orders_one_open_per_table
  on public.orders (table_id)
  where table_id is not null and status not in ('paid', 'cancelled');

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  order_id        uuid not null,
  product_id      uuid not null,
  product_name    text not null default '',              -- snapshot (lo fija el trigger)
  station         public.station not null default 'kitchen', -- lo fija el trigger desde la categoría
  quantity        integer not null check (quantity between 1 and 99),
  unit_price      numeric(12, 2) not null default 0,      -- lo fija el trigger desde products.price
  modifier_ids    uuid[] not null default '{}',
  modifiers       jsonb not null default '[]'::jsonb,     -- [{id, name, price_delta}]
  modifiers_total numeric(12, 2) not null default 0,
  line_total      numeric(12, 2) not null default 0,         -- quantity * (unit_price + modifiers_total), lo fija el trigger
  notes           text check (notes is null or char_length(notes) <= 280),
  status          public.item_status not null default 'pending',
  round           integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  started_at      timestamptz,
  ready_at        timestamptz,
  delivered_at    timestamptz,
  cancelled_at    timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, order_id)   references public.orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete restrict
);
create index order_items_order_idx on public.order_items (tenant_id, order_id);
create index order_items_kds_idx   on public.order_items (tenant_id, station, status, created_at);

-- 2.7 Pagos (split-bill) -----------------------------------------------------------
create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  order_id    uuid not null,
  amount      numeric(12, 2) not null check (amount > 0),     -- abona a la cuenta
  tip         numeric(12, 2) not null default 0 check (tip >= 0),
  method      public.payment_method not null,
  split_type  public.split_type not null default 'full',
  split_group uuid,                                            -- pagos de una misma división
  split_label text,                                            -- "Comensal 2", "Ana"...
  reference   text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade
);
create index payments_order_idx  on public.payments (tenant_id, order_id);
create index payments_created_idx on public.payments (tenant_id, created_at desc);

-- Asignación de ítems a un pago (split por ítem).
create table public.payment_allocations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  payment_id    uuid not null,
  order_item_id uuid not null,
  amount        numeric(12, 2) not null check (amount > 0),
  foreign key (tenant_id, payment_id)    references public.payments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, order_item_id) references public.order_items (tenant_id, id) on delete cascade
);
create index payment_allocations_item_idx on public.payment_allocations (tenant_id, order_item_id);

-- 2.8 Kardex de inventario -------------------------------------------------------------
create table public.inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  ingredient_id uuid not null,
  movement_type public.movement_type not null,
  quantity      numeric(14, 3) not null,          -- con signo: negativo = salida
  unit_cost     numeric(14, 4) not null default 0,
  order_item_id uuid,
  reason        text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, ingredient_id) references public.ingredients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, order_item_id) references public.order_items (tenant_id, id) on delete set null (order_item_id)
);
create index inventory_movements_idx on public.inventory_movements (tenant_id, created_at desc);
create index inventory_movements_ingredient_idx on public.inventory_movements (tenant_id, ingredient_id, created_at desc);

-- =============================================================================
-- 3. HELPERS DE CONTEXTO (tenant / rol del usuario autenticado)
-- =============================================================================
create or replace function private.current_tenant_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function private.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function private.has_role(variadic roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = any (roles), false)
$$;

-- =============================================================================
-- 4. TRIGGERS GENÉRICOS
-- =============================================================================
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Rellena tenant_id desde la sesión si el cliente no lo envía. La política RLS
-- (with check) garantiza que coincida con el tenant del usuario.
create or replace function private.set_tenant_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tenant_id is null then
    new.tenant_id := private.current_tenant_id();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'zones', 'tables', 'categories', 'products', 'modifiers', 'ingredients',
    'sub_recipes', 'sub_recipe_ingredients', 'recipes', 'orders', 'order_items',
    'payments', 'payment_allocations', 'inventory_movements'
  ] loop
    -- Postgres ejecuta los triggers del mismo evento en orden alfabético: el
    -- prefijo "00" garantiza que tenant_id exista antes del resto de BEFORE INSERT.
    execute format(
      'create trigger %I before insert on public.%I for each row execute function private.set_tenant_id()',
      t || '_00_set_tenant', t);
  end loop;

  foreach t in array array['products', 'ingredients', 'orders', 'order_items'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      t || '_updated_at', t);
  end loop;
end $$;

-- =============================================================================
-- 5. LÓGICA DE COMANDAS
-- =============================================================================

-- 5.1 Numeración correlativa por tenant + mesa ocupada ----------------------------
create or replace function private.before_order_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.tenants set order_seq = order_seq + 1
   where id = new.tenant_id
  returning order_seq into new.order_number;

  new.status      := 'pending';
  new.subtotal    := 0;
  new.total       := 0;
  new.paid_amount := 0;
  return new;
end $$;

create trigger orders_before_insert
  before insert on public.orders
  for each row execute function private.before_order_insert();

create or replace function private.after_order_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.table_id is not null then
    update public.tables set status = 'occupied'
     where id = new.table_id and tenant_id = new.tenant_id;
  end if;
  return null;
end $$;

create trigger orders_after_insert
  after insert on public.orders
  for each row execute function private.after_order_insert();

-- 5.2 Protección de columnas y cierre de mesa -------------------------------------
create or replace function private.before_order_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Columnas administradas por el sistema (sólo triggers internos las cambian:
  -- ellos corren con pg_trigger_depth() > 1).
  if pg_trigger_depth() = 1 then
    new.tenant_id    := old.tenant_id;
    new.order_number := old.order_number;
    new.subtotal     := old.subtotal;
    new.total        := old.total;
    new.paid_amount  := old.paid_amount;
    new.created_at   := old.created_at;
    new.created_by   := old.created_by;
    if new.status is distinct from old.status then
      -- Manualmente sólo se permite cancelar (y sólo sin pagos registrados).
      if new.status <> 'cancelled' then
        raise exception 'order_status_is_derived' using errcode = '22023',
          hint = 'El estado de la orden se deriva de sus ítems y pagos.';
      end if;
      if old.paid_amount > 0 then
        raise exception 'order_has_payments' using errcode = '22023';
      end if;
    end if;
  end if;

  if new.status in ('paid', 'cancelled') and old.status not in ('paid', 'cancelled') then
    new.closed_at := now();
  end if;
  return new;
end $$;

create trigger orders_before_update
  before update on public.orders
  for each row execute function private.before_order_update();

create or replace function private.after_order_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Cancelación manual de la orden => cancela ítems vivos (devuelve stock).
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.order_items
       set status = 'cancelled'
     where order_id = new.id and tenant_id = new.tenant_id and status <> 'cancelled';
  end if;

  if new.table_id is not null
     and new.status in ('paid', 'cancelled')
     and old.status not in ('paid', 'cancelled')
     and not exists (
       select 1 from public.orders o
        where o.table_id = new.table_id and o.id <> new.id
          and o.status not in ('paid', 'cancelled'))
  then
    update public.tables set status = 'free'
     where id = new.table_id and tenant_id = new.tenant_id;
  end if;
  return null;
end $$;

create trigger orders_after_update
  after update on public.orders
  for each row execute function private.after_order_update();

-- 5.3 Ítems: precio, estación y modificadores los decide el servidor ----------------
create or replace function private.before_order_item_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_product  record;
  v_status   public.order_status;
  v_mods     jsonb;
  v_mods_tot numeric;
  v_mods_cnt integer;
begin
  select o.status into v_status
    from public.orders o where o.id = new.order_id and o.tenant_id = new.tenant_id;
  if v_status is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_status in ('paid', 'cancelled') then
    raise exception 'order_closed' using errcode = '22023';
  end if;

  select p.name, p.price, p.is_active, p.category_id, c.station, c.is_active as category_active
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

  new.product_name    := v_product.name;
  new.unit_price      := v_product.price;
  new.station         := v_product.station;
  new.modifiers       := v_mods;
  new.modifiers_total := v_mods_tot;
  new.line_total      := new.quantity * (v_product.price + v_mods_tot);
  new.status          := 'pending';
  new.started_at      := null;
  new.ready_at        := null;
  new.delivered_at    := null;
  new.cancelled_at    := null;
  return new;
end $$;

create trigger order_items_before_insert
  before insert on public.order_items
  for each row execute function private.before_order_item_insert();

-- Máquina de estados de ítems + columnas inmutables.
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
  new.line_total      := old.line_total;
  new.round           := old.round;
  new.created_at      := old.created_at;

  if new.status is distinct from old.status then
    if old.status in ('cancelled', 'delivered') and pg_trigger_depth() = 1 then
      raise exception 'item_status_final: %', old.status using errcode = '22023';
    end if;

    -- Cocina/barra no cancelan; sala no "cocina" (sólo entrega o cancela).
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

create trigger order_items_before_update
  before update on public.order_items
  for each row execute function private.before_order_item_update();

-- 5.4 Recalcula totales y estado derivado de la orden ----------------------------------
create or replace function private.refresh_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_subtotal numeric;
  v_active   integer;
  v_pending  integer;
  v_ready    integer;
  v_deliv    integer;
  v_status   public.order_status;
  v_current  public.order_status;
  v_paid     numeric;
begin
  select o.status, o.paid_amount into v_current, v_paid
    from public.orders o where o.id = p_order_id for update;
  if v_current is null then return; end if;

  select coalesce(sum(i.line_total) filter (where i.status <> 'cancelled'), 0),
         count(*) filter (where i.status <> 'cancelled'),
         count(*) filter (where i.status = 'pending'),
         count(*) filter (where i.status = 'ready'),
         count(*) filter (where i.status = 'delivered')
    into v_subtotal, v_active, v_pending, v_ready, v_deliv
    from public.order_items i where i.order_id = p_order_id;

  if v_current in ('paid', 'cancelled') then
    v_status := v_current;
  elsif v_active = 0 then
    v_status := case when exists (select 1 from public.order_items where order_id = p_order_id)
                     then 'cancelled'::public.order_status else 'pending'::public.order_status end;
  elsif v_paid > 0 and v_paid >= v_subtotal then
    v_status := 'paid';
  elsif v_deliv = v_active then
    v_status := 'delivered';
  elsif v_ready + v_deliv = v_active then
    v_status := 'ready';
  elsif v_pending = v_active then
    v_status := 'pending';
  else
    v_status := 'in_preparation';
  end if;

  update public.orders
     set subtotal = v_subtotal,
         total    = v_subtotal,
         status   = v_status
   where id = p_order_id;
end $$;

create or replace function private.after_order_item_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_order(new.order_id);
  return null;
end $$;

create trigger order_items_after_change
  after insert or update of status on public.order_items
  for each row execute function private.after_order_item_change();

-- =============================================================================
-- 6. STOCK EN TIEMPO REAL SEGÚN RECETAS
-- =============================================================================
-- Descuenta (p_direction = -1) o devuelve (+1) los insumos de un ítem, expandiendo
-- sub-recetas proporcionalmente a su rendimiento. Bloquea la venta si el stock
-- queda negativo, salvo que el tenant permita stock negativo.
create or replace function private.apply_recipe_stock(
  p_tenant_id uuid, p_order_item_id uuid, p_product_id uuid, p_quantity integer, p_direction integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r          record;
  v_stock    numeric;
  v_cost     numeric;
  v_allow    boolean;
begin
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = p_tenant_id and track_stock) then
    return;
  end if;

  select allow_negative_stock into v_allow from public.tenants where id = p_tenant_id;

  for r in
    select x.ingredient_id, sum(x.qty) * p_quantity as qty
      from (
        select rc.ingredient_id, rc.quantity as qty
          from public.recipes rc
         where rc.tenant_id = p_tenant_id and rc.product_id = p_product_id and rc.ingredient_id is not null
        union all
        select sri.ingredient_id, rc.quantity / sr.yield_quantity * sri.quantity
          from public.recipes rc
          join public.sub_recipes sr on sr.id = rc.sub_recipe_id and sr.tenant_id = rc.tenant_id
          join public.sub_recipe_ingredients sri on sri.sub_recipe_id = sr.id and sri.tenant_id = rc.tenant_id
         where rc.tenant_id = p_tenant_id and rc.product_id = p_product_id
      ) x
     group by x.ingredient_id
     order by x.ingredient_id           -- orden estable => sin deadlocks entre transacciones
  loop
    update public.ingredients i
       set stock_quantity = i.stock_quantity + p_direction * r.qty
     where i.id = r.ingredient_id and i.tenant_id = p_tenant_id
    returning i.stock_quantity, i.cost_per_unit into v_stock, v_cost;

    if p_direction < 0 and v_stock < 0 and not v_allow then
      raise exception 'insufficient_stock' using errcode = 'P0001',
        detail = (select name from public.ingredients where id = r.ingredient_id);
    end if;

    insert into public.inventory_movements
      (tenant_id, ingredient_id, movement_type, quantity, unit_cost, order_item_id, created_by)
    values
      (p_tenant_id, r.ingredient_id,
       case when p_direction < 0 then 'sale'::public.movement_type else 'sale_reversal'::public.movement_type end,
       p_direction * r.qty, v_cost, p_order_item_id, auth.uid());
  end loop;
end $$;

create or replace function private.order_item_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.apply_recipe_stock(new.tenant_id, new.id, new.product_id, new.quantity, -1);
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.apply_recipe_stock(new.tenant_id, new.id, new.product_id, new.quantity, 1);
  end if;
  return null;
end $$;

create trigger order_items_stock
  after insert or update of status on public.order_items
  for each row execute function private.order_item_stock();

-- =============================================================================
-- 7. PAGOS
-- =============================================================================
create or replace function private.before_payment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_order record;
begin
  select o.status, o.total, o.paid_amount into v_order
    from public.orders o where o.id = new.order_id and o.tenant_id = new.tenant_id
     for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_order.status in ('paid', 'cancelled') then
    raise exception 'order_closed' using errcode = '22023';
  end if;
  if new.amount > v_order.total - v_order.paid_amount + 0.009 then
    raise exception 'overpayment' using errcode = '22023',
      detail = format('restante=%s, recibido=%s', v_order.total - v_order.paid_amount, new.amount);
  end if;
  return new;
end $$;

create trigger payments_before_insert
  before insert on public.payments
  for each row execute function private.before_payment_insert();

create or replace function private.after_payment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.orders o
     set paid_amount = o.paid_amount + new.amount,
         status = case when o.paid_amount + new.amount >= o.total - 0.009
                       then 'paid'::public.order_status else o.status end
   where o.id = new.order_id;
  return null;
end $$;

create trigger payments_after_insert
  after insert on public.payments
  for each row execute function private.after_payment_insert();

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
    from public.payment_allocations a where a.order_item_id = new.order_item_id;
  if v_allocated + new.amount > v_line + 0.009 then
    raise exception 'item_overallocated' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger payment_allocations_before_insert
  before insert on public.payment_allocations
  for each row execute function private.before_allocation_insert();

-- =============================================================================
-- 8. RPCs PÚBLICAS (security invoker => RLS aplica)
-- =============================================================================

-- 8.1 Alta de tenant: el usuario autenticado sin perfil crea su gastrobar como admin.
create or replace function public.create_tenant(p_name text, p_slug text, p_full_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.tenants (name, slug) values (trim(p_name), lower(trim(p_slug)))
  returning id into v_tenant;

  insert into public.profiles (id, tenant_id, role, full_name)
  values (auth.uid(), v_tenant, 'admin', trim(p_full_name));

  return v_tenant;
end $$;

-- 8.2 Enviar comanda: crea la orden de la mesa o agrega una ronda a la abierta.
--     p_items = [{ "product_id": uuid, "quantity": int, "modifier_ids": [uuid], "notes": text }]
create or replace function public.submit_order(
  p_table_id uuid,
  p_items    jsonb,
  p_notes    text    default null,
  p_guests   integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_order_id uuid;
  v_round    integer := 1;
  v_item     jsonb;
  v_source   public.order_source;
  v_result   jsonb;
begin
  if not private.has_role('admin', 'cashier', 'waiter', 'ai_agent') then
    raise exception 'forbidden' using errcode = '42501';
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

  select jsonb_build_object(
           'order_id', o.id, 'order_number', o.order_number, 'round', v_round,
           'status', o.status, 'total', o.total, 'table_id', o.table_id)
    into v_result
    from public.orders o where o.id = v_order_id;
  return v_result;
end $$;

-- 8.3 Registrar pagos (uno o varios, con división) de forma atómica.
--     p_payments = [{ "amount": num, "tip": num, "method": text, "label": text,
--                     "reference": text, "allocations": [{ "order_item_id": uuid, "amount": num }] }]
create or replace function public.register_payments(
  p_order_id   uuid,
  p_split_type public.split_type,
  p_payments   jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_group   uuid := gen_random_uuid();
  v_pay     jsonb;
  v_alloc   jsonb;
  v_pay_id  uuid;
  v_result  jsonb;
begin
  if not private.has_role('admin', 'cashier', 'waiter', 'ai_agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'no_payments' using errcode = '22023';
  end if;

  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  for v_pay in select value from jsonb_array_elements(p_payments) loop
    insert into public.payments (order_id, amount, tip, method, split_type, split_group, split_label, reference)
    values (
      p_order_id,
      (v_pay ->> 'amount')::numeric,
      coalesce((v_pay ->> 'tip')::numeric, 0),
      (v_pay ->> 'method')::public.payment_method,
      p_split_type,
      v_group,
      nullif(trim(v_pay ->> 'label'), ''),
      nullif(trim(v_pay ->> 'reference'), ''))
    returning id into v_pay_id;

    for v_alloc in select value from jsonb_array_elements(coalesce(v_pay -> 'allocations', '[]'::jsonb)) loop
      insert into public.payment_allocations (payment_id, order_item_id, amount)
      values (v_pay_id, (v_alloc ->> 'order_item_id')::uuid, (v_alloc ->> 'amount')::numeric);
    end loop;
  end loop;

  select jsonb_build_object(
           'order_id', o.id, 'status', o.status, 'total', o.total,
           'paid_amount', o.paid_amount, 'remaining', greatest(o.total - o.paid_amount, 0),
           'split_group', v_group)
    into v_result
    from public.orders o where o.id = p_order_id;
  return v_result;
end $$;

-- 8.4 Movimientos manuales de inventario (merma, compra, ajuste).
--     p_quantity siempre positivo para waste/purchase; con signo para adjustment.
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
  if p_type = 'waste' and not private.has_role('admin', 'kitchen', 'bar', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_type in ('purchase', 'adjustment') and not private.has_role('admin') then
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

  insert into public.inventory_movements (tenant_id, ingredient_id, movement_type, quantity, unit_cost, reason, created_by)
  values (v_tenant, p_ingredient_id, p_type, v_delta, coalesce(p_unit_cost, v_ing.cost_per_unit),
          nullif(trim(p_reason), ''), auth.uid());

  return v_ing;
end $$;

-- 8.5 Métricas consolidadas del turno (dashboard + agentes ejecutivos).
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
     where p.tenant_id = v_tenant and p.created_at >= p_from and p.created_at < p_to
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

-- =============================================================================
-- 9. VISTA DE DISPONIBILIDAD DE MENÚ (porciones posibles según stock)
-- =============================================================================
create or replace view public.product_availability
with (security_invoker = true) as
with needs as (
  select rc.tenant_id, rc.product_id, rc.ingredient_id, rc.quantity as qty
    from public.recipes rc
   where rc.ingredient_id is not null
  union all
  select rc.tenant_id, rc.product_id, sri.ingredient_id, rc.quantity / sr.yield_quantity * sri.quantity
    from public.recipes rc
    join public.sub_recipes sr on sr.id = rc.sub_recipe_id
    join public.sub_recipe_ingredients sri on sri.sub_recipe_id = sr.id
),
agg as (
  select tenant_id, product_id, ingredient_id, sum(qty) as qty
    from needs group by tenant_id, product_id, ingredient_id
),
portions as (
  select a.product_id,
         min(floor(greatest(i.stock_quantity, 0) / a.qty))::integer as max_portions,
         bool_or(i.stock_quantity <= i.min_stock) as low_stock
    from agg a
    join public.ingredients i on i.id = a.ingredient_id and i.tenant_id = a.tenant_id
   group by a.product_id
)
select p.id          as product_id,
       p.tenant_id,
       p.category_id,
       c.name        as category_name,
       c.station,
       p.name,
       p.description,
       p.price,
       p.image_url,
       p.sort_order,
       (p.is_active and c.is_active) as is_active,
       case when p.track_stock and po.product_id is not null then po.max_portions end as available_portions,
       (p.is_active and c.is_active
         and (not p.track_stock or po.product_id is null or po.max_portions > 0)) as is_available,
       coalesce(po.low_stock, false) as low_stock
  from public.products p
  join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
  left join portions po on po.product_id = p.id;

-- =============================================================================
-- 10. ROW LEVEL SECURITY
-- =============================================================================
alter table public.tenants                enable row level security;
alter table public.profiles               enable row level security;
alter table public.zones                  enable row level security;
alter table public.tables                 enable row level security;
alter table public.categories             enable row level security;
alter table public.products               enable row level security;
alter table public.modifiers              enable row level security;
alter table public.ingredients            enable row level security;
alter table public.sub_recipes            enable row level security;
alter table public.sub_recipe_ingredients enable row level security;
alter table public.recipes                enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.payments               enable row level security;
alter table public.payment_allocations    enable row level security;
alter table public.inventory_movements    enable row level security;

-- 10.1 Tenants
create policy tenants_select on public.tenants
  for select to authenticated
  using (id = (select private.current_tenant_id()));

create policy tenants_update_admin on public.tenants
  for update to authenticated
  using (id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (id = (select private.current_tenant_id()));

-- 10.2 Profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()));

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (tenant_id = (select private.current_tenant_id())
         and (select private.has_role('admin')) and id <> (select auth.uid()));

-- 10.3 Lectura por tenant para todas las tablas operativas + escritura admin
--      para catálogo e inventario maestro.
do $$
declare t text;
begin
  foreach t in array array[
    'zones', 'tables', 'categories', 'products', 'modifiers', 'ingredients',
    'sub_recipes', 'sub_recipe_ingredients', 'recipes', 'orders', 'order_items',
    'payments', 'payment_allocations', 'inventory_movements'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (tenant_id = (select private.current_tenant_id()))
    $f$, t || '_select', t);
  end loop;

  foreach t in array array[
    'zones', 'tables', 'categories', 'products', 'modifiers', 'ingredients',
    'sub_recipes', 'sub_recipe_ingredients', 'recipes'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
        with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
    $f$, t || '_admin_write', t);
  end loop;
end $$;

-- 10.4 Mesas: sala y caja cambian estado (reservada, limpieza...)
create policy tables_update_floor on public.tables
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id())
         and (select private.has_role('cashier', 'waiter')))
  with check (tenant_id = (select private.current_tenant_id()));

-- 10.5 Órdenes
create policy orders_insert on public.orders
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and (select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')));

create policy orders_update on public.orders
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id())
         and (select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')))
  with check (tenant_id = (select private.current_tenant_id()));

create policy orders_delete_admin on public.orders
  for delete to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- 10.6 Ítems: sala crea; cocina/barra sólo actualizan los de SU estación.
create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and (select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')));

create policy order_items_update on public.order_items
  for update to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (
      (select private.has_role('admin', 'cashier', 'waiter', 'ai_agent'))
      or (station = 'kitchen' and (select private.has_role('kitchen')))
      or (station = 'bar'     and (select private.has_role('bar')))
    ))
  with check (tenant_id = (select private.current_tenant_id()));

-- 10.7 Pagos: registro inmutable (sin update/delete desde clientes).
create policy payments_insert on public.payments
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and (select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')));

create policy payment_allocations_insert on public.payment_allocations
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and (select private.has_role('admin', 'cashier', 'waiter', 'ai_agent')));

-- inventory_movements: sólo lectura; se escriben vía triggers / record_inventory_movement.

-- =============================================================================
-- 11. PRIVILEGIOS
-- =============================================================================
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_tenant_id()                  to authenticated;
grant execute on function private.current_app_role()                   to authenticated;
grant execute on function private.has_role(variadic public.app_role[]) to authenticated;

revoke execute on function public.create_tenant(text, text, text)                                          from public, anon;
revoke execute on function public.submit_order(uuid, jsonb, text, integer)                                 from public, anon;
revoke execute on function public.register_payments(uuid, public.split_type, jsonb)                        from public, anon;
revoke execute on function public.record_inventory_movement(uuid, public.movement_type, numeric, text, numeric) from public, anon;
revoke execute on function public.get_shift_metrics(timestamptz, timestamptz)                              from public, anon;

grant execute on function public.create_tenant(text, text, text)                                          to authenticated;
grant execute on function public.submit_order(uuid, jsonb, text, integer)                                 to authenticated;
grant execute on function public.register_payments(uuid, public.split_type, jsonb)                        to authenticated;
grant execute on function public.record_inventory_movement(uuid, public.movement_type, numeric, text, numeric) to authenticated;
grant execute on function public.get_shift_metrics(timestamptz, timestamptz)                              to authenticated;

revoke all on public.product_availability from anon;
grant select on public.product_availability to authenticated;

-- =============================================================================
-- 12. REALTIME
-- =============================================================================
-- replica identity full: los UPDATE llegan con la fila completa, lo que permite
-- filtrar por estación en el KDS y evaluar RLS sobre el evento.
alter table public.orders      replica identity full;
alter table public.order_items replica identity full;
alter table public.tables      replica identity full;

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['orders', 'order_items', 'tables', 'payments', 'ingredients'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- 13. ADMINISTRACIÓN DE CATÁLOGO (también en migrations/002_catalog_admin.sql)
-- =============================================================================
-- Crea o actualiza un producto y (si p_recipe no es null) reemplaza su receta.
-- p_recipe = [{ "ingredient_id": uuid } | { "sub_recipe_id": uuid }, "quantity": num ]
create or replace function public.save_product(
  p_id          uuid,
  p_category_id uuid,
  p_name        text,
  p_description text,
  p_price       numeric,
  p_is_active   boolean,
  p_track_stock boolean,
  p_sort_order  integer,
  p_recipe      jsonb default null)
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
    insert into public.products (category_id, name, description, price, is_active, track_stock, sort_order)
    values (p_category_id, trim(p_name), nullif(trim(p_description), ''), p_price,
            coalesce(p_is_active, true), coalesce(p_track_stock, true), coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.products
       set category_id = p_category_id,
           name        = trim(p_name),
           description = nullif(trim(p_description), ''),
           price       = p_price,
           is_active   = coalesce(p_is_active, is_active),
           track_stock = coalesce(p_track_stock, track_stock),
           sort_order  = coalesce(p_sort_order, sort_order)
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
      values (v_id,
              (v_line ->> 'ingredient_id')::uuid,
              (v_line ->> 'sub_recipe_id')::uuid,
              (v_line ->> 'quantity')::numeric);
    end loop;
  end if;

  return v_id;
end $$;

-- Crea o actualiza una sub-receta y reemplaza sus insumos.
-- p_lines = [{ "ingredient_id": uuid, "quantity": num }]
create or replace function public.save_sub_recipe(
  p_id             uuid,
  p_name           text,
  p_yield_quantity numeric,
  p_yield_unit     public.measure_unit,
  p_notes          text,
  p_lines          jsonb)
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
    insert into public.sub_recipes (name, yield_quantity, yield_unit, notes)
    values (trim(p_name), p_yield_quantity, p_yield_unit, nullif(trim(p_notes), ''))
    returning id into v_id;
  else
    update public.sub_recipes
       set name = trim(p_name), yield_quantity = p_yield_quantity,
           yield_unit = p_yield_unit, notes = nullif(trim(p_notes), '')
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'sub_recipe_not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.sub_recipe_ingredients where sub_recipe_id = v_id;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into public.sub_recipe_ingredients (sub_recipe_id, ingredient_id, quantity)
    values (v_id, (v_line ->> 'ingredient_id')::uuid, (v_line ->> 'quantity')::numeric);
  end loop;

  return v_id;
end $$;

revoke execute on function public.save_product(uuid, uuid, text, text, numeric, boolean, boolean, integer, jsonb) from public, anon;
revoke execute on function public.save_sub_recipe(uuid, text, numeric, public.measure_unit, text, jsonb) from public, anon;
grant execute on function public.save_product(uuid, uuid, text, text, numeric, boolean, boolean, integer, jsonb) to authenticated;
grant execute on function public.save_sub_recipe(uuid, text, numeric, public.measure_unit, text, jsonb) to authenticated;

-- =============================================================================
-- 14. OPERACIÓN: CAJA, CLAVES API, MENÚ QR, STORAGE (también en migrations/003_operations.sql)
-- =============================================================================

-- ─── 1. Datos del negocio para recibos y menú público ──────────────────────────
alter table public.tenants add column if not exists tax_id              text;
alter table public.tenants add column if not exists address             text;
alter table public.tenants add column if not exists phone               text;
alter table public.tenants add column if not exists receipt_footer      text;
alter table public.tenants add column if not exists public_menu_enabled boolean not null default true;

-- ─── 2. Claves API de larga duración para agentes de IA ───────────────────────
-- Sólo se guarda el hash SHA-256 de la clave; la clave completa se muestra una vez.
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  profile_id   uuid not null,
  name         text not null check (char_length(name) between 1 and 80),
  key_prefix   text not null,
  key_hash     text not null unique,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  foreign key (tenant_id, profile_id) references public.profiles (tenant_id, id) on delete cascade
);
create index if not exists api_keys_tenant_idx on public.api_keys (tenant_id, created_at desc);

create or replace function private.before_api_key_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles
                  where id = new.profile_id and tenant_id = new.tenant_id and role = 'ai_agent' and is_active) then
    raise exception 'api_key_requires_ai_agent' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists api_keys_00_set_tenant on public.api_keys;
create trigger api_keys_00_set_tenant before insert on public.api_keys
  for each row execute function private.set_tenant_id();
drop trigger if exists api_keys_before_insert on public.api_keys;
create trigger api_keys_before_insert before insert on public.api_keys
  for each row execute function private.before_api_key_insert();

alter table public.api_keys enable row level security;
drop policy if exists api_keys_admin on public.api_keys;
create policy api_keys_admin on public.api_keys
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- ─── 3. Caja: sesiones, movimientos y reporte Z ─────────────────────────────────
create table if not exists public.cash_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  opened_by     uuid default auth.uid(),
  opened_at     timestamptz not null default now(),
  opening_float numeric(12, 2) not null default 0 check (opening_float >= 0),
  closed_by     uuid,
  closed_at     timestamptz,
  counted_cash  numeric(12, 2),
  expected_cash numeric(12, 2),
  difference    numeric(12, 2),
  notes         text,
  report        jsonb,
  unique (tenant_id, id)
);
-- Una sola caja abierta por gastrobar.
create unique index if not exists cash_sessions_one_open on public.cash_sessions (tenant_id) where closed_at is null;
create index if not exists cash_sessions_tenant_idx on public.cash_sessions (tenant_id, opened_at desc);

create table if not exists public.cash_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  session_id    uuid not null,
  movement_type text not null check (movement_type in ('in', 'out')),
  amount        numeric(12, 2) not null check (amount > 0),
  reason        text not null check (char_length(reason) between 1 and 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, session_id) references public.cash_sessions (tenant_id, id) on delete cascade
);
create index if not exists cash_movements_session_idx on public.cash_movements (tenant_id, session_id);

alter table public.cash_sessions  enable row level security;
alter table public.cash_movements enable row level security;
drop policy if exists cash_sessions_select on public.cash_sessions;
create policy cash_sessions_select on public.cash_sessions
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'cashier')));
drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'cashier')));
-- Escrituras sólo vía las funciones de abajo.

-- Reporte de una sesión hasta p_until (en vivo o de cierre).
create or replace function private.cash_report(p_session public.cash_sessions, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with pay as (
    select p.* from public.payments p
     where p.tenant_id = p_session.tenant_id
       and p.created_at >= p_session.opened_at and p.created_at < p_until
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
    'orders_paid', (select count(*) from public.orders o
                     where o.tenant_id = p_session.tenant_id and o.status = 'paid'
                       and o.closed_at >= p_session.opened_at and o.closed_at < p_until),
    'orders_cancelled', (select count(*) from public.orders o
                          where o.tenant_id = p_session.tenant_id and o.status = 'cancelled'
                            and o.closed_at >= p_session.opened_at and o.closed_at < p_until),
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

create or replace function public.open_cash_session(p_opening_float numeric default 0)
returns public.cash_sessions language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session public.cash_sessions;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.cash_sessions where tenant_id = v_tenant and closed_at is null) then
    raise exception 'cash_session_already_open' using errcode = '23505';
  end if;
  insert into public.cash_sessions (tenant_id, opening_float, opened_by)
  values (v_tenant, coalesce(p_opening_float, 0), auth.uid())
  returning * into v_session;
  return v_session;
end $$;

create or replace function public.add_cash_movement(p_type text, p_amount numeric, p_reason text)
returns public.cash_movements language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session uuid;
  v_row     public.cash_movements;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select id into v_session from public.cash_sessions where tenant_id = v_tenant and closed_at is null;
  if v_session is null then
    raise exception 'cash_session_not_open' using errcode = 'P0002';
  end if;
  insert into public.cash_movements (tenant_id, session_id, movement_type, amount, reason, created_by)
  values (v_tenant, v_session, p_type, p_amount, trim(p_reason), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- Sesión abierta (p_session_id null) o una específica, con su reporte.
create or replace function public.get_cash_session(p_session_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session public.cash_sessions;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_session_id is null then
    select * into v_session from public.cash_sessions where tenant_id = v_tenant and closed_at is null;
  else
    select * into v_session from public.cash_sessions where tenant_id = v_tenant and id = p_session_id;
  end if;
  if v_session.id is null then
    return null;
  end if;
  return to_jsonb(v_session) || jsonb_build_object(
    'report', coalesce(v_session.report, private.cash_report(v_session, now())));
end $$;

create or replace function public.close_cash_session(p_counted_cash numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_session public.cash_sessions;
  v_now     timestamptz := now();
  v_report  jsonb;
  v_expect  numeric;
begin
  if not private.has_role('admin', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  select * into v_session from public.cash_sessions
   where tenant_id = v_tenant and closed_at is null for update;
  if v_session.id is null then
    raise exception 'cash_session_not_open' using errcode = 'P0002';
  end if;

  v_report := private.cash_report(v_session, v_now);
  v_expect := (v_report ->> 'expected_cash')::numeric;

  update public.cash_sessions
     set closed_at = v_now, closed_by = auth.uid(), counted_cash = p_counted_cash,
         expected_cash = v_expect, difference = p_counted_cash - v_expect,
         notes = nullif(trim(p_notes), ''), report = v_report
   where id = v_session.id
  returning * into v_session;

  return to_jsonb(v_session);
end $$;

-- ─── 4. Menú público (QR) ─────────────────────────────────────────────────────
create or replace function public.get_public_menu(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'slug', t.slug, 'currency', t.currency, 'locale', t.locale,
                                 'address', t.address, 'phone', t.phone),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'station', c.station)
                                order by c.sort_order, c.name), '[]'::jsonb)
        from public.categories c
       where c.tenant_id = t.id and c.is_active
         and exists (select 1 from public.products p where p.category_id = c.id and p.is_active)),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', pa.product_id, 'category_id', pa.category_id, 'name', pa.name,
               'description', pa.description, 'price', pa.price, 'image_url', pa.image_url,
               'available', pa.is_available) order by pa.sort_order, pa.name), '[]'::jsonb)
        from public.product_availability pa
       where pa.tenant_id = t.id and pa.is_active),
    'modifiers', (
      select coalesce(jsonb_agg(jsonb_build_object('product_id', m.product_id, 'category_id', m.category_id,
                                                   'name', m.name, 'price_delta', m.price_delta)
                                order by m.sort_order, m.name), '[]'::jsonb)
        from public.modifiers m
       where m.tenant_id = t.id and m.is_active and m.price_delta <> 0)
  )
  from public.tenants t
  where t.slug = lower(p_slug) and t.public_menu_enabled
$$;

-- ─── 5. Privilegios ────────────────────────────────────────────────────────────
revoke all on function private.before_api_key_insert() from public, anon, authenticated;
revoke all on function private.cash_report(public.cash_sessions, timestamptz) from public, anon, authenticated;

revoke execute on function public.open_cash_session(numeric)              from public, anon;
revoke execute on function public.add_cash_movement(text, numeric, text)  from public, anon;
revoke execute on function public.get_cash_session(uuid)                  from public, anon;
revoke execute on function public.close_cash_session(numeric, text)       from public, anon;
grant execute on function public.open_cash_session(numeric)               to authenticated;
grant execute on function public.add_cash_movement(text, numeric, text)   to authenticated;
grant execute on function public.get_cash_session(uuid)                   to authenticated;
grant execute on function public.close_cash_session(numeric, text)        to authenticated;
grant execute on function public.get_public_menu(text)                    to anon, authenticated;

-- ─── 6. Storage: imágenes de productos (carpeta por tenant) ─────────────────────
do $$
begin
  if to_regclass('storage.buckets') is null then
    return; -- entorno sin Supabase Storage (p. ej. pruebas locales)
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  drop policy if exists product_images_admin_insert on storage.objects;
  drop policy if exists product_images_admin_update on storage.objects;
  drop policy if exists product_images_admin_delete on storage.objects;

  create policy product_images_admin_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'product-images'
                and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
                and (select private.has_role('admin')));
  create policy product_images_admin_update on storage.objects
    for update to authenticated
    using (bucket_id = 'product-images'
           and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
           and (select private.has_role('admin')));
  create policy product_images_admin_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'product-images'
           and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
           and (select private.has_role('admin')));
end $$;

-- =============================================================================
-- 15. IMPUESTOS, CORTESÍAS, DESCUENTOS Y ANULACIONES (también en migrations/004_taxes_discounts_voids.sql)
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

-- =============================================================================
-- 16. FACTURACIÓN ELECTRÓNICA (también en migrations/005_einvoicing.sql)
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

-- =============================================================================
-- 17. RESUMEN DEL NEGOCIO PARA ANÁLISIS (también en migrations/006_business_snapshot.sql)
-- =============================================================================

-- ─── KPIs de un rango (ventas cerradas en el rango) ─────────────────────────────
create or replace function private.snapshot_kpis(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with
  closed as (
    select o.* from public.orders o
     where o.tenant_id = p_tenant and o.status = 'paid'
       and o.closed_at >= p_from and o.closed_at < p_to
  ),
  items as (
    select i.* from public.order_items i
      join closed c on c.id = i.order_id
     where i.tenant_id = p_tenant and i.status <> 'cancelled'
  ),
  mov as (
    select m.* from public.inventory_movements m
     where m.tenant_id = p_tenant and m.created_at >= p_from and m.created_at < p_to
  ),
  item_cost as (
    select coalesce(-sum(m.quantity * m.unit_cost), 0) as v
      from public.inventory_movements m
      join items i on i.id = m.order_item_id
     where m.tenant_id = p_tenant and m.movement_type in ('sale', 'sale_reversal')
  )
  select jsonb_build_object(
    'revenue',          (select coalesce(sum(total), 0) from closed),
    'net_revenue',      (select coalesce(sum(total - tax_total), 0) from closed),
    'orders',           (select count(*) from closed),
    'avg_ticket',       (select coalesce(round(avg(total), 2), 0) from closed),
    'guests',           (select coalesce(sum(coalesce(guests, 1)), 0) from closed),
    'items_sold',       (select coalesce(sum(quantity), 0) from items where not comped),
    'tips',             (select coalesce(sum(p.tip), 0) from public.payments p
                          join closed c on c.id = p.order_id
                         where p.tenant_id = p_tenant and p.voided_at is null),
    'tax',              (select coalesce(sum(tax_total), 0) from closed),
    'discounts',        (select coalesce(sum(discount_total), 0) from closed),
    'comps',            (select coalesce(sum(gross_total), 0) from items where comped),
    'ingredient_cost',  (select round(v, 2) from item_cost),
    'waste_cost',       (select coalesce(round(-sum(quantity * unit_cost), 2), 0) from mov where movement_type = 'waste'),
    'shrinkage_cost',   (select coalesce(round(-sum(quantity * unit_cost), 2), 0) from mov
                          where movement_type = 'adjustment' and quantity < 0),
    'voided_payments',  (select count(*) from public.payments p
                          where p.tenant_id = p_tenant and p.voided_at >= p_from and p.voided_at < p_to),
    'cancelled_items',  (select count(*) from public.order_items i
                          where i.tenant_id = p_tenant and i.status = 'cancelled'
                            and i.cancelled_at >= p_from and i.cancelled_at < p_to),
    'cancelled_value',  (select coalesce(sum(i.quantity * (i.unit_price + i.modifiers_total)), 0)
                           from public.order_items i
                          where i.tenant_id = p_tenant and i.status = 'cancelled'
                            and i.cancelled_at >= p_from and i.cancelled_at < p_to)
  );
$$;

-- ─── Resumen completo ─────────────────────────────────────────────────────────
create or replace function public.get_business_snapshot(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tenant    uuid := private.current_tenant_id();
  v_tz        text;
  v_currency  text;
  v_warn      integer;
  v_late      integer;
  v_len       interval := p_to - p_from;
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_result    jsonb;
begin
  if not private.has_role('admin', 'ai_agent') then
    raise exception 'forbidden' using errcode = '42501';
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

revoke all on function private.snapshot_kpis(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function private.snapshot_kpis(uuid, timestamptz, timestamptz) to authenticated;
revoke execute on function public.get_business_snapshot(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_business_snapshot(timestamptz, timestamptz) to authenticated;

-- =============================================================================
-- 18. INFORMES DEL AGENTE ANALISTA Y COSTOS DE IA (también en migrations/007_ai_reports.sql)
-- =============================================================================

create table if not exists public.ai_reports (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  kind         text not null default 'business' check (kind in ('business')),
  period_from  timestamptz not null,
  period_to    timestamptz not null,
  range_key    text,
  status       text not null default 'completed' check (status in ('completed', 'failed')),
  model        text not null,
  facts_hash   text not null,
  facts        jsonb not null,
  content      jsonb,
  verification jsonb,
  error        text,
  input_tokens  integer,
  output_tokens integer,
  duration_ms   integer,
  cost_usd      numeric(12, 6),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
create index if not exists ai_reports_tenant_idx on public.ai_reports (tenant_id, created_at desc);
create index if not exists ai_reports_hash_idx on public.ai_reports (tenant_id, facts_hash) where status = 'completed';

drop trigger if exists ai_reports_00_set_tenant on public.ai_reports;
create trigger ai_reports_00_set_tenant before insert on public.ai_reports
  for each row execute function private.set_tenant_id();

alter table public.ai_reports enable row level security;
drop policy if exists ai_reports_admin_select on public.ai_reports;
create policy ai_reports_admin_select on public.ai_reports
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
drop policy if exists ai_reports_admin_insert on public.ai_reports;
create policy ai_reports_admin_insert on public.ai_reports
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
drop policy if exists ai_reports_admin_delete on public.ai_reports;
create policy ai_reports_admin_delete on public.ai_reports
  for delete to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
-- Sin UPDATE: un informe es un registro inmutable de lo que dijo el modelo.

-- ─── Registro de costos de IA: una fila por cada llamada a un modelo ─────────────
-- El costo se calcula en la app con la tabla de precios de lib/ai/pricing.ts
-- (USD por millón de tokens) y queda congelado en la fila: si los precios cambian,
-- el histórico conserva lo que realmente costó.
create table if not exists public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  feature            text not null check (feature in ('analyst_report', 'purchase_agent', 'analyst_chat')),
  model              text not null,
  status             text not null default 'ok' check (status in ('ok', 'error')),
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  reasoning_tokens   integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd           numeric(12, 6),
  duration_ms        integer,
  reference_id       uuid,
  error              text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (tenant_id, id)
);
create index if not exists ai_usage_tenant_idx on public.ai_usage (tenant_id, created_at desc);

drop trigger if exists ai_usage_00_set_tenant on public.ai_usage;
create trigger ai_usage_00_set_tenant before insert on public.ai_usage
  for each row execute function private.set_tenant_id();

alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_admin_select on public.ai_usage;
create policy ai_usage_admin_select on public.ai_usage
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'ai_agent')));
-- Sin UPDATE ni DELETE: es un registro contable.
