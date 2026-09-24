import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { MODELS } from '@/lib/ai/plans';
import { getAiQuota } from '@/lib/ai/quota';
import { recordAiUsage } from '@/lib/ai/usage';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import { PURCHASE_REVIEW_SYSTEM, type PurchaseReview, purchaseReviewPrompt, purchaseReviewSchema } from '@/lib/purchasing/ai-review';
import { buildPurchasePlan, type PurchaseInputs, type PurchaseLine } from '@/lib/purchasing/forecast';
import { nextRunAt } from '@/lib/purchasing/schedule';
import type { TenantContext } from '@/lib/tenant-context';
import type { Database, Json } from '@/types/database';

type Client = SupabaseClient<Database>;

/** Semanas de historia que usa el pronóstico. */
export const HISTORY_DAYS = 56;

export type StoredSuggestion = Omit<Database['public']['Tables']['purchase_suggestions']['Row'], 'lines' | 'notes' | 'ai_review'> & {
  lines: PurchaseLine[];
  notes: string[];
  ai_review: (PurchaseReview & { model: string; cost_usd: number | null; created_at: string }) | null;
};

const toStored = (row: Database['public']['Tables']['purchase_suggestions']['Row']): StoredSuggestion => ({
  ...row,
  lines: row.lines as unknown as PurchaseLine[],
  notes: row.notes as unknown as string[],
  ai_review: row.ai_review as unknown as StoredSuggestion['ai_review'],
});

/**
 * Calcula y guarda un pedido sugerido. Sin IA. Lo usan la acción manual (cliente del
 * usuario, con RLS) y el cron (service role, con tenant explícito).
 */
export async function runPurchasePlan(
  supabase: Client,
  tenantId: string,
  horizonDays: number,
  trigger: 'manual' | 'schedule',
): Promise<string> {
  const { data, error } = await supabase.rpc('get_purchase_inputs', { p_tenant: tenantId, p_days: HISTORY_DAYS });
  if (error) throw error;
  const plan = buildPurchasePlan(data as unknown as PurchaseInputs, horizonDays);

  const { data: saved, error: saveError } = await supabase
    .from('purchase_suggestions')
    .insert({
      tenant_id: tenantId,
      trigger,
      horizon_days: horizonDays,
      coverage_from: plan.coverage_from,
      coverage_to: plan.coverage_to,
      history_days: HISTORY_DAYS,
      lines: plan.lines as unknown as Json,
      notes: plan.notes as unknown as Json,
      total_estimated: plan.total_estimated,
    })
    .select('id')
    .single();
  if (saveError) throw saveError;
  return saved.id;
}

export async function getPurchasingOverview(ctx: TenantContext) {
  const t = ctx.tenant.id;
  const [suppliers, ingredients, schedule, suggestions] = await Promise.all([
    ctx.supabase.from('suppliers').select('*').eq('tenant_id', t).order('name'),
    ctx.supabase
      .from('ingredients')
      .select('id, name, unit, stock_quantity, min_stock, cost_per_unit, supplier_id, pack_size, pack_label')
      .eq('tenant_id', t)
      .order('name'),
    ctx.supabase.from('agent_schedules').select('*').eq('tenant_id', t).eq('agent', 'purchase').maybeSingle(),
    ctx.supabase.from('purchase_suggestions').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(15),
  ]);
  for (const r of [suppliers, ingredients, schedule, suggestions]) if (r.error) throw r.error;
  return {
    suppliers: suppliers.data ?? [],
    ingredients: ingredients.data ?? [],
    schedule: schedule.data,
    suggestions: (suggestions.data ?? []).map(toStored),
  };
}

// ─── Proveedores y empaques ─────────────────────────────────────────────────────

export const supplierSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Escribe el nombre').max(120),
  contact_name: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(30).nullish(),
  email: z.union([z.email(), z.literal('')]).nullish(),
  lead_time_days: z.coerce.number().int().min(0).max(30),
  notes: z.string().trim().max(500).nullish(),
  is_active: z.boolean().default(true),
});

export async function saveSupplier(ctx: TenantContext, input: z.input<typeof supplierSchema>) {
  const { id, ...data } = supplierSchema.parse(input);
  const row = { ...data, email: data.email || null, contact_name: data.contact_name || null, phone: data.phone || null, notes: data.notes || null };
  const { error } = id
    ? await ctx.supabase.from('suppliers').update(row).eq('tenant_id', ctx.tenant.id).eq('id', id)
    : await ctx.supabase.from('suppliers').insert(row);
  if (error) throw error;
}

export async function deleteSupplier(ctx: TenantContext, id: string) {
  const { error } = await ctx.supabase.from('suppliers').delete().eq('tenant_id', ctx.tenant.id).eq('id', z.uuid().parse(id));
  if (error) throw error;
}

export const ingredientPurchaseSchema = z.object({
  id: z.uuid(),
  supplier_id: z.uuid().nullable(),
  pack_size: z.coerce.number().positive().nullable(),
  pack_label: z.string().trim().max(60).nullable(),
});

export async function updateIngredientPurchasing(ctx: TenantContext, input: z.input<typeof ingredientPurchaseSchema>) {
  const { id, ...data } = ingredientPurchaseSchema.parse(input);
  const { error } = await ctx.supabase
    .from('ingredients')
    .update({ ...data, pack_label: data.pack_label || null })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', id);
  if (error) throw error;
}

// ─── Horario del agente ─────────────────────────────────────────────────────────

export const scheduleSchema = z.object({
  is_active: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  weekday: z.coerce.number().int().min(1).max(7),
  day_of_month: z.coerce.number().int().min(1).max(28),
  hour: z.coerce.number().int().min(0).max(23),
  horizon_days: z.coerce.number().int().min(1).max(31),
});

export async function savePurchaseSchedule(ctx: TenantContext, input: z.input<typeof scheduleSchema>) {
  const data = scheduleSchema.parse(input);
  const { data: current } = await ctx.supabase
    .from('agent_schedules')
    .select('last_run_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('agent', 'purchase')
    .maybeSingle();
  const next = data.is_active ? nextRunAt({ ...data, last_run_at: current?.last_run_at }, new Date(), ctx.tenant.timezone).toISOString() : null;
  const { error } = await ctx.supabase
    .from('agent_schedules')
    .upsert(
      { tenant_id: ctx.tenant.id, agent: 'purchase', ...data, next_run_at: next, last_error: null, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,agent' },
    );
  if (error) throw error;
  return next;
}

// ─── Recepción y descarte ───────────────────────────────────────────────────────

export const receiveSchema = z.object({
  id: z.uuid(),
  quantities: z.record(z.string(), z.coerce.number().min(0)),
});

/** Registra como compras lo que realmente llegó (cantidades editables) y cierra el pedido. */
export async function receiveSuggestion(ctx: TenantContext, input: z.input<typeof receiveSchema>) {
  const { id, quantities } = receiveSchema.parse(input);
  const { data: row, error } = await ctx.supabase
    .from('purchase_suggestions')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', id)
    .single();
  if (error) throw error;
  if (row.status !== 'draft') throw new Error('Este pedido ya fue recibido o descartado');

  const lines = row.lines as unknown as PurchaseLine[];
  let received = 0;
  for (const line of lines) {
    const qty = quantities[line.ingredient_id] ?? line.order_qty;
    if (!(qty > 0)) continue;
    const { error: moveError } = await ctx.supabase.rpc('record_inventory_movement', {
      p_ingredient_id: line.ingredient_id,
      p_type: 'purchase',
      p_quantity: qty,
      p_reason: `Pedido del Comprador (${row.coverage_from} a ${row.coverage_to})`,
      p_unit_cost: line.unit_cost > 0 ? line.unit_cost : null,
    });
    if (moveError) throw new Error(`No se pudo registrar ${line.name}: ${moveError.message}. Lo anterior sí quedó registrado.`);
    received++;
  }

  const { error: updateError } = await ctx.supabase
    .from('purchase_suggestions')
    .update({ status: 'received', received_at: new Date().toISOString(), received_by: ctx.profile.id })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', id);
  if (updateError) throw updateError;
  return received;
}

export async function discardSuggestion(ctx: TenantContext, id: string) {
  const { error } = await ctx.supabase
    .from('purchase_suggestions')
    .update({ status: 'discarded' })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', z.uuid().parse(id))
    .eq('status', 'draft');
  if (error) throw error;
}

// ─── Revisión opcional con IA (Haiku) ───────────────────────────────────────────

/**
 * Segunda mirada con IA, sólo si el administrador la pide. Usa Haiku (el modelo
 * económico), no consume cupo de informes pero sí cuenta en el tope de gasto del
 * plan, y se guarda: pedir de nuevo la misma revisión no vuelve a llamar al modelo.
 */
export async function reviewSuggestionWithAi(ctx: TenantContext, id: string) {
  if (!isAnalystConfigured()) throw new Error('La IA no está configurada en el servidor (ANTHROPIC_API_KEY).');
  const { data: row, error } = await ctx.supabase
    .from('purchase_suggestions')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', z.uuid().parse(id))
    .single();
  if (error) throw error;
  if (row.ai_review) return { cached: true };
  const lines = row.lines as unknown as PurchaseLine[];
  if (lines.length === 0) throw new Error('El pedido está vacío: no hay nada que revisar.');

  const quota = await getAiQuota(ctx);
  if (quota.plan.monthlyBudgetUsd <= 0) throw new Error(`Tu plan (${quota.plan.label}) no incluye funciones de IA.`);
  if (quota.budgetLeftUsd <= 0) throw new Error(`Se alcanzó el tope de gasto de IA de tu plan ${quota.plan.label} este mes.`);

  const model = MODELS.economy;
  const started = Date.now();
  try {
    const result = await generateText({
      model: anthropic(model),
      system: PURCHASE_REVIEW_SYSTEM,
      prompt: purchaseReviewPrompt({
        business: ctx.tenant.name,
        coverage: `${row.coverage_from} a ${row.coverage_to} (${row.horizon_days} días + entrega)`,
        notes: row.notes as unknown as string[],
        lines: lines.slice(0, 60),
      }),
      output: Output.object({ schema: purchaseReviewSchema, name: 'revision_pedido' }),
      maxOutputTokens: 1500,
      temperature: 0.2,
    });
    const cost = await recordAiUsage(ctx, {
      feature: 'purchase_agent',
      model,
      usage: result.totalUsage,
      durationMs: Date.now() - started,
      referenceId: row.id,
    });
    const { error: saveError } = await ctx.supabase
      .from('purchase_suggestions')
      .update({ ai_review: { ...result.output, model, cost_usd: cost, created_at: new Date().toISOString() } as unknown as Json })
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', row.id);
    if (saveError) throw saveError;
    return { cached: false };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      await recordAiUsage(ctx, {
        feature: 'purchase_agent',
        model,
        usage: error.usage,
        durationMs: Date.now() - started,
        status: 'error',
        referenceId: row.id,
        error: error.message,
      });
    }
    throw error;
  }
}
