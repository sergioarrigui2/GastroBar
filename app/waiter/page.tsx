import { ComanderoMobile } from '@/components/waiter/ComanderoMobile';
import { TerminalIdleLock } from '@/components/terminal/TerminalIdleLock';
import { getMenu } from '@/lib/services/menu';
import { isPinSession } from '@/lib/staff/terminal';
import { getTableStatus } from '@/lib/services/tables';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Comandero' };
export const dynamic = 'force-dynamic';

export default async function WaiterPage() {
  const ctx = await requirePageRole(['admin', 'cashier', 'waiter', 'supervisor'], ['orders.take']);
  const [snapshot, menu, terminal] = await Promise.all([getTableStatus(ctx), getMenu(ctx), isPinSession()]);

  return (
    <>
    {terminal && <TerminalIdleLock />}
    <ComanderoMobile
      tenant={{
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        logo: ctx.tenant.logo_url,
        currency: ctx.tenant.currency,
        locale: ctx.tenant.locale,
        taxName: ctx.tenant.tax_name,
        einvoiceEnabled: ctx.tenant.einvoice_enabled,
      }}
      // Un supervisor con «tomar pedidos» ve el comandero de un mesero (sin cobros ni anulaciones).
      user={{ name: ctx.profile.full_name, avatar: ctx.profile.avatar_url, role: ctx.role === 'supervisor' ? 'waiter' : ctx.role }}
      snapshot={snapshot}
      menu={menu}
      terminal={terminal}
    />
    </>
  );
}
