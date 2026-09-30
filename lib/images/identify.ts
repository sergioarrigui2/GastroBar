import 'server-only';

import { anthropic } from '@ai-sdk/anthropic';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import { getAgentAccess } from '@/lib/ai/entitlements';
import { MODELS, monthStart } from '@/lib/ai/plans';
import { getAiQuota } from '@/lib/ai/quota';
import { recordAiUsage } from '@/lib/ai/usage';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { TenantContext } from '@/lib/tenant-context';

/**
 * Sugerencia de producto para fotos del menú con IA, con el costo bajo control:
 * · sólo si el gastrobar tiene el Ingeniero de menú y le queda cupo de IA en el mes;
 * · modelo económico (Haiku), miniaturas de ~320 px y lotes de 8 fotos por llamada;
 * · tope de llamadas por mes y por gastrobar; cada llamada queda en ai_usage.
 * El emparejamiento por nombre de archivo (gratis) se hace antes, en el navegador.
 */
export const AI_BATCH = 8;
export const AI_CALLS_PER_MONTH = 50; // ≈ 400 fotos al mes por gastrobar
const MAX_THUMB_CHARS = 120_000; // miniatura en base64 (~90 KB)

export type AiImagesStatus = { enabled: boolean; reason: string | null; photosLeft: number };

export async function aiImagesStatus(ctx: TenantContext): Promise<AiImagesStatus & { callsLeft: number }> {
  const access = await getAgentAccess(ctx);
  if (!access.ingeniero.active) return { enabled: false, reason: 'El reconocimiento con IA viene con el Ingeniero de menú.', photosLeft: 0, callsLeft: 0 };
  const [quota, used] = await Promise.all([
    getAiQuota(ctx),
    createSupabaseAdminClient()
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenant.id)
      .eq('feature', 'menu_images')
      .gte('created_at', monthStart(ctx.tenant.timezone).toISOString()),
  ]);
  const callsLeft = Math.max(0, AI_CALLS_PER_MONTH - (used.count ?? 0));
  if (quota.budgetLeftUsd <= 0) return { enabled: false, reason: 'Ya usaste la IA incluida este mes.', photosLeft: 0, callsLeft: 0 };
  if (!callsLeft) return { enabled: false, reason: 'Ya usaste el reconocimiento de fotos incluido este mes.', photosLeft: 0, callsLeft: 0 };
  return { enabled: true, reason: null, photosLeft: callsLeft * AI_BATCH, callsLeft };
}

const resultSchema = z.object({
  results: z.array(
    z.object({
      photo: z.number().int().describe('Número de la foto (1, 2, 3…)'),
      product: z.number().int().nullable().describe('Número del producto de la carta, o null si la foto no es un producto de la carta'),
      confidence: z.enum(['alta', 'media', 'baja']),
    }),
  ),
});

export type PhotoSuggestion = { photo: number; productId: string | null; confidence: 'alta' | 'media' | 'baja' };

/** Sugiere el producto de cada foto de un lote (máx. AI_BATCH). Las fotos van como miniaturas JPEG en base64. */
export async function suggestProductsForPhotos(ctx: TenantContext, thumbnails: string[]): Promise<PhotoSuggestion[]> {
  const photos = z
    .array(z.string().regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/, 'Imagen inválida').max(MAX_THUMB_CHARS, 'Imagen demasiado grande'))
    .min(1)
    .max(AI_BATCH)
    .parse(thumbnails);
  const status = await aiImagesStatus(ctx);
  if (!status.enabled) throw new Error(status.reason ?? 'La IA no está disponible');

  const [{ data: products, error }, { data: categories }] = await Promise.all([
    ctx.supabase.from('products').select('id, name, category_id').eq('tenant_id', ctx.tenant.id).eq('is_active', true).order('name'),
    ctx.supabase.from('categories').select('id, name').eq('tenant_id', ctx.tenant.id),
  ]);
  if (error) throw error;
  if (!products.length) return [];
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  // Carta compacta con números (no ids largos): menos tokens.
  const menu = products
    .map((p, i) => `${i + 1}. ${p.name}${categoryName.has(p.category_id) ? ` (${categoryName.get(p.category_id)})` : ''}`)
    .join('\n');

  const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mediaType: string }> = [
    {
      type: 'text',
      text: `Carta del gastrobar (número. producto (categoría)):\n${menu}\n\nPara cada foto, di qué producto de la carta muestra. Si la foto no muestra un producto de esta carta (el local, personas, eventos, publicidad, varios productos mezclados), usa product = null. Sé conservador: confidence "alta" sólo si estás seguro.`,
    },
  ];
  photos.forEach((dataUrl, i) => {
    const [, mediaType, base64] = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl)!;
    content.push({ type: 'text', text: `Foto ${i + 1}:` }, { type: 'image', image: base64!, mediaType: mediaType! });
  });

  const started = Date.now();
  const model = MODELS.economy;
  try {
    const result = await generateText({
      model: anthropic(model),
      system: 'Identificas productos de la carta de un gastrobar colombiano en fotos de su página de Facebook. Respondes sólo con el JSON pedido.',
      messages: [{ role: 'user', content }],
      output: Output.object({ schema: resultSchema, name: 'fotos' }),
      maxOutputTokens: 600,
      temperature: 0,
    });
    await recordAiUsage(ctx, { feature: 'menu_images', model, usage: result.totalUsage, durationMs: Date.now() - started });
    return result.output.results
      .filter((r) => r.photo >= 1 && r.photo <= photos.length)
      .map((r) => ({
        photo: r.photo,
        productId: r.product && r.product >= 1 && r.product <= products.length ? products[r.product - 1]!.id : null,
        confidence: r.confidence,
      }));
  } catch (error) {
    const usage = NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
    await recordAiUsage(ctx, { feature: 'menu_images', model, usage, durationMs: Date.now() - started, status: 'error', error: error instanceof Error ? error.message : String(error) });
    throw new Error('La IA no pudo revisar estas fotos. Intenta de nuevo o asígnalas a mano.');
  }
}
