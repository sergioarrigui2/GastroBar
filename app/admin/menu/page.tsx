import { MenuManager } from '@/components/admin/menu/MenuManager';
import { getCatalog } from '@/lib/services/catalog';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Menú' };

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageRole(['admin']);
  const [catalog, { tab }] = await Promise.all([getCatalog(ctx), searchParams]);
  return (
    <MenuManager
      tenantId={ctx.tenant.id}
      catalog={catalog}
      currency={ctx.tenant.currency}
      locale={ctx.tenant.locale}
      initialTab={tab === 'categories' || tab === 'modifiers' || tab === 'sub-recipes' ? tab : 'products'}
    />
  );
}
