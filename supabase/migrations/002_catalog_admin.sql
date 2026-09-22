-- =============================================================================
-- 002 · Administración de catálogo
-- Guardado atómico de productos con su ficha técnica y de sub-recetas.
-- Ejecutar en el SQL Editor sobre una base que ya tenga schema.sql aplicado.
-- (schema.sql ya incluye estas funciones para instalaciones nuevas.)
-- =============================================================================

-- Crea o actualiza un producto y (si p_recipe no es null) reemplaza su receta.
-- p_recipe = [{ "ingredient_id": uuid } | { "sub_recipe_id": uuid }, "quantity": num ]
create or replace function public.save_product(
  p_id          uuid,
  p_category_id uuid,
  p_name        text,
  p_description text,
  p_price       numeric,
  p_is_active   boolean,
  p_track_stock boolean,
  p_sort_order  integer,
  p_recipe      jsonb default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id   uuid;
  v_line jsonb;
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.products (category_id, name, description, price, is_active, track_stock, sort_order)
    values (p_category_id, trim(p_name), nullif(trim(p_description), ''), p_price,
            coalesce(p_is_active, true), coalesce(p_track_stock, true), coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.products
       set category_id = p_category_id,
           name        = trim(p_name),
           description = nullif(trim(p_description), ''),
           price       = p_price,
           is_active   = coalesce(p_is_active, is_active),
           track_stock = coalesce(p_track_stock, track_stock),
           sort_order  = coalesce(p_sort_order, sort_order)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
  end if;

  if p_recipe is not null then
    delete from public.recipes where product_id = v_id;
    for v_line in select value from jsonb_array_elements(p_recipe) loop
      insert into public.recipes (product_id, ingredient_id, sub_recipe_id, quantity)
      values (v_id,
              (v_line ->> 'ingredient_id')::uuid,
              (v_line ->> 'sub_recipe_id')::uuid,
              (v_line ->> 'quantity')::numeric);
    end loop;
  end if;

  return v_id;
end $$;

-- Crea o actualiza una sub-receta y reemplaza sus insumos.
-- p_lines = [{ "ingredient_id": uuid, "quantity": num }]
create or replace function public.save_sub_recipe(
  p_id             uuid,
  p_name           text,
  p_yield_quantity numeric,
  p_yield_unit     public.measure_unit,
  p_notes          text,
  p_lines          jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id   uuid;
  v_line jsonb;
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.sub_recipes (name, yield_quantity, yield_unit, notes)
    values (trim(p_name), p_yield_quantity, p_yield_unit, nullif(trim(p_notes), ''))
    returning id into v_id;
  else
    update public.sub_recipes
       set name = trim(p_name), yield_quantity = p_yield_quantity,
           yield_unit = p_yield_unit, notes = nullif(trim(p_notes), '')
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'sub_recipe_not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.sub_recipe_ingredients where sub_recipe_id = v_id;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into public.sub_recipe_ingredients (sub_recipe_id, ingredient_id, quantity)
    values (v_id, (v_line ->> 'ingredient_id')::uuid, (v_line ->> 'quantity')::numeric);
  end loop;

  return v_id;
end $$;

revoke execute on function public.save_product(uuid, uuid, text, text, numeric, boolean, boolean, integer, jsonb) from public, anon;
revoke execute on function public.save_sub_recipe(uuid, text, numeric, public.measure_unit, text, jsonb) from public, anon;
grant execute on function public.save_product(uuid, uuid, text, text, numeric, boolean, boolean, integer, jsonb) to authenticated;
grant execute on function public.save_sub_recipe(uuid, text, numeric, public.measure_unit, text, jsonb) to authenticated;
