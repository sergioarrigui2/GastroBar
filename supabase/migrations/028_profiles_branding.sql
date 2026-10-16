-- ════════════════════════════════════════════════════════════════════════════════
-- 028 · Datos del usuario y logo del negocio
--
-- · Cada persona puede actualizar su nombre, teléfono y foto (update_my_profile). Su rol,
--   permisos y estado siguen siendo sólo del administrador: esa función NO los toca.
-- · El administrador edita los mismos datos de cualquiera de su equipo (ya tenía permiso de
--   actualizar perfiles) y el logo del negocio.
-- · Las fotos del equipo van al bucket «avatars» (carpeta del negocio / carpeta de la persona);
--   el logo, a la carpeta «branding» del bucket de imágenes que ya existe.
-- · Cambiar el nombre de una persona queda en la auditoría: cambiarse el nombre para confundir
--   un registro no pasaría desapercibido.
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.tenants  add column if not exists logo_url text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_valid') then
    alter table public.profiles add constraint profiles_phone_valid check (phone is null or phone ~ '^[0-9+() -]{6,30}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_url_len') then
    alter table public.profiles add constraint profiles_avatar_url_len check (avatar_url is null or char_length(avatar_url) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_logo_url_len') then
    alter table public.tenants add constraint tenants_logo_url_len check (logo_url is null or char_length(logo_url) <= 500);
  end if;
end $$;

-- Mis datos: sólo nombre, teléfono y foto, y sólo los míos.
create or replace function public.update_my_profile(
  p_full_name    text    default null,
  p_phone        text    default null,
  p_avatar_url   text    default null,
  p_clear_phone  boolean default false,
  p_clear_avatar boolean default false)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := private.current_tenant_id();
  v_name   text := nullif(trim(p_full_name), '');
  v_phone  text := nullif(trim(p_phone), '');
  v_row    public.profiles;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_full_name is not null and (v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120) then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  -- La foto debe estar en MI carpeta del almacenamiento: no se puede apuntar a una dirección cualquiera.
  if p_avatar_url is not null
     and position('/storage/v1/object/public/avatars/' || v_tenant::text || '/' || v_uid::text || '/' in p_avatar_url) = 0 then
    raise exception 'invalid_avatar' using errcode = '22023';
  end if;
  update public.profiles p
     set full_name  = coalesce(v_name, p.full_name),
         phone      = case when p_clear_phone then null when p_phone is not null then v_phone else p.phone end,
         avatar_url = case when p_clear_avatar then null when p_avatar_url is not null then p_avatar_url else p.avatar_url end
   where p.id = v_uid
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.update_my_profile(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.update_my_profile(text, text, text, boolean, boolean) to authenticated;

-- Auditoría: el cambio de nombre de una persona.
create or replace function private.audit_profile_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.full_name is distinct from old.full_name then
    perform private.audit_write(new.tenant_id, 'staff.renamed', 'personal', 'important', 'profile', new.id,
      jsonb_build_object('from', old.full_name, 'to', new.full_name, 'role', new.role));
  end if;
  return new;
end $$;
drop trigger if exists profiles_91_audit_identity on public.profiles;
create trigger profiles_91_audit_identity after update of full_name on public.profiles
  for each row execute function private.audit_profile_identity();

-- Fotos del equipo: carpeta del negocio / carpeta de la persona. Cada quien sube la suya; el administrador, la de cualquiera.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return; -- entorno sin Supabase Storage (p. ej. pruebas locales)
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  drop policy if exists avatars_insert on storage.objects;
  drop policy if exists avatars_update on storage.objects;
  drop policy if exists avatars_delete on storage.objects;
  create policy avatars_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars'
                and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
                and ((storage.foldername(name))[2] = (select auth.uid())::text or (select private.has_role('admin'))));
  create policy avatars_update on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars'
           and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
           and ((storage.foldername(name))[2] = (select auth.uid())::text or (select private.has_role('admin'))));
  create policy avatars_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars'
           and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
           and ((storage.foldername(name))[2] = (select auth.uid())::text or (select private.has_role('admin'))));
end $$;

-- El menú público muestra el logo del negocio.
create or replace function public.get_public_menu(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'slug', t.slug, 'currency', t.currency, 'locale', t.locale,
                                 'address', t.address, 'phone', t.phone, 'logo_url', t.logo_url),
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
  where t.slug = lower(p_slug) and t.public_menu_enabled and t.status = 'active'
$$;
