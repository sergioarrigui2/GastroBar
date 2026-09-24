import { AlertOctagon, AlertTriangle, CheckCircle2, HelpCircle, Lightbulb, ShieldCheck, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import type { AnalystReport, ReportVerification } from '@/lib/analyst/report';
import { cn } from '@/lib/utils';

export type StoredReport = {
  id: string;
  range_key: string | null;
  created_at: string;
  created_label: string;
  model: string;
  content: AnalystReport;
  verification: ReportVerification | null;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
};

export const HEALTH_LABEL = { good: 'Negocio sano', watch: 'Hay que vigilar', critical: 'Requiere acción' } as const;
export const HEALTH_BADGE = {
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  watch: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200',
} as const;

const FINDING = {
  critical: { icon: AlertOctagon, className: 'text-red-600', label: 'Crítico' },
  warning: { icon: AlertTriangle, className: 'text-amber-600', label: 'Atención' },
  opportunity: { icon: Lightbulb, className: 'text-sky-600', label: 'Oportunidad' },
} as const;

/** Informe del Analista (sin estado): se usa en el panel, el historial y la vista de impresión. */
export function ReportView({ report }: { report: StoredReport }) {
  const unverified = new Set(
    (report.verification?.unverified_numbers ?? []).filter((n) => n.section === 'findings').map((n) => n.index),
  );

  return (
    <article className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={HEALTH_BADGE[report.content.health]}>{HEALTH_LABEL[report.content.health]}</Badge>
          <span className="text-xs text-zinc-500">{report.created_label}</span>
        </div>
        <h3 className="text-xl font-bold text-balance">{report.content.headline}</h3>
        <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{report.content.summary}</p>
      </header>

      {report.content.highlights.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            <TrendingUp className="size-4" aria-hidden /> Lo que va bien
          </h4>
          <ul className="space-y-2">
            {report.content.highlights.map((h, i) => (
              <li key={i} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <p>
                  <b>{h.title}.</b> <span className="text-zinc-600 dark:text-zinc-400">{h.evidence}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Hallazgos y acciones</h4>
        <ol className="space-y-3">
          {report.content.findings.map((f, i) => {
            const meta = FINDING[f.severity];
            const Icon = meta.icon;
            return (
              <li key={i} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="mb-2 flex flex-wrap items-start gap-2">
                  <Icon className={cn('mt-0.5 size-5 shrink-0', meta.className)} aria-label={meta.label} />
                  <p className="mr-auto font-semibold">{f.title}</p>
                  {unverified.has(i) && (
                    <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Cifras sin verificar</Badge>
                  )}
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
                  <dt className="text-zinc-500">Datos</dt>
                  <dd>{f.evidence}</dd>
                  <dt className="text-zinc-500">Impacto</dt>
                  <dd>{f.impact}</dd>
                  <dt className="font-semibold text-brand-600">Qué hacer</dt>
                  <dd className="font-medium">{f.action}</dd>
                </dl>
              </li>
            );
          })}
        </ol>
      </section>

      {report.content.menu_actions.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Decisiones de menú</h4>
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {report.content.menu_actions.map((m, i) => (
              <li key={i} className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
                <b>{m.product}</b>
                <span>{m.action}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.content.questions.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            <HelpCircle className="size-4" aria-hidden /> Preguntas para ti
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {report.content.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
        {report.verification?.ok ? (
          <span className="flex items-center gap-1 text-emerald-600">
            <ShieldCheck className="size-3.5" aria-hidden /> Todas las cifras citadas coinciden con tus datos
          </span>
        ) : (
          <span className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="size-3.5" aria-hidden /> Algunas cifras no se pudieron verificar: contrástalas con el tablero
          </span>
        )}
      </footer>
    </article>
  );
}
