import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EInvoiceProvider } from '../types';

const configSchema = z.object({
  /** Prefijo de numeración simulado (como el de una resolución DIAN). */
  prefix: z.string().trim().max(6).default('SIM'),
  /** Si se activa, rechaza documentos sin NIT del emisor para practicar el manejo de rechazos. */
  strict: z.boolean().default(false),
});
type SimulatorConfig = z.infer<typeof configSchema>;

/**
 * Proveedor SIMULADO para pruebas de punta a punta sin proveedor real: acepta
 * los documentos al instante y genera número, CUDE/CUFE (SHA-384, mismo formato
 * que la DIAN) y QR marcados como simulados. Sólo funciona en entorno de pruebas.
 */
export const simulatorProvider: EInvoiceProvider<SimulatorConfig> = {
  id: 'simulator',
  label: 'Simulador (pruebas)',
  description: 'Acepta documentos al instante sin enviarlos a la DIAN. Úsalo para probar el flujo completo.',
  implemented: true,
  environments: ['test'],
  credentialFields: [
    { key: 'prefix', label: 'Prefijo de numeración', type: 'text', help: 'Ej. SIM, POS, FE' },
  ],
  configSchema,
  hint: (config) => `Prefijo ${config.prefix}`,

  async testConnection() {
    return { ok: true, message: 'Simulador listo (no envía nada a la DIAN)' };
  },

  async issue(request, config) {
    if (config.strict && !request.payload.seller.tax_id) {
      return { status: 'rejected', message: 'El emisor no tiene NIT configurado (Ajustes → Datos para recibos)' };
    }
    if (request.docType === 'invoice' && !request.customer) {
      return { status: 'rejected', message: 'La factura electrónica requiere los datos del cliente' };
    }
    const cufe = createHash('sha384')
      .update(`${request.documentId}|${request.docType}|${request.payload.totals.total}`)
      .digest('hex');
    const sequence = parseInt(cufe.slice(0, 8), 16) % 1_000_000;
    const prefix = request.docType === 'credit_note' ? 'NC' : config.prefix;
    return {
      status: 'accepted',
      providerDocumentId: `sim_${request.documentId}`,
      number: `${prefix}${sequence}`,
      cufe,
      qrData: `SIMULADO|NumFac:${prefix}${sequence}|ValTot:${request.payload.totals.total}|CUFE:${cufe}`,
      pdfUrl: null,
      xmlUrl: null,
      issuedAt: new Date().toISOString(),
    };
  },
};
