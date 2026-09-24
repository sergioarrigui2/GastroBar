-- =============================================================================
-- 008 · Planes de IA por gastrobar (paquetes vendibles)
--
-- El catálogo de planes (Prueba, Básico, Pro, Premium) está en lib/ai/plans.ts.
-- Aquí se guarda el plan de cada gastrobar y ajustes puntuales opcionales.
-- Sólo el dueño de la plataforma lo modifica (SQL Editor o service role): no hay
-- políticas de escritura para usuarios, así un administrador no puede subirse el cupo.
-- Sin fila = plan por defecto (DEFAULT_AI_PLAN, "prueba" si no se define).
--
-- Asignar un plan:
--   insert into public.tenant_ai_plans (tenant_id, plan)
--   values ((select id from public.tenants where slug = 'mi-gastrobar'), 'pro')
--   on conflict (tenant_id) do update set plan = excluded.plan, updated_at = now();
--
-- Plan a la medida (p. ej. 15 informes y USD 2 al mes):
--   update public.tenant_ai_plans set reports_per_month = 15, monthly_budget_usd = 2
--    where tenant_id = (select id from public.tenants where slug = 'mi-gastrobar');
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

create table if not exists public.tenant_ai_plans (
  tenant_id          uuid primary key references public.tenants (id) on delete cascade,
  plan               text not null default 'prueba' check (plan in ('sin_ia', 'prueba', 'basico', 'pro', 'premium')),
  reports_per_month  integer check (reports_per_month is null or reports_per_month >= 0),
  monthly_budget_usd numeric(10, 2) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  model_tier         text check (model_tier is null or model_tier in ('economy', 'balanced', 'premium')),
  notes              text,
  updated_at         timestamptz not null default now()
);

alter table public.tenant_ai_plans enable row level security;
drop policy if exists tenant_ai_plans_admin_select on public.tenant_ai_plans;
create policy tenant_ai_plans_admin_select on public.tenant_ai_plans
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'ai_agent')));
