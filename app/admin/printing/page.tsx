import { headers } from 'next/headers';
import { PrintingManager } from '@/components/admin/printing/PrintingManager';
import { normalizeSettings } from '@/lib/printing/types';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Impresión' };
export const dynamic = 'force-dynamic';

export default async function PrintingPage() {
  const ctx = await requirePageRole(['admin']);
  const t = ctx.tenant.id;
  const [stations, printers, settings, categories, jobs] = await Promise.all([
    ctx.supabase
      .from('print_stations')
      .select('id, name, paired_at, last_seen_at, agent_version, discovered, revoked_at, pairing_expires_at, created_at')
      .eq('tenant_id', t)
      .is('revoked_at', null)
      .order('created_at'),
    ctx.supabase.from('printers').select('*').eq('tenant_id', t).order('name'),
    ctx.supabase.from('print_settings').select('routes, category_overrides, options').eq('tenant_id', t).maybeSingle(),
    ctx.supabase.from('categories').select('id, name, station').eq('tenant_id', t).order('sort_order'),
    ctx.supabase
      .from('print_jobs')
      .select('id, printer_id, document, title, status, attempts, error, created_at, printed_at')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(40),
  ]);
  for (const res of [stations, printers, settings, categories, jobs]) if (res.error) throw res.error;

  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;

  return (
    <PrintingManager
      appUrl={appUrl}
      stations={stations.data ?? []}
      printers={printers.data ?? []}
      settings={normalizeSettings(settings.data)}
      categories={categories.data ?? []}
      jobs={jobs.data ?? []}
      locale={ctx.tenant.locale}
      timezone={ctx.tenant.timezone}
    />
  );
}
