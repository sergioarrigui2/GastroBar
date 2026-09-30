-- ════════════════════════════════════════════════════════════════════════════════
-- 021 · Conecta tu asistente de IA (Claude, ChatGPT…) por MCP + OAuth 2.1
--
-- El dueño agrega GastroBar como conector en su asistente; el asistente lo manda
-- al login de GastroBar, el administrador acepta los permisos y el asistente
-- recibe un token LIMITADO a ese gastrobar (actúa como un usuario ai_agent propio
-- de la conexión, sólo lectura). Todo se valida en el servidor con el rol de
-- servicio: estas tablas no se leen con la sesión, salvo lo que el admin necesita
-- ver (sus conexiones y su historial).
-- ════════════════════════════════════════════════════════════════════════════════

-- Clientes OAuth registrados dinámicamente (RFC 7591): Claude, ChatGPT, etc. Globales.
create table if not exists public.oauth_clients (
  client_id          text primary key,
  client_secret_hash text,
  client_name        text not null default 'Asistente de IA' check (char_length(client_name) between 1 and 120),
  redirect_uris      text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at         timestamptz not null default now()
);

-- Códigos de autorización: un solo uso, 5 minutos, amarrados a PKCE.
create table if not exists public.oauth_codes (
  code_hash      text primary key,
  client_id      text not null references public.oauth_clients (client_id) on delete cascade,
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  granted_by     uuid not null,
  redirect_uri   text not null,
  code_challenge text not null,
  scopes         text[] not null,
  resource       text,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists oauth_codes_tenant_idx on public.oauth_codes (tenant_id);

-- Conexión = un asistente autorizado en un gastrobar, con su propio usuario ai_agent.
create table if not exists public.ai_connections (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  client_id        text,
  client_name      text not null,
  agent_profile_id uuid not null,
  granted_by       uuid,
  scopes           text[] not null,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, agent_profile_id) references public.profiles (tenant_id, id) on delete cascade
);
create index if not exists ai_connections_tenant_idx on public.ai_connections (tenant_id, created_at desc);

-- Tokens opacos (sólo su SHA-256): acceso 1 h, renovación 30 días con rotación.
create table if not exists public.ai_connection_tokens (
  token_hash    text primary key,
  connection_id uuid not null references public.ai_connections (id) on delete cascade,
  kind          text not null check (kind in ('access', 'refresh')),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists ai_connection_tokens_conn_idx on public.ai_connection_tokens (connection_id);

-- Historial de consultas del asistente (qué herramienta, cuándo, si funcionó).
create table if not exists public.ai_connection_calls (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  tool          text not null,
  ok            boolean not null,
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.ai_connections (tenant_id, id) on delete cascade
);
create index if not exists ai_connection_calls_idx on public.ai_connection_calls (connection_id, created_at desc);

alter table public.oauth_clients        enable row level security;
alter table public.oauth_codes          enable row level security;
alter table public.ai_connections       enable row level security;
alter table public.ai_connection_tokens enable row level security;
alter table public.ai_connection_calls  enable row level security;
revoke all on public.oauth_clients, public.oauth_codes, public.ai_connection_tokens from anon, authenticated;

-- El admin ve sus conexiones y su historial; no crea ni edita tokens (eso es del servidor).
drop policy if exists ai_connections_admin_select on public.ai_connections;
create policy ai_connections_admin_select on public.ai_connections
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
drop policy if exists ai_connection_calls_admin_select on public.ai_connection_calls;
create policy ai_connection_calls_admin_select on public.ai_connection_calls
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));
