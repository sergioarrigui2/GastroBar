'use server';

import { after } from 'next/server';
import { FLOOR_ROLES, runAction } from '@/lib/actions';
import { enqueueBill, printSettingsFor, safely } from '@/lib/printing/enqueue';
import { scheduleEInvoiceProcessing } from '@/lib/einvoice/schedule';
import { registerPayments, voidPayment } from '@/lib/services/payments';
import type { RegisterPaymentsInput } from '@/lib/validations/payment';

export async function registerPaymentsAction(input: RegisterPaymentsInput) {
  return runAction(FLOOR_ROLES, async (ctx) => {
    const result = await registerPayments(ctx, input);
    // Si la cuenta quedó pagada, su documento electrónico ya está en cola: se envía en segundo plano.
    if (result.status === 'paid') {
      scheduleEInvoiceProcessing(ctx);
      const cash = input.payments.some((p) => p.method === 'cash');
      after(() =>
        safely('recibo', async () => {
          const { options } = await printSettingsFor(ctx);
          if (options.receipt_on_payment) await enqueueBill(ctx, result.order_id, { openDrawer: cash && options.open_drawer_on_cash });
        }),
      );
    }
    return result;
  });
}

export async function voidPaymentAction(input: { payment_id: string; reason: string }) {
  return runAction(['admin'], async (ctx) => {
    const result = await voidPayment(ctx, input);
    scheduleEInvoiceProcessing(ctx); // posible nota crédito
    return result;
  });
}
