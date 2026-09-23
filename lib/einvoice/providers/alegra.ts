import { z } from 'zod';
import { maskSecret } from '../crypto';
import { EInvoiceNotConnectedError, type EInvoiceProvider } from '../types';

const configSchema = z.object({
  /** Token de la API de proveedor electrónico de Alegra (e-provider-docs.alegra.com). */
  api_token: z.string().trim().min(10, 'Token inválido'),
  /** Identificador de la empresa (emisor) registrada en Alegra para este gastrobar. */
  company_id: z.string().trim().min(1, 'Indica el ID de la empresa en Alegra'),
});
type AlegraConfig = z.infer<typeof configSchema>;

/**
 * Conector Alegra — API "Proveedor electrónico" (multiempresa, soporta factura,
 * documento equivalente POS y notas crédito según su documentación).
 *
 * PENDIENTE DE CONEXIÓN: `issue` y `testConnection` se implementan con las
 * credenciales del sandbox de Alegra. Mientras tanto los documentos quedan en
 * cola con este mensaje y NO bloquean la operación del POS.
 */
export const alegraProvider: EInvoiceProvider<AlegraConfig> = {
  id: 'alegra',
  label: 'Alegra',
  description: 'API de proveedor electrónico de Alegra (multiempresa, POS electrónico, notas crédito).',
  implemented: false,
  environments: ['test', 'production'],
  credentialFields: [
    { key: 'api_token', label: 'Token de API', type: 'password', help: 'Lo entrega Alegra al habilitar la API de proveedor electrónico' },
    { key: 'company_id', label: 'ID de la empresa en Alegra', type: 'text' },
  ],
  configSchema,
  hint: (config) => `Empresa ${config.company_id} · token ${maskSecret(config.api_token)}`,

  async testConnection() {
    return { ok: false, message: 'El conector de Alegra está pendiente: se implementa con las credenciales del sandbox.' };
  },

  async issue() {
    throw new EInvoiceNotConnectedError(
      'Conector de Alegra pendiente de implementación. El documento queda en cola y se enviará cuando se conecte.',
    );
  },
};
