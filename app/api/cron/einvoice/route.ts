import { NextResponse } from 'next/server';
import { processEInvoiceQueue } from '@/lib/einvoice/processor';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/einvoice — reintenta la cola de facturación electrónica.
 * Vercel Cron envía `Authorization: Bearer <CRON_SECRET>` (ver vercel.json).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const summary = await processEInvoiceQueue({ limit: 200 });
  return NextResponse.json(summary);
}
