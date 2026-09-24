import 'server-only';
import type { LanguageModelUsage } from 'ai';
import type { TenantContext } from '@/lib/tenant-context';
import { costUsd } from './pricing';

export type AiFeature = 'analyst_report' | 'purchase_agent' | 'analyst_chat';

export type UsageRecord = {
  feature: AiFeature;
  model: string;
  usage: Partial<LanguageModelUsage> | undefined;
  durationMs: number;
  status?: 'ok' | 'error';
  referenceId?: string | null;
  error?: string | null;
};

export function usageTokens(usage: Partial<LanguageModelUsage> | undefined) {
  return {
    input: usage?.inputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
    reasoning: usage?.outputTokenDetails?.reasoningTokens ?? 0,
    cacheRead: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}

/**
 * Registra una llamada al modelo con su costo. Nunca lanza: si el registro
 * falla, la funcionalidad sigue y el error queda en el log del servidor.
 */
export async function recordAiUsage(ctx: TenantContext, record: UsageRecord): Promise<number | null> {
  const t = usageTokens(record.usage);
  const cost = costUsd(record.model, { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite });
  const { error } = await ctx.supabase.from('ai_usage').insert({
    tenant_id: ctx.tenant.id,
    feature: record.feature,
    model: record.model,
    status: record.status ?? 'ok',
    input_tokens: t.input,
    output_tokens: t.output,
    reasoning_tokens: t.reasoning,
    cache_read_tokens: t.cacheRead,
    cache_write_tokens: t.cacheWrite,
    cost_usd: cost,
    duration_ms: Math.round(record.durationMs),
    reference_id: record.referenceId ?? null,
    error: record.error?.slice(0, 500) ?? null,
  });
  if (error) console.error('[ai_usage] no se pudo registrar el consumo', error);
  return cost;
}
