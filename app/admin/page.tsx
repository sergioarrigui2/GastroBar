import Link from 'next/link';
import { DailyBriefingCard } from '@/components/admin/ai/DailyBriefingCard';
import { MetricsDashboard } from '@/components/admin/MetricsDashboard';
import { getDailyBriefing } from '@/lib/services/ai-team';
import { getInventoryOverview } from '@/lib/services/inventory';
import { getShiftMetrics, shiftStart } from '@/lib/services/metrics';
import { getSetupStatus } from '@/lib/services/setup';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Métricas' };

const RANGES = {
  shift: { label: 'Turno actual' },
  '7d': { label: 'Últimos 7 días' },
  '30d': { label: 'Últimos 30 días' },
} as const;
type RangeKey = keyof typeof RANGES;

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requirePageRole(['admin']);
  const { range: rawRange } = await searchParams;
  const range: RangeKey = rawRange && rawRange in RANGES ? (rawRange as RangeKey) : 'shift';

  const from =
    range === 'shift'
      ? shiftStart(ctx.tenant.timezone)
      : new Date(Date.now() - (range === '7d' ? 7 : 30) * 86_400_000);

  const [metrics, inventory, setup, briefing] = await Promise.all([
    getShiftMetrics(ctx, { from: from.toISOString() }),
    getInventoryOverview(ctx),
    getSetupStatus(ctx),
    // El resumen es un extra: si falla (p. ej. faltan migraciones), la portada sigue funcionando.
    getDailyBriefing(ctx).catch((error: unknown) => {
      console.error('[briefing]', error);
      return null;
    }),
  ]);

  return (
    <>
      {!setup.complete && (
        <Link
          href="/admin/help"
          className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-brand-400/50 bg-brand-50 px-4 py-3 text-sm text-zinc-800 hover:border-brand-500 dark:bg-brand-500/10 dark:text-zinc-100"
        >
          <b>Termina de configurar tu gastrobar</b>
          <span className="text-zinc-500 dark:text-zinc-400">
            {setup.done} de {setup.total} pasos listos
          </span>
          <span className="ml-auto font-semibold text-brand-600">Abrir guía de inicio →</span>
        </Link>
      )}
      {briefing && (setup.complete || briefing.items.length > 0) && <DailyBriefingCard briefing={briefing} name={ctx.profile.full_name} />}
      <MetricsDashboard
        tenantId={ctx.tenant.id}
        currency={ctx.tenant.currency}
        locale={ctx.tenant.locale}
        timezone={ctx.tenant.timezone}
        range={range}
        ranges={Object.entries(RANGES).map(([key, v]) => ({
          key,
          label: v.label,
        }))}
        metrics={metrics}
        lowStock={inventory.ingredients
          .filter((i) => i.stock_quantity <= i.min_stock)
          .map((i) => ({
            id: i.id,
            name: i.name,
            stock: i.stock_quantity,
            min: i.min_stock,
            unit: i.unit,
          }))}
      />
    </>
  );
}
