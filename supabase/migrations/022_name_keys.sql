-- ════════════════════════════════════════════════════════════════════════════════
-- 022 · Nombres sin duplicados por tildes, mayúsculas o espacios
--
-- Hasta ahora sólo se impedía repetir un nombre idéntico letra por letra, así que
-- «Azúcar», «AZUCAR» y «azucar » podían convivir como tres insumos distintos.
-- private.name_key() reduce un nombre a su forma comparable (sin tildes, sin
-- mayúsculas, sin espacios ni signos; se conserva «/» para que «1/2» no sea «12»)
-- y un índice único por gastrobar lo exige en productos, insumos, categorías,
-- proveedores y preparaciones. El mensaje de error lo traduce lib/errors.ts.
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function private.name_key(value text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select regexp_replace(
    lower(translate(value,
      'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñÇç',
      'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuunCc')),
    '[^a-z0-9/]+', '', 'g')
$$;
revoke all on function private.name_key(text) from public, anon;
grant execute on function private.name_key(text) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function private.name_key(text) to service_role;
  end if;
end $$;

create unique index if not exists products_name_key_uidx    on public.products    (tenant_id, private.name_key(name));
create unique index if not exists ingredients_name_key_uidx on public.ingredients (tenant_id, private.name_key(name));
create unique index if not exists categories_name_key_uidx  on public.categories  (tenant_id, private.name_key(name));
create unique index if not exists suppliers_name_key_uidx   on public.suppliers   (tenant_id, private.name_key(name));
create unique index if not exists sub_recipes_name_key_uidx on public.sub_recipes (tenant_id, private.name_key(name));
