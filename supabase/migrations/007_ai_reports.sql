-- =============================================================================
-- 007 · Informes del Agente Analista y registro de costos de IA
--
-- Cada informe guarda los hechos exactos que se le dieron al modelo (facts), su
-- huella (facts_hash) para no volver a pagar por el mismo análisis, la respuesta
-- estructurada del modelo y el consumo de tokens. Sólo el administrador del
-- gastrobar los ve y los genera.
-- Idempotente: se puede ejecutar varias veces.
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
