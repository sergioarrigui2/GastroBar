import { z } from 'zod';
import type { Fact } from './facts.ts';

/** Estructura obligatoria de la respuesta del Agente Analista. */
export const analystReportSchema = z.object({
  headline: z.string().min(10).max(160).describe('Titular de una línea sobre cómo está el negocio.'),
  health: z.enum(['good', 'watch', 'critical']).describe('good = sano, watch = hay que vigilar algo, critical = hay que actuar ya.'),
  summary: z.string().min(40).max(900).describe('Resumen ejecutivo de 3 a 5 frases, en lenguaje de dueño de negocio.'),
  highlights: z
    .array(
      z.object({
        title: z.string().max(120),
        evidence: z.string().max(400).describe('Cifras exactas copiadas de los hechos.'),
        evidence_refs: z.array(z.string()).min(1).describe('Ids de los hechos citados, p. ej. ["ventas", "p1"].'),
      }),
    )
    .max(3)
    .describe('Lo que va bien y conviene mantener.'),
  findings: z
    .array(
      z.object({
        title: z.string().max(140),
        severity: z.enum(['critical', 'warning', 'opportunity']),
        evidence: z.string().max(500).describe('Qué muestran los datos, sólo con cifras copiadas de los hechos.'),
        evidence_refs: z.array(z.string()).min(1),
        impact: z.string().max(300).describe('Por qué importa en dinero o clientes. Si es una estimación, dilo ("aprox.").'),
        action: z.string().max(400).describe('Acción concreta para esta semana: quién, qué y cómo.'),
      }),
    )
    .min(1)
    .max(6)
    .describe('Problemas y oportunidades, ordenados del más al menos importante.'),
  menu_actions: z
    .array(
      z.object({
        product: z.string().max(80),
        action: z.string().max(300),
        evidence_refs: z.array(z.string()).min(1),
      }),
    )
    .max(5)
    .describe('Decisiones concretas sobre productos del menú (precio, receta, promoción, retirar).'),
  questions: z.array(z.string().max(240)).max(3).describe('Preguntas al dueño para entender lo que los datos no explican.'),
});

export type AnalystReport = z.infer<typeof analystReportSchema>;

export type ReportVerification = {
  ok: boolean;
  /** Ids citados que no existen entre los hechos. */
  unknown_refs: string[];
  /** Cifras de la evidencia que no aparecen en ningún hecho. */
  unverified_numbers: Array<{ section: string; index: number; value: string }>;
};

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Números "significativos" de un texto: 3+ dígitos o con decimales/porcentaje. */
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d.,]*%?/g) ?? [])
    .map((t) => t.replace(/[.,]+$/, ''))
    .filter((t) => digitsOf(t).length >= 3 || /[.,]\d|%/.test(t));
}

/**
 * Comprueba que el modelo sólo cite hechos existentes y que cada cifra de la
 * evidencia aparezca literalmente en algún hecho (comparando sólo dígitos, para
 * tolerar "25,6" vs "25.6" o "$ 1.200.000" vs "1200000").
 */
export function verifyReport(report: AnalystReport, facts: Fact[]): ReportVerification {
  const ids = new Set(facts.map((f) => f.id));
  const factDigits = new Set<string>();
  for (const f of facts) for (const n of f.text.match(/\d[\d.,]*/g) ?? []) factDigits.add(digitsOf(n.replace(/[.,]+$/, '')));

  const unknown = new Set<string>();
  const unverified: ReportVerification['unverified_numbers'] = [];
  const check = (section: string, items: Array<{ evidence?: string; evidence_refs: string[] }>) =>
    items.forEach((item, index) => {
      item.evidence_refs.filter((r) => !ids.has(r)).forEach((r) => unknown.add(r));
      for (const n of numbersIn(item.evidence ?? '')) {
        if (!factDigits.has(digitsOf(n))) unverified.push({ section, index, value: n });
      }
    });

  check('highlights', report.highlights);
  check('findings', report.findings);
  check('menu_actions', report.menu_actions);

  return { ok: unknown.size === 0 && unverified.length === 0, unknown_refs: [...unknown], unverified_numbers: unverified };
}
