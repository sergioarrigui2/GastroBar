import 'server-only';

import { toUserMessage } from '@/lib/errors';
import type { Permission } from '@/lib/permissions';
import { assertRole, getTenantContext, type TenantContext } from '@/lib/tenant-context';
import type { ActionResult, AppRole } from '@/types/domain';

/** Envoltorio común de Server Actions: contexto de tenant, control de rol y errores serializables. */
/**
 * `permissions`: si el rol «supervisor» está entre los permitidos, necesita al menos uno de estos permisos
 * (sin ellos se le niega: ver assertRole).
 */
export async function runAction<T>(
  allowed: readonly AppRole[],
  fn: (ctx: TenantContext) => Promise<T>,
  permissions?: readonly Permission[],
): Promise<ActionResult<T>> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, allowed, permissions);
    return { ok: true, data: await fn(ctx) };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('[action]', error);
    return { ok: false, error: toUserMessage(error) };
  }
}

export const FLOOR_ROLES = ['admin', 'cashier', 'waiter'] as const satisfies readonly AppRole[];
/** Sala con el apoyo del supervisor (sólo si tiene «tomar pedidos»): pedidos y traslados, nunca cobros. */
export const SERVE_ROLES = ['admin', 'cashier', 'waiter', 'supervisor'] as const satisfies readonly AppRole[];
export const SERVE_PERMISSIONS = ['orders.take'] as const satisfies readonly Permission[];
export const KDS_ROLES = ['admin', 'kitchen', 'bar'] as const satisfies readonly AppRole[];
