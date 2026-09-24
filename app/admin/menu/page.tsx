import { AgentNotice } from '@/components/admin/ai/AgentAvatar';
import { MenuManager } from '@/components/admin/menu/MenuManager';
import { getMenuInsights } from '@/lib/services/agent-notices';
import { getCatalog } from '@/lib/services/catalog';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Menú' };

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageRole(['admin']);
  const [catalog, { tab }, menu] = await Promise.all([getCatalog(ctx), searchParams, getMenuInsights(ctx)]);
  return (
    <>
      <AgentNotice agent="ingeniero" headline="lo que veo en tu carta (30 días)" items={menu.notice} />
      <MenuManager
        tenantId={ctx.tenant.id}
        tax={{ name: ctx.tenant.tax_name, rate: ctx.tenant.tax_rate, included: ctx.tenant.prices_include_tax }}
        catalog={catalog}
        currency={ctx.tenant.currency}
        locale={ctx.tenant.locale}
        initialTab={tab === 'categories' || tab === 'modifiers' || tab === 'sub-recipes' ? tab : 'products'}
        insights={menu.insights}
      />
    </>
  );
}
