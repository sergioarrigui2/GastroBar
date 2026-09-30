-- ════════════════════════════════════════════════════════════════════════════════
-- 015 · Cambiar la unidad de un insumo con conversión
--
-- p_factor = cuántas unidades VIEJAS trae 1 unidad NUEVA (1 botella = 750 ml → 750).
-- En una sola transacción convierte todo lo expresado en la unidad del insumo:
-- stock, mínimo, empaque, costo (inverso), recetas, sub-recetas y el historial de
-- movimientos, para que nada quede leyéndose en la unidad equivocada.
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.change_ingredient_unit(
  p_ingredient_id uuid,
  p_unit          public.measure_unit,
  p_factor        numeric)
returns public.ingredients language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_ing    public.ingredients;
begin
  if v_tenant is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_factor is null or p_factor <= 0 or p_factor > 1000000 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  select * into v_ing from public.ingredients
   where id = p_ingredient_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  if v_ing.unit = p_unit then
    return v_ing;
  end if;

  -- Cantidades de receta: nunca por debajo del mínimo representable (0,001).
  update public.recipes
     set quantity = greatest(round(quantity / p_factor, 3), 0.001)
   where tenant_id = v_tenant and ingredient_id = p_ingredient_id;
  update public.sub_recipe_ingredients
     set quantity = greatest(round(quantity / p_factor, 3), 0.001)
   where tenant_id = v_tenant and ingredient_id = p_ingredient_id;
  update public.inventory_movements
     set quantity  = round(quantity / p_factor, 3),
         unit_cost = round(unit_cost * p_factor, 4)
   where tenant_id = v_tenant and ingredient_id = p_ingredient_id;

  update public.ingredients
     set unit           = p_unit,
         stock_quantity = round(stock_quantity / p_factor, 3),
         min_stock      = round(min_stock / p_factor, 3),
         cost_per_unit  = round(cost_per_unit * p_factor, 4),
         pack_size      = case when pack_size is null then null
                               else nullif(round(pack_size / p_factor, 3), 0) end,
         updated_at     = now()
   where id = p_ingredient_id and tenant_id = v_tenant
  returning * into v_ing;

  return v_ing;
end $$;

revoke execute on function public.change_ingredient_unit(uuid, public.measure_unit, numeric) from public, anon;
grant execute on function public.change_ingredient_unit(uuid, public.measure_unit, numeric) to authenticated;
