'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/lib/actions';
import {
  createTablesBulk,
  deleteEntity,
  isDeletableEntity,
  saveCategory,
  saveIngredient,
  saveModifier,
  saveProduct,
  saveSubRecipe,
  saveTable,
  saveZone,
  setProductActive,
  setProductImage,
  updateTenantSettings,
} from '@/lib/services/catalog';
import type {
  BulkTablesInput,
  CategoryInput,
  IngredientInput,
  ModifierInput,
  ProductInput,
  SubRecipeInput,
  TableInput,
  TenantSettingsInput,
  ZoneInput,
} from '@/lib/validations/catalog';

const ADMIN = ['admin'] as const;

/** Tras cambiar catálogo/salón se revalida todo lo que lo muestra. */
function revalidateCatalog() {
  for (const path of ['/admin/menu', '/admin/floor', '/admin/inventory', '/admin/settings', '/admin/qr', '/waiter']) {
    revalidatePath(path);
  }
}

async function adminMutation<T>(fn: Parameters<typeof runAction<T>>[1]) {
  const result = await runAction(ADMIN, fn);
  if (result.ok) revalidateCatalog();
  return result;
}

export async function saveCategoryAction(input: CategoryInput) {
  return adminMutation((ctx) => saveCategory(ctx, input));
}

export async function saveProductAction(input: ProductInput) {
  return adminMutation((ctx) => saveProduct(ctx, input));
}

export async function setProductActiveAction(productId: string, isActive: boolean) {
  return adminMutation((ctx) => setProductActive(ctx, z.uuid().parse(productId), isActive));
}

export async function setProductImageAction(productId: string, imageUrl: string | null) {
  return adminMutation((ctx) => setProductImage(ctx, z.uuid().parse(productId), imageUrl === null ? null : z.url().parse(imageUrl)));
}

export async function saveModifierAction(input: ModifierInput) {
  return adminMutation((ctx) => saveModifier(ctx, input));
}

export async function saveSubRecipeAction(input: SubRecipeInput) {
  return adminMutation((ctx) => saveSubRecipe(ctx, input));
}

export async function saveIngredientAction(input: IngredientInput) {
  return adminMutation((ctx) => saveIngredient(ctx, input));
}

export async function saveZoneAction(input: ZoneInput) {
  return adminMutation((ctx) => saveZone(ctx, input));
}

export async function saveTableAction(input: TableInput) {
  return adminMutation((ctx) => saveTable(ctx, input));
}

export async function createTablesBulkAction(input: BulkTablesInput) {
  return adminMutation((ctx) => createTablesBulk(ctx, input));
}

export async function deleteEntityAction(entity: string, id: string) {
  return adminMutation(async (ctx) => {
    if (!isDeletableEntity(entity)) throw new Error('Entidad no permitida');
    await deleteEntity(ctx, entity, z.uuid().parse(id));
  });
}

export async function updateTenantSettingsAction(input: TenantSettingsInput) {
  return adminMutation((ctx) => updateTenantSettings(ctx, input));
}
