import { PurchasingManager } from '@/components/admin/purchasing/PurchasingManager';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import { getPurchasingOverview } from '@/lib/services/purchasing';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Comprador' };

export default async function PurchasingPage() {
  const ctx = await requirePageRole(['admin']);
  const data = await getPurchasingOverview(ctx);
  return (
    <PurchasingManager
      tenant={{ name: ctx.tenant.name, currency: ctx.tenant.currency, locale: ctx.tenant.locale, timezone: ctx.tenant.timezone }}
      aiAvailable={isAnalystConfigured()}
      {...data}
    />
  );
}
