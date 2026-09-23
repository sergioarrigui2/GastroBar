import 'server-only';

import { after } from 'next/server';
import type { TenantContext } from '@/lib/tenant-context';
import { processEInvoiceQueue } from './processor';

/**
 * Procesa la cola del gastrobar cuando la respuesta ya se envió al usuario:
 * el cobro nunca espera al proveedor. Si la facturación está apagada, no hace nada.
 */
export function scheduleEInvoiceProcessing(ctx: TenantContext): void {
  if (!ctx.tenant.einvoice_enabled) return;
  after(async () => {
    try {
      await processEInvoiceQueue({ tenantId: ctx.tenant.id });
    } catch (error) {
      console.error('[einvoice] error procesando la cola', error);
    }
  });
}
