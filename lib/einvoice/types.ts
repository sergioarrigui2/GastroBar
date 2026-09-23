import { z } from 'zod';
import type { EInvoiceDocType, EInvoiceProviderId } from '@/types/database';

/**
 * Contrato entre el POS y cualquier proveedor tecnológico de facturación
 * electrónica (Alegra, Siigo, …). Agregar un proveedor = implementar
 * `EInvoiceProvider` y registrarlo en `providers/index.ts`.
 */

/** Adquiriente: cliente que pide factura electrónica a su nombre. */
export const billingCustomerSchema = z.object({
  id_type: z.enum(['CC', 'NIT', 'CE', 'PP', 'TI', 'NIT_EXT']).describe('Tipo de documento de identidad'),
  id_number: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[0-9A-Za-z-]+$/, 'Sólo números, letras y guion'),
  check_digit: z.string().trim().max(1).optional().describe('Dígito de verificación (NIT)'),
  name: z.string().trim().min(2).max(160).describe('Nombre o razón social'),
  email: z.email().trim().toLowerCase().describe('Correo donde el proveedor envía la factura'),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
});
export type BillingCustomer = z.infer<typeof billingCustomerSchema>;

/** Snapshot congelado al pagarse la cuenta (lo arma private.einvoice_payload en SQL). */
export type EInvoicePayload = {
  order: { id: string; number: number; table: string | null; closed_at: string | null; guests: number | null };
  seller: { name: string; tax_id: string | null; address: string | null; phone: string | null; currency: string };
  items: Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    gross_total: number;
    line_total: number;
    tax_rate: number;
    tax_amount: number;
    comped: boolean;
    modifiers: Array<{ id: string; name: string; price_delta: number }>;
  }>;
  totals: { subtotal: number; discount: number; total: number; tax: number; base: number };
  taxes: Array<{ rate: number; base: number; amount: number }>;
  payments: Array<{ method: 'cash' | 'card' | 'transfer' | 'other'; amount: number; tip: number }>;
};

export type EInvoiceEnvironment = 'test' | 'production';

/** Documento listo para enviar al proveedor. */
export type EInvoiceRequest = {
  documentId: string;
  docType: EInvoiceDocType;
  environment: EInvoiceEnvironment;
  customer: BillingCustomer | null;
  payload: EInvoicePayload;
  /** Para notas crédito: documento original y motivo. */
  related?: { providerDocumentId: string | null; number: string | null; cufe: string | null; issuedAt: string | null };
  reason?: string | null;
};

export type EInvoiceResult =
  | {
      status: 'accepted';
      providerDocumentId: string | null;
      number: string | null;
      cufe: string | null;
      qrData: string | null;
      pdfUrl: string | null;
      xmlUrl: string | null;
      issuedAt: string;
    }
  /** El proveedor lo recibió pero la DIAN aún no responde: se consultará después. */
  | { status: 'processing'; providerDocumentId: string | null; message?: string }
  /** Rechazo definitivo (datos inválidos): no se reintenta automáticamente. */
  | { status: 'rejected'; message: string };

/** Error temporal (red, proveedor caído): el procesador reintenta con backoff. */
export class EInvoiceTransientError extends Error {
  override name = 'EInvoiceTransientError';
}

/** El conector del proveedor aún no está implementado para este entorno. */
export class EInvoiceNotConnectedError extends Error {
  override name = 'EInvoiceNotConnectedError';
}

export type EInvoiceCredentialField = {
  key: string;
  label: string;
  type: 'text' | 'password';
  help?: string;
};

export interface EInvoiceProvider<Config = unknown> {
  id: EInvoiceProviderId;
  label: string;
  description: string;
  /** false = el conector falta; los documentos quedan en cola con un error explicativo. */
  implemented: boolean;
  /** Entornos que admite (el simulador sólo "test"). */
  environments: readonly EInvoiceEnvironment[];
  credentialFields: readonly EInvoiceCredentialField[];
  configSchema: z.ZodType<Config>;
  /** Texto seguro para mostrar qué credenciales hay guardadas (sin secretos). */
  hint(config: Config): string;
  testConnection(config: Config, environment: EInvoiceEnvironment): Promise<{ ok: boolean; message: string }>;
  issue(request: EInvoiceRequest, config: Config): Promise<EInvoiceResult>;
  /** Para proveedores asíncronos: consulta el estado de un documento en "processing". */
  checkStatus?(providerDocumentId: string, request: EInvoiceRequest, config: Config): Promise<EInvoiceResult>;
}
