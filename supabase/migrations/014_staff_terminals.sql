-- ════════════════════════════════════════════════════════════════════════════════
-- 014 · Rotación de personal: terminales compartidas y acceso con PIN
--
-- · terminal_devices: tablets autorizadas por un admin. El dispositivo guarda un
--   token aleatorio en una cookie httpOnly; aquí sólo vive su SHA-256.
-- · staff_pins: hash (scrypt) del PIN de cada empleado + bloqueo por intentos.
--   RLS activado SIN políticas: nadie la lee con su sesión, ni siquiera el admin;
--   sólo el servidor (service role) valida PINs.
-- · profiles.pin_only: empleado sin correo propio (entra sólo con PIN en una
--   terminal autorizada).
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists pin_only boolean not null default false;

create table if not exists public.terminal_devices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  token_hash   text not null unique,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  unique (tenant_id, id)
);
create index if not exists terminal_devices_tenant_idx on public.terminal_devices (tenant_id, created_at desc);

drop trigger if exists terminal_devices_00_set_tenant on public.terminal_devices;
create trigger terminal_devices_00_set_tenant before insert on public.terminal_devices
  for each row execute function private.set_tenant_id();

alter table public.terminal_devices enable row level security;
drop policy if exists terminal_devices_admin on public.terminal_devices;
create policy terminal_devices_admin on public.terminal_devices
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')))
  with check (tenant_id = (select private.current_tenant_id()) and (select private.has_role('admin')));

create table if not exists public.staff_pins (
  profile_id      uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  pin_hash        text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  updated_at      timestamptz not null default now(),
  foreign key (tenant_id, profile_id) references public.profiles (tenant_id, id) on delete cascade
);
create index if not exists staff_pins_tenant_idx on public.staff_pins (tenant_id);

alter table public.staff_pins enable row level security;
-- Sin políticas a propósito: sólo el service role (que ignora RLS) la toca.
revoke all on public.staff_pins from anon, authenticated;
