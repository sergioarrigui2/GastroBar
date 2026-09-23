'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { FLOOR_ROLES, runAction } from '@/lib/actions';
import { decryptJson, encryptJson } from '@/lib/einvoice/crypto';
import { processEInvoiceQueue } from '@/lib/einvoice/processor';
import { scheduleEInvoiceProcessing } from '@/lib/einvoice/schedule';
import { getEInvoiceProvider } from '@/lib/einvoice/providers';
import { billingCustomerSchema } from '@/lib/einvoice/types';
import type { Json } from '@/types/database';

const ADMIN = ['admin'] as const;
const PATH = '/admin/einvoicing';

const settingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['none', 'simulator', 'alegra', 'siigo']),
  environment: z.enum(['test', 'production']),
  default_doc: z.enum(['pos', 'invoice']),
});

export async function saveEInvoiceSettingsAction(input: z.input<typeof settingsSchema>) {
  const result = await runAction(ADMIN, async (ctx) => {
    const data = settingsSchema.parse(input);
    if (data.enabled) {
      const provider = getEInvoiceProvider(data.provider);
      if (!provider) throw new Error('Elige un proveedor para activar la facturación electrónica');
      if (!provider.environments.includes(data.environment)) {
        throw new Error(`${provider.label} sólo funciona en el entorno de pruebas`);
      }
      if (provider.id !== 'simulator') {
        const { data: creds } = await ctx.supabase
          .from('einvoice_credentials')
          .select('provider')
          .eq('tenant_id', ctx.tenant.id)
          .maybeSingle();
        if (creds?.provider !== provider.id) throw new Error(`Guarda primero las credenciales de ${provider.label}`);
      }
    }
    const { error } = await ctx.supabase
      .from('tenants')
      .update({
        einvoice_enabled: data.enabled,
        einvoice_provider: data.provider,
        einvoice_environment: data.environment,
        einvoice_default_doc: data.default_doc,
      })
      .eq('id', ctx.tenant.id);
    if (error) throw error;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function saveEInvoiceCredentialsAction(providerId: string, values: Record<string, string>) {
  const result = await runAction(ADMIN, async (ctx) => {
    const provider = getEInvoiceProvider(providerId);
    if (!provider) throw new Error('Proveedor desconocido');
    const config = provider.configSchema.parse(
      Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'string' && v.trim() !== '')),
    );
    const { error } = await ctx.supabase.from('einvoice_credentials').upsert({
      tenant_id: ctx.tenant.id,
      provider: provider.id,
      encrypted_config: encryptJson(config),
      config_hint: provider.hint(config),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function testEInvoiceConnectionAction() {
  return runAction(ADMIN, async (ctx) => {
    const { data: creds } = await ctx.supabase
      .from('einvoice_credentials')
      .select('provider, encrypted_config')
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle();
    const providerId = creds?.provider ?? ctx.tenant.einvoice_provider;
    const provider = getEInvoiceProvider(providerId);
    if (!provider) throw new Error('No hay proveedor configurado');
    const config = provider.configSchema.parse(creds ? decryptJson(creds.encrypted_config) : {});
    return provider.testConnection(config, ctx.tenant.einvoice_environment);
  });
}

export async function retryEInvoiceDocumentAction(documentId: string) {
  const result = await runAction(ADMIN, async (ctx) => {
    const { error } = await ctx.supabase.rpc('retry_einvoice_document', { p_document_id: z.uuid().parse(documentId) });
    if (error) throw error;
    scheduleEInvoiceProcessing(ctx);
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function enqueueMissingEInvoicesAction(sinceHours: number) {
  const result = await runAction(ADMIN, async (ctx) => {
    const hours = z.number().int().min(1).max(24 * 60).parse(sinceHours);
    const { data, error } = await ctx.supabase.rpc('enqueue_missing_einvoices', {
      p_since: new Date(Date.now() - hours * 3_600_000).toISOString(),
    });
    if (error) throw error;
    scheduleEInvoiceProcessing(ctx);
    return data;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

/** Procesa ahora (espera el resultado) — útil para probar la conexión con documentos reales. */
export async function processEInvoiceQueueNowAction() {
  const result = await runAction(ADMIN, (ctx) => processEInvoiceQueue({ tenantId: ctx.tenant.id, limit: 50 }));
  if (result.ok) revalidatePath(PATH);
  return result;
}

/** Datos del cliente para emitir factura a su nombre (null = consumidor final / POS). */
export async function setBillingCustomerAction(orderId: string, customer: z.input<typeof billingCustomerSchema> | null) {
  return runAction(FLOOR_ROLES, async (ctx) => {
    const parsed = customer ? billingCustomerSchema.parse(customer) : null;
    const { error } = await ctx.supabase.rpc('set_billing_customer', {
      p_order_id: z.uuid().parse(orderId),
      p_customer: parsed as unknown as Json,
    });
    if (error) throw error;
  });
}

