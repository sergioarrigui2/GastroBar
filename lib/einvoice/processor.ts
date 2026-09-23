import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/types/database';
import { decryptJson } from './crypto';
import { getEInvoiceProvider } from './providers';
import {
  EInvoiceNotConnectedError,
  EInvoiceTransientError,
  type BillingCustomer,
  type EInvoiceEnvironment,
  type EInvoicePayload,
  type EInvoiceRequest,
  type EInvoiceResult,
} from './types';

type Doc = Tables<'einvoice_documents'>;

/** Intentos automáticos antes de dejar el documento en error para revisión manual. */
export const MAX_ATTEMPTS = 10;
/** Mientras un documento está "processing" nadie más lo toma (lease). */
const LEASE_MINUTES = 10;
/** Proveedor asíncrono: cada cuánto se consulta el estado. */
const STATUS_POLL_MINUTES = 2;
/** Conector aún no implementado: se reintenta con poca frecuencia y sin gastar intentos. */
const NOT_CONNECTED_RETRY_HOURS = 6;

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const backoffMinutes = (attempt: number) => Math.min(2 ** attempt, 360);

export type ProcessSummary = { processed: number; accepted: number; pending: number; rejected: number; failed: number };

/**
 * Envía los documentos pendientes al proveedor de cada gastrobar. Nunca lanza:
 * cada documento registra su propio resultado. Usa service role (corre fuera
 * de la sesión del usuario: después del cobro, en el cron o bajo demanda).
 */
export async function processEInvoiceQueue(options: { tenantId?: string; limit?: number } = {}): Promise<ProcessSummary> {
  const summary: ProcessSummary = { processed: 0, accepted: 0, pending: 0, rejected: 0, failed: 0 };
  const admin = createSupabaseAdminClient();

  let query = admin
    .from('einvoice_documents')
    .select('*')
    .in('status', ['pending', 'error', 'processing'])
    .lte('next_attempt_at', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(options.limit ?? 25);
  if (options.tenantId) query = query.eq('tenant_id', options.tenantId);

  const { data: due, error } = await query;
  if (error) {
    console.error('[einvoice] no se pudo leer la cola', error.message);
    return summary;
  }

  const tenantCache = new Map<string, Promise<TenantSetup | null>>();

  for (const doc of due) {
    // Reclamo optimista: si otro proceso ya lo tomó, se salta.
    const { data: claimed } = await admin
      .from('einvoice_documents')
      .update({ status: 'processing', attempts: doc.attempts + 1, next_attempt_at: minutesFromNow(LEASE_MINUTES) })
      .eq('id', doc.id)
      .eq('status', doc.status)
      .eq('updated_at', doc.updated_at)
      .select('*')
      .maybeSingle();
    if (!claimed) continue;

    summary.processed += 1;
    if (!tenantCache.has(doc.tenant_id)) tenantCache.set(doc.tenant_id, loadTenantSetup(admin, doc.tenant_id));
    const outcome = await processOne(admin, claimed, await tenantCache.get(doc.tenant_id)!);
    summary[outcome] += 1;
  }
  return summary;
}

type TenantSetup = {
  enabled: boolean;
  config: unknown;
  credentialsProvider: string | null;
  credentialsError: string | null;
};

async function loadTenantSetup(admin: ReturnType<typeof createSupabaseAdminClient>, tenantId: string): Promise<TenantSetup | null> {
  const [{ data: tenant }, { data: creds }] = await Promise.all([
    admin.from('tenants').select('einvoice_enabled').eq('id', tenantId).maybeSingle(),
    admin.from('einvoice_credentials').select('provider, encrypted_config').eq('tenant_id', tenantId).maybeSingle(),
  ]);
  if (!tenant) return null;
  let config: unknown = {};
  let credentialsError: string | null = null;
  if (creds) {
    try {
      config = decryptJson(creds.encrypted_config);
    } catch (e) {
      credentialsError = `No se pudieron descifrar las credenciales: ${e instanceof Error ? e.message : 'error'}`;
    }
  }
  return { enabled: tenant.einvoice_enabled, config, credentialsProvider: creds?.provider ?? null, credentialsError };
}

async function processOne(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  doc: Doc,
  setup: TenantSetup | null,
): Promise<keyof Omit<ProcessSummary, 'processed'>> {
  const fail = async (message: string, retryInMinutes: number | null, countAttempt = true) => {
    await admin
      .from('einvoice_documents')
      .update({
        status: 'error',
        last_error: message.slice(0, 1000),
        attempts: countAttempt ? doc.attempts : doc.attempts - 1,
        next_attempt_at: minutesFromNow(retryInMinutes ?? 60 * 24 * 365),
      })
      .eq('id', doc.id);
    return 'failed' as const;
  };

  if (!setup) return fail('Gastrobar no encontrado', null);
  if (!setup.enabled) {
    // Facturación desactivada después de encolar: se conserva en cola sin enviar.
    await admin
      .from('einvoice_documents')
      .update({ status: 'pending', attempts: doc.attempts - 1, next_attempt_at: minutesFromNow(60), last_error: 'Facturación electrónica desactivada' })
      .eq('id', doc.id);
    return 'pending';
  }

  const provider = getEInvoiceProvider(doc.provider);
  if (!provider) return fail(`Proveedor desconocido: ${doc.provider}`, null);
  if (!provider.environments.includes(doc.environment as EInvoiceEnvironment)) {
    return fail(`${provider.label} no admite el entorno "${doc.environment}"`, null);
  }
  if (setup.credentialsError) return fail(setup.credentialsError, null);
  if (setup.credentialsProvider && setup.credentialsProvider !== doc.provider) {
    return fail(`Las credenciales guardadas son de ${setup.credentialsProvider}, no de ${provider.label}`, null);
  }

  const parsedConfig = provider.configSchema.safeParse(setup.credentialsProvider === doc.provider ? setup.config : {});
  if (!parsedConfig.success) {
    return fail(`Faltan o son inválidas las credenciales de ${provider.label}`, null, false);
  }

  let related: EInvoiceRequest['related'];
  if (doc.doc_type === 'credit_note' && doc.related_document_id) {
    const { data: original } = await admin
      .from('einvoice_documents')
      .select('provider_document_id, number, cufe, issued_at')
      .eq('id', doc.related_document_id)
      .maybeSingle();
    related = original
      ? { providerDocumentId: original.provider_document_id, number: original.number, cufe: original.cufe, issuedAt: original.issued_at }
      : undefined;
  }

  const request: EInvoiceRequest = {
    documentId: doc.id,
    docType: doc.doc_type,
    environment: doc.environment as EInvoiceEnvironment,
    customer: (doc.customer as BillingCustomer | null) ?? null,
    payload: doc.payload as unknown as EInvoicePayload,
    related,
    reason: doc.reason,
  };

  let result: EInvoiceResult;
  try {
    result =
      doc.provider_document_id && provider.checkStatus
        ? await provider.checkStatus(doc.provider_document_id, request, parsedConfig.data)
        : await provider.issue(request, parsedConfig.data);
  } catch (e) {
    if (e instanceof EInvoiceNotConnectedError) return fail(e.message, NOT_CONNECTED_RETRY_HOURS * 60, false);
    const message = e instanceof Error ? e.message : 'Error desconocido del proveedor';
    const transient = e instanceof EInvoiceTransientError || !(e instanceof Error) || /fetch|network|timeout|ECONN|5\d\d/i.test(message);
    return fail(message, transient ? backoffMinutes(doc.attempts) : backoffMinutes(doc.attempts) * 2);
  }

  if (result.status === 'accepted') {
    await admin
      .from('einvoice_documents')
      .update({
        status: 'accepted',
        last_error: null,
        provider_document_id: result.providerDocumentId,
        number: result.number,
        cufe: result.cufe,
        qr_data: result.qrData,
        pdf_url: result.pdfUrl,
        xml_url: result.xmlUrl,
        issued_at: result.issuedAt,
      })
      .eq('id', doc.id);
    return 'accepted';
  }
  if (result.status === 'processing') {
    await admin
      .from('einvoice_documents')
      .update({
        status: 'processing',
        provider_document_id: result.providerDocumentId,
        last_error: result.message ?? 'En validación por la DIAN',
        attempts: doc.attempts - 1,
        next_attempt_at: minutesFromNow(STATUS_POLL_MINUTES),
      })
      .eq('id', doc.id);
    return 'pending';
  }
  await admin
    .from('einvoice_documents')
    .update({ status: 'rejected', last_error: result.message.slice(0, 1000) })
    .eq('id', doc.id);
  return 'rejected';
}
