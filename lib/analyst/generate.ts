import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, NoObjectGeneratedError, Output, type LanguageModelUsage, type ModelMessage } from 'ai';
import { MODELS, pickAnalystModel } from '@/lib/ai/plans';
import { getAiQuota } from '@/lib/ai/quota';
import { recordAiUsage } from '@/lib/ai/usage';
import { ANALYSIS_RANGES, type AnalysisRangeKey, getBusinessAnalysis, rangeFromDays } from '@/lib/services/analytics';
import type { TenantContext } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';
import { buildFacts, factsToPrompt } from './facts';
import { ANALYST_PROMPT_VERSION, analystSystemPrompt, analystUserPrompt, correctionPrompt } from './prompt';
import { analystReportSchema, type AnalystReport, type ReportVerification, verifyReport } from './report';

/** Freno anti-abuso adicional al cupo mensual del plan. */
export const ANALYST_DAILY_LIMIT = 10;
/** Con menos cuentas cerradas que esto no se llama al modelo: no hay nada que interpretar. */
export const ANALYST_MIN_ORDERS = 15;
/** Tiempo tras el cual no se intenta una segunda pasada de corrección (la función tiene 60 s). */
const RETRY_BUDGET_MS = 25_000;

/**
 * Esfuerzo de razonamiento. Medido con datos reales: "medium" tarda ~33 s y cuesta
 * ~USD 0,036 por informe con la misma calidad verificada; el valor por defecto del
 * modelo tardó ~72 s (más que el límite de 60 s de la función) y ~USD 0,085.
 */
function analystEffort(): 'low' | 'medium' | 'high' {
  const e = process.env.ANALYST_EFFORT;
  return e === 'low' || e === 'high' ? e : 'medium';
}

export function isAnalystConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export class AnalystError extends Error {
  constructor(
    public readonly code: 'not_configured' | 'rate_limited' | 'quota_exceeded' | 'no_data' | 'model_failed',
    message: string,
  ) {
    super(message);
  }
}

export type GeneratedReport = { id: string; cached: boolean; model?: string; routeReason?: string };

/**
 * Genera (o reutiliza) el informe del Analista para un rango:
 * 1) SQL calcula el resumen exacto, 2) se convierte en hechos citables,
 * 3) una llamada al modelo con salida estructurada, 4) se verifican las cifras
 * (una corrección como máximo) y 5) se guarda el informe con su consumo.
 */
export async function generateAnalystReport(ctx: TenantContext, rangeKey: AnalysisRangeKey): Promise<GeneratedReport> {
  if (!isAnalystConfigured()) {
    throw new AnalystError('not_configured', 'Falta configurar ANTHROPIC_API_KEY en el servidor.');
  }

  const range = rangeFromDays(ANALYSIS_RANGES[rangeKey].days);
  const analysis = await getBusinessAnalysis(ctx, range);
  if (analysis.snapshot.kpis.orders < ANALYST_MIN_ORDERS) {
    throw new AnalystError(
      'no_data',
      `Hay ${analysis.snapshot.kpis.orders} cuenta(s) cerrada(s) en este periodo; el Analista necesita al menos ${ANALYST_MIN_ORDERS} para sacar conclusiones. Mientras tanto, revisa el tablero y las alertas (no consumen informes).`,
    );
  }
  const quota = await getAiQuota(ctx);

  const { currency, locale, timezone, name } = ctx.tenant;
  const facts = buildFacts(analysis, {
    money: (n) => formatCurrency(n, currency, locale),
    date: (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(new Date(iso)),
  });
  const anomalies = analysis.anomalies;
  const route = pickAnalystModel(quota.plan.tier, {
    facts: facts.length,
    anomalies: anomalies.length,
    critical: anomalies.filter((a) => a.severity === 'critical').length,
    days: analysis.snapshot.period.days,
  });
  const model = route.model;
  const factsHash = createHash('sha256')
    .update(JSON.stringify({ v: ANALYST_PROMPT_VERSION, model, facts }))
    .digest('hex');

  // Mismos hechos, mismo modelo y misma versión de instrucciones => no se vuelve a pagar.
  const { data: cached } = await ctx.supabase
    .from('ai_reports')
    .select('id')
    .eq('tenant_id', ctx.tenant.id)
    .eq('facts_hash', factsHash)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle();
  if (cached) return { id: cached.id, cached: true };

  // Cupo del plan y tope de gasto: se validan antes de gastar un solo token.
  if (!quota.canGenerateReport) {
    throw new AnalystError('quota_exceeded', `${quota.blockedReason} Tus informes anteriores siguen disponibles en el historial.`);
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await ctx.supabase
    .from('ai_reports')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenant.id)
    .gte('created_at', since);
  if ((count ?? 0) >= ANALYST_DAILY_LIMIT) {
    throw new AnalystError('rate_limited', `Llegaste al límite de ${ANALYST_DAILY_LIMIT} informes en 24 horas. Intenta más tarde.`);
  }

  const started = Date.now();
  const reportId = randomUUID();
  const messages: ModelMessage[] = [{ role: 'user', content: analystUserPrompt(factsToPrompt(facts)) }];
  let report: AnalystReport | null = null;
  let verification: ReportVerification | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;
  let failure: string | null = null;

  // Cada llamada al modelo queda en ai_usage con su costo, incluso si falla.
  const track = async (callModel: string, usage: Partial<LanguageModelUsage> | undefined, callStarted: number, error?: string) => {
    inputTokens += usage?.inputTokens ?? 0;
    outputTokens += usage?.outputTokens ?? 0;
    const cost = await recordAiUsage(ctx, {
      feature: 'analyst_report',
      model: callModel,
      usage,
      durationMs: Date.now() - callStarted,
      status: error ? 'error' : 'ok',
      referenceId: reportId,
      error,
    });
    totalCost += cost ?? 0;
  };

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const callStarted = Date.now();
      // La corrección (2.º intento) es una tarea simple: se hace con el modelo económico.
      const callModel = attempt === 0 ? model : MODELS.economy;
      let result;
      try {
        result = await generateText({
          model: anthropic(callModel),
          system: analystSystemPrompt({ name, currency }),
          messages,
          output: Output.object({ schema: analystReportSchema, name: 'informe_analista' }),
          maxOutputTokens: 10_000,
          temperature: 0.2,
          ...(callModel === MODELS.economy ? {} : { providerOptions: { anthropic: { effort: analystEffort() } } }),
        });
      } catch (error) {
        const usage = NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
        await track(callModel, usage, callStarted, error instanceof Error ? error.message : String(error));
        throw error;
      }
      await track(callModel, result.totalUsage, callStarted);
      report = result.output;
      verification = verifyReport(report, facts);
      if (verification.ok || Date.now() - started > RETRY_BUDGET_MS) break;

      const problems = [
        ...verification.unknown_refs.map((r) => `El id "${r}" no existe.`),
        ...verification.unverified_numbers.map((n) => `La cifra "${n.value}" en ${n.section} #${n.index + 1} no aparece en los hechos.`),
      ];
      messages.push({ role: 'assistant', content: JSON.stringify(report) }, { role: 'user', content: correctionPrompt(problems) });
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const { data: saved, error: saveError } = await ctx.supabase
    .from('ai_reports')
    .insert({
      id: reportId,
      tenant_id: ctx.tenant.id,
      period_from: range.from,
      period_to: range.to,
      range_key: rangeKey,
      status: report ? 'completed' : 'failed',
      model,
      facts_hash: factsHash,
      facts,
      content: report,
      verification,
      error: failure,
      input_tokens: inputTokens || null,
      output_tokens: outputTokens || null,
      duration_ms: Date.now() - started,
      cost_usd: totalCost || null,
    })
    .select('id')
    .single();
  if (saveError) throw saveError;
  if (!report) throw new AnalystError('model_failed', 'El analista no pudo completar el informe. Intenta de nuevo en unos minutos.');

  return { id: saved.id, cached: false, model, routeReason: route.reason };
}
