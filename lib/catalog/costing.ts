/**
 * Costeo de fichas técnicas (puro, sin dependencias): costo por porción de un
 * producto a partir de sus insumos directos y de porciones de sub-recetas.
 */

export type CostIngredient = { id: string; cost_per_unit: number };
export type CostSubRecipe = {
  id: string;
  yield_quantity: number;
  lines: Array<{ ingredient_id: string; quantity: number }>;
};
export type CostRecipeLine = { ingredient_id?: string | null; sub_recipe_id?: string | null; quantity: number };

/** Costo de todo un lote de sub-receta. */
export function subRecipeBatchCost(sub: CostSubRecipe, ingredients: Map<string, CostIngredient>): number {
  return sub.lines.reduce((sum, l) => sum + l.quantity * (ingredients.get(l.ingredient_id)?.cost_per_unit ?? 0), 0);
}

/** Costo por g / ml / unidad del rendimiento de la sub-receta. */
export function subRecipeUnitCost(sub: CostSubRecipe, ingredients: Map<string, CostIngredient>): number {
  return sub.yield_quantity > 0 ? subRecipeBatchCost(sub, ingredients) / sub.yield_quantity : 0;
}

export function recipeLineCost(
  line: CostRecipeLine,
  ingredients: Map<string, CostIngredient>,
  subRecipes: Map<string, CostSubRecipe>,
): number {
  if (line.ingredient_id) return line.quantity * (ingredients.get(line.ingredient_id)?.cost_per_unit ?? 0);
  if (line.sub_recipe_id) {
    const sub = subRecipes.get(line.sub_recipe_id);
    return sub ? line.quantity * subRecipeUnitCost(sub, ingredients) : 0;
  }
  return 0;
}

/** Precio sin impuesto: base sobre la que se mide el food cost y el margen. */
export function netOfTax(price: number, taxRate: number, pricesIncludeTax: boolean): number {
  return pricesIncludeTax && taxRate > 0 ? price / (1 + taxRate / 100) : price;
}

export type ProductCosting = {
  cost: number;
  /** Margen bruto sobre el precio (0-100) o null si el precio es 0. */
  marginPct: number | null;
  /** Costo de insumos sobre el precio (0-100) o null si el precio es 0. */
  foodCostPct: number | null;
};

export function costProduct(
  price: number,
  lines: CostRecipeLine[],
  ingredients: Map<string, CostIngredient>,
  subRecipes: Map<string, CostSubRecipe>,
): ProductCosting {
  const cost = lines.reduce((sum, l) => sum + recipeLineCost(l, ingredients, subRecipes), 0);
  if (price <= 0) return { cost, marginPct: null, foodCostPct: null };
  return { cost, marginPct: ((price - cost) / price) * 100, foodCostPct: (cost / price) * 100 };
}

/** Semáforo de food cost habitual en bares: <=25% bien, <=35% vigilar, >35% alto. */
export function foodCostLevel(foodCostPct: number | null): 'good' | 'watch' | 'high' | 'none' {
  if (foodCostPct === null) return 'none';
  if (foodCostPct <= 25) return 'good';
  if (foodCostPct <= 35) return 'watch';
  return 'high';
}
