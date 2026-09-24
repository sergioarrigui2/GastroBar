import type { AnalystReport } from '../analyst/report';
import type { Anomaly } from './types';

/**
 * Resumen del día para el dueño, SIN llamar al modelo: toma los hallazgos del
 * último informe del Analista si es reciente y completa con las alertas por reglas.
 */
export type BriefingItem = {
  title: string;
  action: string;
  severity: 'critical' | 'warning' | 'info';
  source: 'analista' | 'reglas';
};

export const BRIEFING_REPORT_MAX_AGE_DAYS = 8;

const RANK = { critical: 0, warning: 1, opportunity: 2, info: 2 } as const;

export function buildBriefing(input: {
  report: { content: AnalystReport; created_at: string } | null;
  anomalies: Anomaly[];
  now?: Date;
  limit?: number;
}): BriefingItem[] {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 3;
  const items: BriefingItem[] = [];

  const fresh =
    input.report && now.getTime() - new Date(input.report.created_at).getTime() <= BRIEFING_REPORT_MAX_AGE_DAYS * 86_400_000;
  if (fresh && input.report) {
    [...input.report.content.findings]
      .sort((a, b) => RANK[a.severity] - RANK[b.severity])
      .forEach((f) =>
        items.push({ title: f.title, action: f.action, severity: f.severity === 'opportunity' ? 'info' : f.severity, source: 'analista' }),
      );
  }

  for (const a of [...input.anomalies].sort((x, y) => RANK[x.severity] - RANK[y.severity])) {
    if (items.length >= limit) break;
    // Si el Analista ya habló de lo mismo, no se repite.
    const topic = a.title.split(':')[0]!.toLowerCase();
    if (items.some((i) => i.title.toLowerCase().includes(topic))) continue;
    items.push({ title: a.title, action: a.detail, severity: a.severity, source: 'reglas' });
  }

  return items.slice(0, limit);
}

export function greeting(timezone: string, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
}
