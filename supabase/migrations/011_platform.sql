-- =============================================================================
-- 011 · Consola de plataforma: superusuarios, clientes activos/suspendidos,
--       agentes contratados por cliente y registro cerrado
--
-- - platform_admins: quién administra la plataforma (tú). No es un rol dentro de
--   un gastrobar; se consulta desde el servidor y opera con el rol de servicio.
-- - tenants.status: un gastrobar suspendido no puede leer ni escribir nada
--   (private.current_tenant_id() devuelve null), sin borrar sus datos.
-- - tenant_agents: qué agentes tiene contratados cada gastrobar. Sin fila = activo
--   (compatibilidad con los gastrobares que ya existen).
-- - create_tenant deja de estar disponible para usuarios: los gastrobares nuevos
--   los crea el superusuario desde /platform.
--
-- Registrar tu usuario como superusuario (cambia el correo):
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'tu@correo.com'
--   on conflict do nothing;
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- ─── Superusuarios ─────────────────────────────────────────────────────────────
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists platform_admins_self on public.platform_admins;
create policy platform_admins_self on public.platform_admins
  for select to authenticated using (user_id = (select auth.uid()));
-- Sin escrituras para usuarios: se registran desde el SQL Editor.

-- ─── Estado del cliente ────────────────────────────────────────────────────────
alter table public.tenants add column if not exists status text not null default 'active';
alter table public.tenants add column if not exists status_reason text;
alter table public.tenants add column if not exists platform_notes text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_status_check') then
    alter table public.tenants add constraint tenants_status_check check (status in ('active', 'suspended'));
  end if;
end $$;

-- Un gastrobar suspendido deja de existir para sus usuarios (todas las políticas
-- RLS dependen de esta función).
create or replace function private.current_tenant_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.tenant_id
    from public.profiles p
    join public.tenants t on t.id = p.tenant_id and t.status = 'active'
   where p.id = auth.uid() and p.is_active
$$;

-- Cada usuario siempre puede leer su propio perfil (para mostrarle "cuenta suspendida").
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));

-- ─── Agentes contratados ───────────────────────────────────────────────────────
create table if not exists public.tenant_agents (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  agent       text not null check (agent in ('vigia', 'ingeniero', 'analista', 'comprador', 'mensajero')),
  enabled     boolean not null default true,
  trial_until timestamptz,                 -- prueba gratis: activo hasta esta fecha
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, agent)
);
alter table public.tenant_agents enable row level security;
drop policy if exists tenant_agents_members on public.tenant_agents;
create policy tenant_agents_members on public.tenant_agents
  for select to authenticated using (tenant_id = (select private.current_tenant_id()));
-- Sin escrituras para usuarios: sólo la consola de plataforma (rol de servicio).

-- ─── Registro cerrado ──────────────────────────────────────────────────────────
revoke execute on function public.create_tenant(text, text, text) from authenticated;

-- ─── Los costos de IA son internos de la plataforma ─────────────────────────────
-- El gastrobar ya no puede leer ai_usage (tokens, modelos, dólares). Puede seguir
-- registrando consumo (lo hace el servidor al llamar al modelo); el control de
-- cupo lo lee el servidor con el rol de servicio.
drop policy if exists ai_usage_admin_select on public.ai_usage;
