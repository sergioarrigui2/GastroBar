-- ════════════════════════════════════════════════════════════════════════════════
-- 019 · Impresión automática en térmicas (ESC/POS)
--
-- · print_stations: PC del local con el programa "GastroBar Print". Se vincula con
--   un código temporal; queda con un token propio (en la base sólo su SHA-256).
-- · printers: impresoras de esa estación (USB/compartida en Windows o red IP:9100).
-- · print_settings: qué documento va a qué impresora, excepciones por categoría y
--   formato. Una fila por gastrobar.
-- · print_jobs: cola. La app encola tiquetes ya armados (payload); el programa los
--   toma con print_agent_pull y reporta con print_agent_report.
-- El programa no es un usuario: habla con funciones security definer que validan
-- su token. No ve nada más que sus trabajos.
-- ════════════════════════════════════════════════════════════════════════════════

create table if not exists public.print_stations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 60),
  token_hash         text unique,
  pairing_code_hash  text,
  pairing_expires_at timestamptz,
  paired_at          timestamptz,
  last_seen_at       timestamptz,
  agent_version      text,
  discovered         jsonb not null default '[]'::jsonb,   -- impresoras que ve el PC
  revoked_at         timestamptz,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (tenant_id, id)
);
create index if not exists print_stations_tenant_idx on public.print_stations (tenant_id);
create index if not exists print_stations_pairing_idx on public.print_stations (pairing_code_hash) where pairing_code_hash is not null;

create table if not exists public.printers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  station_id     uuid not null,
  name           text not null check (char_length(name) between 1 and 40),
  connection     text not null check (connection in ('windows', 'network')),
  target         text not null check (char_length(target) between 1 and 200),  -- nombre en Windows o IP[:puerto]
  paper_width    integer not null default 80 check (paper_width in (58, 80)),
  profile        text not null default 'generic',
  codepage       text not null default 'cp850' check (codepage in ('cp850', 'cp1252', 'ascii')),
  mode           text not null default 'escpos' check (mode in ('escpos', 'text')),
  cut            boolean not null default true,
  is_active      boolean not null default true,
  status         text not null default 'unknown' check (status in ('unknown', 'ok', 'error')),
  status_message text,
  status_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  foreign key (tenant_id, station_id) references public.print_stations (tenant_id, id) on delete cascade
);

create table if not exists public.print_settings (
  tenant_id          uuid primary key references public.tenants (id) on delete cascade,
  routes             jsonb not null default '{}'::jsonb,   -- documento → printer_id (null = no imprimir)
  category_overrides jsonb not null default '{}'::jsonb,   -- category_id → printer_id | 'none'
  options            jsonb not null default '{}'::jsonb,   -- copias, letra grande, precios, cajón…
  updated_at         timestamptz not null default now()
);

create table if not exists public.print_jobs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  printer_id  uuid not null,
  document    text not null check (document in ('kitchen_order', 'bar_order', 'prebill', 'receipt', 'cash_report', 'test')),
  ref_id      uuid,
  title       text not null check (char_length(title) between 1 and 120),
  payload     jsonb not null,
  copies      integer not null default 1 check (copies between 1 and 5),
  open_drawer boolean not null default false,
  status      text not null default 'pending' check (status in ('pending', 'printing', 'printed', 'failed')),
  attempts    integer not null default 0,
  error       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  printed_at  timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, printer_id) references public.printers (tenant_id, id) on delete cascade
);
create index if not exists print_jobs_queue_idx on public.print_jobs (printer_id, status, created_at);
create index if not exists print_jobs_tenant_idx on public.print_jobs (tenant_id, created_at desc);

drop trigger if exists print_stations_00_set_tenant on public.print_stations;
create trigger print_stations_00_set_tenant before insert on public.print_stations
  for each row execute function private.set_tenant_id();
drop trigger if exists printers_00_set_tenant on public.printers;
create trigger printers_00_set_tenant before insert on public.printers
  for each row execute function private.set_tenant_id();
drop trigger if exists print_settings_00_set_tenant on public.print_settings;
create trigger print_settings_00_set_tenant before insert on public.print_settings
  for each row execute function private.set_tenant_id();
drop trigger if exists print_jobs_00_set_tenant on public.print_jobs;
create trigger print_jobs_00_set_tenant before insert on public.print_jobs
  for each row execute function private.set_tenant_id();

alter table public.print_stations enable row level security;
alter table public.printers       enable row level security;
alter table public.print_settings enable row level security;
alter table public.print_jobs     enable row level security;

-- Estaciones: sólo el admin (contienen hashes de token y códigos de vinculación).
drop policy if exists print_stations_admin on public.print_stations;
create policy print_stations_admin on public.print_stations
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- Impresoras y ajustes: todo el equipo los lee (para saber a dónde mandar); el admin los cambia.
drop policy if exists printers_select on public.printers;
create policy printers_select on public.printers
  for select to authenticated using (tenant_id = (select private.current_tenant_id()));
drop policy if exists printers_admin on public.printers;
create policy printers_admin on public.printers
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

drop policy if exists print_settings_select on public.print_settings;
create policy print_settings_select on public.print_settings
  for select to authenticated using (tenant_id = (select private.current_tenant_id()));
drop policy if exists print_settings_admin on public.print_settings;
create policy print_settings_admin on public.print_settings
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

-- Cola: cualquiera del equipo encola; admin y caja la ven y reimprimen.
drop policy if exists print_jobs_insert on public.print_jobs;
create policy print_jobs_insert on public.print_jobs
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and (select private.has_role('admin', 'cashier', 'waiter', 'kitchen', 'bar', 'ai_agent')));
drop policy if exists print_jobs_select on public.print_jobs;
create policy print_jobs_select on public.print_jobs
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'cashier')));
drop policy if exists print_jobs_update on public.print_jobs;
create policy print_jobs_update on public.print_jobs
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin', 'cashier')))
  with check (tenant_id = (select private.current_tenant_id()));

-- ─── Funciones del programa de impresión (rol anon + token de estación) ─────────

create or replace function private.print_token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- Estación vigente (no revocada, gastrobar activo) para un token.
create or replace function private.print_station_for(p_token text)
returns public.print_stations language plpgsql stable security definer set search_path = '' as $$
declare
  v_station public.print_stations;
begin
  select s.* into v_station
    from public.print_stations s
    join public.tenants t on t.id = s.tenant_id and t.status = 'active'
   where s.token_hash = private.print_token_hash(p_token) and s.revoked_at is null;
  if not found then
    raise exception 'invalid_print_token' using errcode = '42501';
  end if;
  return v_station;
end $$;

-- Vincula el programa con el código que muestra el admin. Devuelve el token una sola vez.
create or replace function public.print_agent_pair(p_code text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_station public.print_stations;
  v_token   text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_tenant  text;
begin
  select * into v_station from public.print_stations
   where pairing_code_hash = private.print_token_hash(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')))
     and pairing_expires_at > now() and revoked_at is null
     for update;
  if not found then
    raise exception 'invalid_pairing_code' using errcode = '42501';
  end if;
  update public.print_stations
     set token_hash = private.print_token_hash(v_token), pairing_code_hash = null, pairing_expires_at = null,
         paired_at = now(), last_seen_at = now(),
         name = coalesce(nullif(left(trim(p_name), 60), ''), name)
   where id = v_station.id;
  select name into v_tenant from public.tenants where id = v_station.tenant_id;
  return jsonb_build_object('station_id', v_station.id, 'token', v_token, 'tenant', v_tenant);
end $$;

-- Latido: el programa informa lo que ve y recibe la configuración de sus impresoras.
create or replace function public.print_agent_heartbeat(p_token text, p_version text default null, p_discovered jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_station public.print_stations := private.print_station_for(p_token);
begin
  update public.print_stations
     set last_seen_at = now(), agent_version = left(p_version, 40),
         discovered = case when jsonb_typeof(p_discovered) = 'array' then p_discovered else discovered end
   where id = v_station.id;
  return jsonb_build_object(
    'station', jsonb_build_object('id', v_station.id, 'name', v_station.name),
    'tenant', (select name from public.tenants where id = v_station.tenant_id),
    'printers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'connection', p.connection, 'target', p.target,
                                          'paper_width', p.paper_width, 'profile', p.profile, 'codepage', p.codepage,
                                          'mode', p.mode, 'cut', p.cut) order by p.name)
        from public.printers p
       where p.station_id = v_station.id and p.tenant_id = v_station.tenant_id and p.is_active), '[]'::jsonb));
end $$;

-- Toma trabajos pendientes de SUS impresoras (y los "printing" abandonados hace > 2 min).
create or replace function public.print_agent_pull(p_token text, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_station public.print_stations := private.print_station_for(p_token);
  v_jobs    jsonb;
begin
  with picked as (
    select j.id from public.print_jobs j
      join public.printers p on p.id = j.printer_id and p.station_id = v_station.id and p.is_active
     where j.tenant_id = v_station.tenant_id
       and (j.status = 'pending' or (j.status = 'printing' and j.claimed_at < now() - interval '2 minutes'))
     order by j.created_at
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
       for update of j skip locked
  ), claimed as (
    update public.print_jobs j
       set status = 'printing', claimed_at = now(), attempts = j.attempts + 1
      from picked where j.id = picked.id
    returning j.id, j.printer_id, j.document, j.title, j.payload, j.copies, j.open_drawer, j.attempts, j.created_at
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.created_at), '[]'::jsonb) into v_jobs from claimed;
  update public.print_stations set last_seen_at = now() where id = v_station.id;
  return v_jobs;
end $$;

-- Resultado de un trabajo: impreso, o error (se reintenta hasta 5 veces).
create or replace function public.print_agent_report(p_token text, p_job_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_station public.print_stations := private.print_station_for(p_token);
  v_job     public.print_jobs;
begin
  select j.* into v_job from public.print_jobs j
    join public.printers p on p.id = j.printer_id and p.station_id = v_station.id
   where j.id = p_job_id and j.tenant_id = v_station.tenant_id
     for update of j;
  if not found then
    raise exception 'print_job_not_found' using errcode = 'P0002';
  end if;
  update public.print_jobs
     set status = case when p_ok then 'printed' when v_job.attempts >= 5 then 'failed' else 'pending' end,
         printed_at = case when p_ok then now() end,
         error = case when p_ok then null else left(p_error, 500) end
   where id = v_job.id;
  update public.printers
     set status = case when p_ok then 'ok' else 'error' end,
         status_message = case when p_ok then null else left(p_error, 300) end,
         status_at = now()
   where id = v_job.printer_id;
end $$;

revoke all on function private.print_token_hash(text) from public, anon, authenticated;
revoke all on function private.print_station_for(text) from public, anon, authenticated;
revoke execute on function public.print_agent_pair(text, text) from public;
revoke execute on function public.print_agent_heartbeat(text, text, jsonb) from public;
revoke execute on function public.print_agent_pull(text, integer) from public;
revoke execute on function public.print_agent_report(text, uuid, boolean, text) from public;
grant execute on function public.print_agent_pair(text, text) to anon, authenticated;
grant execute on function public.print_agent_heartbeat(text, text, jsonb) to anon, authenticated;
grant execute on function public.print_agent_pull(text, integer) to anon, authenticated;
grant execute on function public.print_agent_report(text, uuid, boolean, text) to anon, authenticated;
