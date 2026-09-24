import Link from 'next/link';
import { AgentNotice } from '@/components/admin/ai/AgentAvatar';
import { InventoryManager } from '@/components/admin/InventoryManager';
import { getInventoryNotices } from '@/lib/services/agent-notices';
import { getInventoryOverview } from '@/lib/services/inventory';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Inventario' };

export default async function InventoryPage() {
  const ctx = await requirePageRole(['admin']);
  const [overview, notices] = await Promise.all([getInventoryOverview(ctx), getInventoryNotices(ctx)]);
  return (
    <>
      <AgentNotice
        agent="comprador"
        headline="tu pedido de compras"
        items={notices.comprador}
        action={
          <Link href="/admin/purchasing" className="text-xs font-semibold text-brand-600 hover:underline">
            Ver pedido →
          </Link>
        }
      />
      <AgentNotice agent="vigia" headline="esto no cuadra en tu inventario (30 días)" items={notices.vigia} />
      <InventoryManager tenantId={ctx.tenant.id} overview={overview} currency={ctx.tenant.currency} locale={ctx.tenant.locale} />
    </>
  );
}
