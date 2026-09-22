import { MetricsDashboard } from '@/components/admin/MetricsDashboard';
import { getInventoryOverview } from '@/lib/services/inventory';
import { getShiftMetrics, shiftStart } from '@/lib/services/metrics';
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

  const [metrics, inventory] = await Promise.all([
    getShiftMetrics(ctx, { from: from.toISOString() }),
    getInventoryOverview(ctx),
  ]);

  return (
    <MetricsDashboard
      tenantId={ctx.tenant.id}
      currency={ctx.tenant.currency}
      locale={ctx.tenant.locale}
      timezone={ctx.tenant.timezone}
      range={range}
      ranges={Object.entries(RANGES).map(([key, v]) => ({ key, label: v.label }))}
      metrics={metrics}
      lowStock={inventory.ingredients
        .filter((i) => i.stock_quantity <= i.min_stock)
        .map((i) => ({ id: i.id, name: i.name, stock: i.stock_quantity, min: i.min_stock, unit: i.unit }))}
    />
  );
}
