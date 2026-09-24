import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ReportView } from '@/components/admin/analytics/ReportView';
import { PrintButton } from '@/components/admin/PrintButton';
import { Card } from '@/components/ui/primitives';
import { getReport } from '@/lib/services/analyst-reports';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Informe del analista' };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageRole(['admin']);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const report = await getReport(ctx, id.data);
  if (!report) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link
          href="/admin/analytics/reports"
          className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="size-4" /> Todos los informes
        </Link>
        <PrintButton label="Imprimir o guardar PDF" />
      </div>
      <div>
        <p className="text-sm font-semibold text-brand-600">
          {ctx.tenant.name} · Informe del analista
        </p>
        <p className="text-sm text-zinc-500">Periodo analizado: {report.period_label}</p>
      </div>
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <ReportView report={report} />
      </Card>
    </div>
  );
}
