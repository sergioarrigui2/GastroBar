'use client';

import { AlertOctagon, AlertTriangle, CheckCircle2, HelpCircle, Lightbulb, Loader2, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { generateAnalystReportAction } from '@/app/actions/analyst';
import { Badge, Button, Card } from '@/components/ui/primitives';
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

const HEALTH = {
  good: { label: 'Negocio sano', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' },
  watch: { label: 'Hay que vigilar', className: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200' },
  critical: { label: 'Requiere acción', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200' },
} as const;

const FINDING = {
  critical: { icon: AlertOctagon, className: 'text-red-600', label: 'Crítico' },
  warning: { icon: AlertTriangle, className: 'text-amber-600', label: 'Atención' },
  opportunity: { icon: Lightbulb, className: 'text-sky-600', label: 'Oportunidad' },
} as const;

export function AnalystPanel({
  range,
  rangeLabel,
  configured,
  report,
}: {
  range: '7d' | '30d' | '90d';
  rangeLabel: string;
  configured: boolean;
  report: StoredReport | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  const generate = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await generateAnalystReportAction({ range });
      if (!result.ok) return setMessage({ tone: 'error', text: result.error });
      if (result.data.cached) setMessage({ tone: 'info', text: 'No hubo cambios en los datos desde el último informe: te mostramos ese mismo.' });
      router.refresh();
    });
  };

  const unverified = new Set(
    (report?.verification?.unverified_numbers ?? []).filter((n) => n.section === 'findings').map((n) => n.index),
  );

  return (
    <Card className="space-y-4 border-brand-400/40">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="size-5 text-brand-600" aria-hidden />
        <div className="mr-auto">
          <h2 className="font-semibold">Informe del Analista IA</h2>
          <p className="text-sm text-zinc-500">
            Interpreta las cifras de abajo y te dice qué hacer. Las cifras las calcula el sistema; la IA sólo las explica.
          </p>
        </div>
        <Button onClick={generate} disabled={!configured || pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {pending ? 'Analizando…' : report ? 'Generar nuevo informe' : 'Generar informe'}
        </Button>
      </div>

      {!configured && (
        <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          Para activar el analista, el administrador de la plataforma debe configurar <code>ANTHROPIC_API_KEY</code> en el servidor.
        </p>
      )}
      {pending && (
        <p className="text-sm text-zinc-500">Revisando {rangeLabel.toLowerCase()} de ventas, menú, equipo e inventario. Suele tardar entre 20 y 40 segundos.</p>
      )}
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'rounded-xl p-3 text-sm',
            message.tone === 'error'
              ? 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200'
              : 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
          )}
        >
          {message.text}
        </p>
      )}

      {report ? (
        <article className="space-y-5">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={HEALTH[report.content.health].className}>{HEALTH[report.content.health].label}</Badge>
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
            <span>Modelo {report.model}</span>
            {report.input_tokens !== null && (
              <span>
                {report.input_tokens.toLocaleString()} + {report.output_tokens?.toLocaleString()} tokens
              </span>
            )}
            {report.duration_ms !== null && <span>{Math.round(report.duration_ms / 1000)} s</span>}
            {report.cost_usd !== null && <span>Costo USD {Number(report.cost_usd).toFixed(3)}</span>}
            <a href="/admin/ai-usage" className="font-medium text-brand-600 hover:underline">
              Ver consumo de IA
            </a>
          </footer>
        </article>
      ) : (
        configured &&
        !pending && (
          <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-400">
            Aún no hay informes para {rangeLabel.toLowerCase()}. Genera el primero: recibirás un resumen, los hallazgos ordenados por impacto
            y acciones concretas para esta semana.
          </p>
        )
      )}
    </Card>
  );
}
