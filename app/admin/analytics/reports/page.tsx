import { ArrowLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { HEALTH_BADGE, HEALTH_LABEL } from '@/components/admin/analytics/ReportView';
import { Badge, Card } from '@/components/ui/primitives';
import { ANALYSIS_RANGES } from '@/lib/services/analytics';
import { listReports } from '@/lib/services/analyst-reports';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Informes del analista' };

export default async function ReportsPage() {
  const ctx = await requirePageRole(['admin']);
  const reports = await listReports(ctx);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/admin/analytics" className="inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="size-4" /> Volver a Análisis
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Informes del analista</h1>
        <p className="text-sm text-zinc-500">Todos los informes generados quedan guardados aquí. Ábrelos para releerlos o imprimirlos.</p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-zinc-500">
            Aún no hay informes. Genera el primero desde{' '}
            <Link href="/admin/analytics" className="font-semibold text-brand-600 hover:underline">
              Análisis
            </Link>
            .
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/analytics/reports/${r.id}`}
                className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 hover:border-brand-400 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <Badge className={HEALTH_BADGE[r.content.health]}>{HEALTH_LABEL[r.content.health]}</Badge>
                    <span>{r.range_key && r.range_key in ANALYSIS_RANGES ? ANALYSIS_RANGES[r.range_key as keyof typeof ANALYSIS_RANGES].label : 'Periodo'}</span>
                    <span>· {r.period_label}</span>
                  </div>
                  <p className="font-semibold">{r.content.headline}</p>
                  <p className="text-xs text-zinc-500">
                    {r.created_label}
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-zinc-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
