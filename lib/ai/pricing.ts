/**
 * Precios de la API de Anthropic en USD por millón de tokens (MTok).
 * Fuente: https://platform.claude.com/docs/en/about-claude/pricing (consultado 2026-09-24).
 * Si Anthropic cambia precios, actualiza esta tabla: el costo de cada llamada se
 * congela en `ai_usage` al registrarse, así que el histórico no se altera.
 */
export type ModelPrice = {
  input: number;
  output: number;
  /** Escritura de caché de 5 minutos. */
  cacheWrite: number;
  /** Lectura de caché (hit). */
  cacheRead: number;
};

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
};

/** Normaliza ids con fecha (p. ej. claude-haiku-4-5-20251001 → claude-haiku-4-5). */
export function priceFor(model: string): ModelPrice | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const base = model.replace(/-\d{8}$/, '');
  return MODEL_PRICING[base] ?? null;
}

export type TokenUsage = {
  /** Tokens de entrada totales (incluye los leídos o escritos en caché). */
  input: number;
  /** Tokens de salida totales (incluye el razonamiento, que se cobra como salida). */
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/** Costo en USD de una llamada; null si el modelo no tiene precio registrado. */
export function costUsd(model: string, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const plainInput = Math.max(0, usage.input - cacheRead - cacheWrite);
  const usd =
    (plainInput * price.input + cacheWrite * price.cacheWrite + cacheRead * price.cacheRead + usage.output * price.output) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
