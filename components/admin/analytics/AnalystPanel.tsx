'use client';

import { ChevronDown, ChevronUp, History, Loader2, Printer, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { generateAnalystReportAction } from '@/app/actions/analyst';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { HEALTH_BADGE, HEALTH_LABEL, ReportView, type StoredReport } from './ReportView';

export type { StoredReport } from './ReportView';

const CLOSED_KEY = 'gastrobar-analyst-closed';
const linkBtn =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800';

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
  // Abierto por defecto; si el usuario cierra un informe, se recuerda en este navegador
  // hasta que haya uno nuevo.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!report) return;
    try {
      setOpen(localStorage.getItem(CLOSED_KEY) !== report.id);
    } catch {
      setOpen(true);
    }
  }, [report?.id]);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      if (next) localStorage.removeItem(CLOSED_KEY);
      else if (report) localStorage.setItem(CLOSED_KEY, report.id);
    } catch {
      // Sin almacenamiento: el estado dura mientras la página esté abierta.
    }
  };

  const generate = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await generateAnalystReportAction({ range });
      if (!result.ok) return setMessage({ tone: 'error', text: result.error });
      if (result.data.cached) setMessage({ tone: 'info', text: 'No hubo cambios en los datos desde el último informe: te mostramos ese mismo.' });
      router.refresh();
    });
  };


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
        <Link href="/admin/analytics/reports" className={linkBtn}>
          <History className="size-4" /> Historial
        </Link>
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
        open ? (
          <>
            <ReportView report={report} />
            <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <Button variant="secondary" onClick={() => toggle(false)}>
                <ChevronUp className="size-4" /> Cerrar informe
              </Button>
              <Link href={`/admin/analytics/reports/${report.id}`} className={linkBtn}>
                <Printer className="size-4" /> Ver para imprimir
              </Link>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => toggle(true)}
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-50 p-3 text-left hover:bg-zinc-100 dark:bg-zinc-800/40 dark:hover:bg-zinc-800"
          >
            <Badge className={HEALTH_BADGE[report.content.health]}>{HEALTH_LABEL[report.content.health]}</Badge>
            <span className="min-w-0 flex-1 font-semibold">{report.content.headline}</span>
            <span className="flex items-center gap-1 text-sm font-medium text-brand-600">
              <ChevronDown className="size-4" /> Ver informe
            </span>
            <span className="w-full text-xs text-zinc-500">{report.created_label}</span>
          </button>
        )
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
