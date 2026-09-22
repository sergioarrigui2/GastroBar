-- =============================================================================
-- Datos demo para un gastrobar existente.
-- 1) Crea tu cuenta en /onboarding (p. ej. identificador "mi-gastrobar").
-- 2) Cambia el slug de abajo y ejecuta este script en el SQL Editor.
-- Es idempotente a nivel de nombres: si ya existen zonas/insumos con el mismo
-- nombre, el script falla por unique constraint en lugar de duplicar.
-- =============================================================================
do $$
declare
  v_slug   text := 'el-punto';   -- <== cambia aquí
  t        uuid;
  z_terraza uuid; z_salon uuid; z_barra uuid;
  c_cocteles uuid; c_cervezas uuid; c_sin_alcohol uuid; c_entradas uuid; c_fuertes uuid; c_postres uuid;
  i_ron uuid; i_tequila uuid; i_gin uuid; i_vodka uuid; i_triple uuid; i_tonica uuid; i_limon uuid;
  i_hierbabuena uuid; i_azucar uuid; i_soda uuid; i_cerveza uuid; i_artesanal uuid; i_carne uuid;
  i_pan uuid; i_queso uuid; i_papa uuid; i_aceite uuid; i_nachos uuid; i_frijol uuid; i_pollo uuid;
  i_crema uuid; i_chocolate uuid; i_lulo uuid; i_hielo uuid;
  sr_jarabe uuid; sr_sour uuid;
  p uuid;
begin
  select id into t from public.tenants where slug = v_slug;

  -- Si el slug no coincide pero hay un único gastrobar, se usa ese.
  if t is null and (select count(*) from public.tenants) = 1 then
    select id, slug into t, v_slug from public.tenants;
    raise notice 'Slug no encontrado; usando el único gastrobar existente: %', v_slug;
  end if;

  if t is null then
    raise exception 'No existe el gastrobar con slug "%". Disponibles: %', v_slug,
      coalesce((select string_agg(slug, ', ' order by created_at) from public.tenants),
               'ninguno (crea tu cuenta primero en /onboarding)');
  end if;

  if exists (select 1 from public.zones where tenant_id = t) then
    raise exception 'El gastrobar "%" ya tiene datos (zonas). El seed sólo se aplica a gastrobares vacíos.', v_slug;
  end if;

  update public.tenants set currency = 'COP', locale = 'es-CO', timezone = 'America/Bogota' where id = t;

  -- Zonas y mesas -----------------------------------------------------------------
  insert into public.zones (tenant_id, name, sort_order) values (t, 'Terraza', 1) returning id into z_terraza;
  insert into public.zones (tenant_id, name, sort_order) values (t, 'Salón', 2) returning id into z_salon;
  insert into public.zones (tenant_id, name, sort_order) values (t, 'Barra', 3) returning id into z_barra;

  insert into public.tables (tenant_id, zone_id, label, seats, sort_order)
  select t, z_terraza, 'T' || g, case when g % 3 = 0 then 6 else 4 end, g from generate_series(1, 6) g;
  insert into public.tables (tenant_id, zone_id, label, seats, sort_order)
  select t, z_salon, 'S' || g, case when g <= 2 then 2 else 4 end, g from generate_series(1, 8) g;
  insert into public.tables (tenant_id, zone_id, label, seats, sort_order)
  select t, z_barra, 'B' || g, 2, g from generate_series(1, 4) g;

  -- Categorías (enrutamiento a estación) -------------------------------------------------
  insert into public.categories (tenant_id, name, station, sort_order) values (t, 'Cócteles', 'bar', 1) returning id into c_cocteles;
  insert into public.categories (tenant_id, name, station, sort_order) values (t, 'Cervezas', 'bar', 2) returning id into c_cervezas;
  insert into public.categories (tenant_id, name, station, sort_order) values (t, 'Sin alcohol', 'bar', 3) returning id into c_sin_alcohol;
  insert into public.categories (tenant_id, name, station, sort_order) values (t, 'Entradas', 'kitchen', 4) returning id into c_entradas;
  insert into public.categories (tenant_id, name, station, sort_order) values (t, 'Fuertes', 'kitchen', 5) returning id into c_fuertes;
  insert into public.categories (tenant_id, name, station, sort_order) values (t, 'Postres', 'kitchen', 6) returning id into c_postres;

  -- Insumos (costo por g / ml / unidad en COP) ----------------------------------------------
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit, is_liquor) values
    (t, 'Ron blanco',        'ml', 7000, 1500, 60,  true)  returning id into i_ron;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit, is_liquor) values
    (t, 'Tequila reposado',  'ml', 4500, 1000, 110, true)  returning id into i_tequila;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit, is_liquor) values
    (t, 'Ginebra',           'ml', 5250, 1000, 95,  true)  returning id into i_gin;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit, is_liquor) values
    (t, 'Vodka',             'ml', 3000, 1000, 70,  true)  returning id into i_vodka;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit, is_liquor) values
    (t, 'Triple sec',        'ml', 1400, 500,  65,  true)  returning id into i_triple;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Agua tónica',       'ml', 12000, 3000, 8)          returning id into i_tonica;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Zumo de limón',     'ml', 4000, 1000, 12)          returning id into i_limon;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Hierbabuena',       'g',  600,  150,  30)          returning id into i_hierbabuena;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Azúcar',            'g',  5000, 1000, 4)           returning id into i_azucar;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Soda',              'ml', 10000, 2000, 5)          returning id into i_soda;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Cerveza nacional',  'unit', 96, 24, 2800)          returning id into i_cerveza;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Cerveza artesanal', 'unit', 18, 24, 6500)          returning id into i_artesanal;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Carne de res',      'g',  8000, 2000, 32)          returning id into i_carne;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Pan brioche',       'unit', 40, 10, 1200)          returning id into i_pan;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Queso cheddar',     'g',  3000, 500, 38)           returning id into i_queso;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Papa',              'g',  15000, 3000, 4)          returning id into i_papa;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Aceite',            'ml', 10000, 2000, 9)          returning id into i_aceite;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Totopos',           'g',  4000, 1000, 16)          returning id into i_nachos;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Frijol refrito',    'g',  2500, 500, 10)           returning id into i_frijol;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Pollo',             'g',  6000, 1500, 18)          returning id into i_pollo;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Crema de leche',    'ml', 3000, 500, 14)           returning id into i_crema;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Chocolate 70%',     'g',  1500, 300, 45)           returning id into i_chocolate;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Pulpa de lulo',     'ml', 5000, 1000, 11)          returning id into i_lulo;
  insert into public.ingredients (tenant_id, name, unit, stock_quantity, min_stock, cost_per_unit) values
    (t, 'Hielo',             'g',  50000, 10000, 0.3)       returning id into i_hielo;

  -- Sub-recetas ----------------------------------------------------------------------
  insert into public.sub_recipes (tenant_id, name, yield_quantity, yield_unit, notes)
  values (t, 'Jarabe simple', 1000, 'ml', '1:1 azúcar y agua') returning id into sr_jarabe;
  insert into public.sub_recipe_ingredients (tenant_id, sub_recipe_id, ingredient_id, quantity)
  values (t, sr_jarabe, i_azucar, 650);

  insert into public.sub_recipes (tenant_id, name, yield_quantity, yield_unit, notes)
  values (t, 'Sour mix', 1000, 'ml', 'Limón + jarabe') returning id into sr_sour;
  insert into public.sub_recipe_ingredients (tenant_id, sub_recipe_id, ingredient_id, quantity)
  values (t, sr_sour, i_limon, 600), (t, sr_sour, i_azucar, 260);

  -- Productos + fichas técnicas -------------------------------------------------------------
  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_cocteles, 'Mojito', 'Ron, hierbabuena, limón y soda', 28000, 1) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_ron, 60), (t, p, i_hierbabuena, 8), (t, p, i_limon, 25), (t, p, i_soda, 90), (t, p, i_hielo, 180);
  insert into public.recipes (tenant_id, product_id, sub_recipe_id, quantity) values (t, p, sr_jarabe, 20);
  insert into public.modifiers (tenant_id, product_id, name, price_delta, sort_order) values
    (t, p, 'Doble ron', 9000, 1), (t, p, 'De maracuyá', 3000, 2);

  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_cocteles, 'Margarita', 'Tequila, triple sec y sour', 32000, 2) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_tequila, 50), (t, p, i_triple, 20), (t, p, i_hielo, 150);
  insert into public.recipes (tenant_id, product_id, sub_recipe_id, quantity) values (t, p, sr_sour, 30);
  insert into public.modifiers (tenant_id, product_id, name, price_delta, sort_order) values
    (t, p, 'Escarchada con sal', 0, 1), (t, p, 'Frozen', 2000, 2);

  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_cocteles, 'Gin tonic', 'Ginebra, tónica y cítricos', 30000, 3) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_gin, 50), (t, p, i_tonica, 200), (t, p, i_hielo, 200);

  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_cocteles, 'Lulada con vodka', 'Lulo, vodka y limón', 26000, 4) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_vodka, 45), (t, p, i_lulo, 120), (t, p, i_limon, 10), (t, p, i_hielo, 150);

  insert into public.products (tenant_id, category_id, name, price, sort_order)
  values (t, c_cervezas, 'Cerveza nacional', 9000, 1) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values (t, p, i_cerveza, 1);
  insert into public.modifiers (tenant_id, product_id, name, price_delta, sort_order) values
    (t, p, 'Michelada', 3000, 1);

  insert into public.products (tenant_id, category_id, name, price, sort_order)
  values (t, c_cervezas, 'Cerveza artesanal IPA', 16000, 2) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values (t, p, i_artesanal, 1);

  insert into public.products (tenant_id, category_id, name, price, sort_order)
  values (t, c_sin_alcohol, 'Limonada de hierbabuena', 11000, 1) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_limon, 40), (t, p, i_hierbabuena, 6), (t, p, i_hielo, 200);
  insert into public.recipes (tenant_id, product_id, sub_recipe_id, quantity) values (t, p, sr_jarabe, 30);

  insert into public.products (tenant_id, category_id, name, price, track_stock, sort_order)
  values (t, c_sin_alcohol, 'Agua con gas', 6000, false, 2);

  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_entradas, 'Nachos de la casa', 'Totopos, frijol, cheddar y pico de gallo', 24000, 1) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_nachos, 150), (t, p, i_frijol, 80), (t, p, i_queso, 60);
  insert into public.modifiers (tenant_id, product_id, name, price_delta, sort_order) values
    (t, p, 'Extra queso', 4000, 1), (t, p, 'Con pollo', 7000, 2);

  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_entradas, 'Papas rústicas', 'Con alioli de la casa', 15000, 2) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_papa, 300), (t, p, i_aceite, 40);

  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_fuertes, 'Hamburguesa GastroBar', '200 g de res, cheddar y papas', 38000, 1) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_carne, 200), (t, p, i_pan, 1), (t, p, i_queso, 40), (t, p, i_papa, 180), (t, p, i_aceite, 30);
  insert into public.modifiers (tenant_id, product_id, name, price_delta, sort_order) values
    (t, p, 'Término medio', 0, 1), (t, p, 'Tres cuartos', 0, 2), (t, p, 'Bien asada', 0, 3), (t, p, 'Doble carne', 12000, 4);

  insert into public.products (tenant_id, category_id, name, description, price, sort_order)
  values (t, c_fuertes, 'Pollo a la plancha', 'Con papas y ensalada', 34000, 2) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_pollo, 250), (t, p, i_papa, 150), (t, p, i_aceite, 20);

  insert into public.products (tenant_id, category_id, name, price, sort_order)
  values (t, c_postres, 'Brownie con helado', 16000, 1) returning id into p;
  insert into public.recipes (tenant_id, product_id, ingredient_id, quantity) values
    (t, p, i_chocolate, 60), (t, p, i_crema, 40), (t, p, i_azucar, 30);

  -- Modificadores globales por categoría ------------------------------------------------------
  insert into public.modifiers (tenant_id, category_id, name, price_delta, sort_order) values
    (t, c_cocteles, 'Sin hielo', 0, 10), (t, c_cocteles, 'Poco dulce', 0, 11),
    (t, c_fuertes, 'Sin cebolla', 0, 10), (t, c_fuertes, 'Salsa aparte', 0, 11),
    (t, c_entradas, 'Sin picante', 0, 10);

  raise notice 'Datos demo cargados para %', v_slug;
end $$;
