-- =============================================================================
-- 012 · Endurecimiento multi-tenant (resultado de la auditoría)
--
-- 1. El menú público (sin sesión) de un gastrobar suspendido deja de mostrarse.
-- 2. private.current_app_role() también exige que el gastrobar esté activo: un
--    usuario de un gastrobar suspendido no tiene ningún rol (defensa en
--    profundidad; current_tenant_id() ya lo bloqueaba).
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

create or replace function private.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role
    from public.profiles p
    join public.tenants t on t.id = p.tenant_id and t.status = 'active'
   where p.id = auth.uid() and p.is_active
$$;

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
  where t.slug = lower(p_slug) and t.public_menu_enabled and t.status = 'active'
$$;
