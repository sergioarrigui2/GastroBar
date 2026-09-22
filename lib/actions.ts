import 'server-only';

import { toUserMessage } from '@/lib/errors';
import { assertRole, getTenantContext, type TenantContext } from '@/lib/tenant-context';
import type { ActionResult, AppRole } from '@/types/domain';

/** Envoltorio común de Server Actions: contexto de tenant, control de rol y errores serializables. */
export async function runAction<T>(
  allowed: readonly AppRole[],
  fn: (ctx: TenantContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, allowed);
    return { ok: true, data: await fn(ctx) };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('[action]', error);
    return { ok: false, error: toUserMessage(error) };
  }
}

export const FLOOR_ROLES = ['admin', 'cashier', 'waiter'] as const satisfies readonly AppRole[];
export const KDS_ROLES = ['admin', 'kitchen', 'bar'] as const satisfies readonly AppRole[];
