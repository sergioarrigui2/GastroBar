import { ComanderoMobile } from '@/components/waiter/ComanderoMobile';
import { TerminalIdleLock } from '@/components/terminal/TerminalIdleLock';
import { getMenu } from '@/lib/services/menu';
import { hasTerminalCookie } from '@/lib/staff/terminal';
import { getTableStatus } from '@/lib/services/tables';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Comandero' };
export const dynamic = 'force-dynamic';

export default async function WaiterPage() {
  const ctx = await requirePageRole(['admin', 'cashier', 'waiter']);
  const [snapshot, menu, terminal] = await Promise.all([getTableStatus(ctx), getMenu(ctx), hasTerminalCookie()]);

  return (
    <>
    {terminal && <TerminalIdleLock />}
    <ComanderoMobile
      tenant={{
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        currency: ctx.tenant.currency,
        locale: ctx.tenant.locale,
        taxName: ctx.tenant.tax_name,
        einvoiceEnabled: ctx.tenant.einvoice_enabled,
      }}
      user={{ name: ctx.profile.full_name, role: ctx.role }}
      snapshot={snapshot}
      menu={menu}
      terminal={terminal}
    />
    </>
  );
}
