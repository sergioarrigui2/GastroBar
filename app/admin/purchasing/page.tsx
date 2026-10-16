import { AgentLocked } from '@/components/admin/ai/AgentLocked';
import { PurchasingManager } from '@/components/admin/purchasing/PurchasingManager';
import { getAgentAccess } from '@/lib/ai/entitlements';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import { getPurchasingOverview } from '@/lib/services/purchasing';
import { can } from '@/lib/permissions';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Comprador' };

export default async function PurchasingPage() {
  const ctx = await requirePageRole(['admin', 'supervisor'], ['purchasing.use', 'suppliers.manage']);
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
      caps={{
        plan: can(ctx.profile, 'purchasing.use'),
        receive: can(ctx.profile, 'purchasing.use') && can(ctx.profile, 'inventory.receive'),
        suppliers: can(ctx.profile, 'suppliers.manage'),
        packs: can(ctx.profile, 'purchasing.use'),
        schedule: ctx.role === 'admin',
        ai: ctx.role === 'admin',
      }}
      {...data}
    />
  );
}
