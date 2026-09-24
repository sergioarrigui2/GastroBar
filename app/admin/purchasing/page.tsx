import { AgentLocked } from '@/components/admin/ai/AgentLocked';
import { PurchasingManager } from '@/components/admin/purchasing/PurchasingManager';
import { getAgentAccess } from '@/lib/ai/entitlements';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import { getPurchasingOverview } from '@/lib/services/purchasing';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Comprador' };

export default async function PurchasingPage() {
  const ctx = await requirePageRole(['admin']);
  const access = await getAgentAccess(ctx);
  if (!access.comprador.active) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">Comprador</h1>
        <AgentLocked agent="comprador" hint="Con el Comprador, tu pedido de compras sale listo según lo que vas a vender, con festivos, mermas y el tiempo de entrega de cada proveedor." />
      </div>
    );
  }
  const data = await getPurchasingOverview(ctx);
  return (
    <PurchasingManager
      tenant={{ name: ctx.tenant.name, currency: ctx.tenant.currency, locale: ctx.tenant.locale, timezone: ctx.tenant.timezone }}
      aiAvailable={isAnalystConfigured()}
      {...data}
    />
  );
}
