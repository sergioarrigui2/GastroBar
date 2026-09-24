/**
 * Planes de IA que se venden por paquetes. El plan de cada gastrobar vive en
 * `tenant_ai_plans` (migración 008) y sólo lo cambia el dueño de la plataforma
 * (SQL Editor / service role); el administrador del gastrobar sólo lo lee.
 */
export type ModelTier = 'economy' | 'balanced' | 'premium';

export type AiPlanId = 'sin_ia' | 'prueba' | 'basico' | 'pro' | 'premium';

export type AiPlan = {
  id: AiPlanId;
  label: string;
  /** Informes del Analista generados por mes calendario (los reutilizados de caché no cuentan). */
  reportsPerMonth: number;
  /** Tope de gasto de IA por mes en USD: freno de seguridad aunque queden informes. */
  monthlyBudgetUsd: number;
  /** economy = siempre Haiku · balanced = Haiku o Sonnet según complejidad · premium = siempre Sonnet. */
  tier: ModelTier;
};

export const AI_PLANS: Record<AiPlanId, AiPlan> = {
  sin_ia: { id: 'sin_ia', label: 'Sin IA', reportsPerMonth: 0, monthlyBudgetUsd: 0, tier: 'economy' },
  prueba: { id: 'prueba', label: 'Prueba', reportsPerMonth: 3, monthlyBudgetUsd: 0.5, tier: 'economy' },
  basico: { id: 'basico', label: 'Básico', reportsPerMonth: 4, monthlyBudgetUsd: 1, tier: 'economy' },
  pro: { id: 'pro', label: 'Pro', reportsPerMonth: 10, monthlyBudgetUsd: 3, tier: 'balanced' },
  premium: { id: 'premium', label: 'Premium', reportsPerMonth: 30, monthlyBudgetUsd: 10, tier: 'premium' },
};

export type TenantAiPlanRow = {
  plan: string;
  reports_per_month: number | null;
  monthly_budget_usd: number | null;
  model_tier: string | null;
};

export function defaultPlanId(): AiPlanId {
  const env = process.env.DEFAULT_AI_PLAN;
  return env && env in AI_PLANS ? (env as AiPlanId) : 'prueba';
}

/** Plan efectivo: el del catálogo más los ajustes puntuales guardados para ese gastrobar. */
export function resolvePlan(row: TenantAiPlanRow | null): AiPlan {
  const base = AI_PLANS[(row?.plan && row.plan in AI_PLANS ? row.plan : defaultPlanId()) as AiPlanId];
  const tier = row?.model_tier === 'economy' || row?.model_tier === 'balanced' || row?.model_tier === 'premium' ? row.model_tier : base.tier;
  return {
    ...base,
    reportsPerMonth: row?.reports_per_month ?? base.reportsPerMonth,
    monthlyBudgetUsd: row?.monthly_budget_usd !== null && row?.monthly_budget_usd !== undefined ? Number(row.monthly_budget_usd) : base.monthlyBudgetUsd,
    tier,
  };
}

export const MODELS = { economy: 'claude-haiku-4-5', premium: 'claude-sonnet-5' } as const;

export type ReportComplexity = { facts: number; anomalies: number; critical: number; days: number };

/**
 * Enrutador de modelos para el informe del Analista. Haiku (la mitad del costo)
 * resuelve periodos simples; Sonnet se reserva para periodos largos o con varias
 * alertas, donde priorizar y cruzar señales exige más razonamiento.
 * Medido con datos reales: Haiku ~USD 0,018 y Sonnet ~USD 0,036 por informe.
 */
export function pickAnalystModel(tier: ModelTier, c: ReportComplexity): { model: string; reason: string } {
  if (process.env.ANALYST_MODEL) return { model: process.env.ANALYST_MODEL, reason: 'Modelo fijado por configuración del servidor' };
  if (tier === 'economy') return { model: MODELS.economy, reason: 'Plan económico' };
  if (tier === 'premium') return { model: MODELS.premium, reason: 'Plan premium' };
  const complex = c.critical > 0 || c.anomalies >= 3 || c.days > 31 || c.facts > 60;
  return complex
    ? { model: MODELS.premium, reason: `Periodo complejo (${c.anomalies} alertas, ${c.critical} críticas, ${c.days} días)` }
    : { model: MODELS.economy, reason: `Periodo simple (${c.anomalies} alertas, ${c.days} días)` };
}

/** Instante UTC de la medianoche local del día 1 del mes en curso, en la zona del negocio. */
export function monthStart(timezone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const offsetMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get('year'), get('month') - 1, 1, 0, 0, 0) - offsetMs);
}
