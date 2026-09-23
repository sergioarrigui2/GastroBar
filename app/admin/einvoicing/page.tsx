import { EInvoicingManager } from '@/components/admin/EInvoicingManager';
import { listEInvoiceProviders } from '@/lib/einvoice/providers';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Facturación electrónica' };

export default async function EInvoicingPage() {
  const ctx = await requirePageRole(['admin']);
  const { supabase, tenant } = ctx;

  const [credsRes, docsRes] = await Promise.all([
    supabase.from('einvoice_credentials').select('provider, config_hint, updated_at').eq('tenant_id', tenant.id).maybeSingle(),
    supabase
      .from('einvoice_documents')
      .select('id, order_id, doc_type, status, provider, environment, customer, payload, attempts, last_error, number, cufe, pdf_url, issued_at, created_at, related_document_id')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(150),
  ]);
  if (docsRes.error) throw docsRes.error;

  const orderIds = [...new Set(docsRes.data.map((d) => d.order_id))];
  const ordersRes = orderIds.length
    ? await supabase.from('orders').select('id, order_number').eq('tenant_id', tenant.id).in('id', orderIds)
    : { data: [] as Array<{ id: string; order_number: number }> };
  const orderNumbers = new Map((ordersRes.data ?? []).map((o) => [o.id, o.order_number]));

  return (
    <EInvoicingManager
      tenant={{
        id: tenant.id,
        currency: tenant.currency,
        locale: tenant.locale,
        timezone: tenant.timezone,
        taxId: tenant.tax_id,
        enabled: tenant.einvoice_enabled,
        provider: tenant.einvoice_provider,
        environment: tenant.einvoice_environment,
        defaultDoc: tenant.einvoice_default_doc,
      }}
      credentials={credsRes.data ?? null}
      encryptionKeyConfigured={Boolean(process.env.EINVOICE_ENCRYPTION_KEY && process.env.EINVOICE_ENCRYPTION_KEY.length >= 16)}
      providers={listEInvoiceProviders()}
      documents={docsRes.data.map((d) => ({
        id: d.id,
        orderNumber: orderNumbers.get(d.order_id) ?? null,
        docType: d.doc_type,
        status: d.status,
        provider: d.provider,
        environment: d.environment,
        customerName: (d.customer as { name?: string } | null)?.name ?? null,
        total: (d.payload as { totals?: { total?: number } }).totals?.total ?? 0,
        attempts: d.attempts,
        lastError: d.last_error,
        number: d.number,
        cufe: d.cufe,
        pdfUrl: d.pdf_url,
        issuedAt: d.issued_at,
        createdAt: d.created_at,
        isCreditNoteFor: d.related_document_id,
      }))}
    />
  );
}
