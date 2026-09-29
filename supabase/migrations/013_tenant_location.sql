-- =============================================================================
-- 013 · Ubicación del gastrobar: ciudad y departamento
--
-- Salen en los recibos y en la consola de plataforma, y los necesitará la
-- facturación electrónica (la DIAN exige el municipio del emisor).
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

alter table public.tenants add column if not exists city text;
alter table public.tenants add column if not exists department text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_city_len') then
    alter table public.tenants add constraint tenants_city_len check (city is null or char_length(city) between 2 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_department_len') then
    alter table public.tenants add constraint tenants_department_len check (department is null or char_length(department) between 2 and 60);
  end if;
end $$;
