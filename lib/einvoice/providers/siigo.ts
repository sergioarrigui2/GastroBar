import { z } from 'zod';
import { maskSecret } from '../crypto';
import { EInvoiceNotConnectedError, type EInvoiceProvider } from '../types';

const configSchema = z.object({
  /** "Usuario API" de Siigo Nube (Configuración → Alianzas e integraciones → Credenciales de integración). */
  username: z.string().trim().min(3, 'Usuario API inválido'),
  /** "Access Key" generada en el mismo lugar. */
  access_key: z.string().trim().min(10, 'Access Key inválida'),
  /** ID del tipo de documento de facturación configurado en Siigo Nube. */
  document_type_id: z.string().trim().min(1, 'Indica el tipo de documento de Siigo'),
});
type SiigoConfig = z.infer<typeof configSchema>;

/**
 * Conector Siigo — API de Siigo Nube (cada gastrobar usa su propia cuenta).
 *
 * PENDIENTE DE CONEXIÓN: `issue` y `testConnection` se implementan con
 * credenciales reales de Siigo. Mientras tanto los documentos quedan en cola con
 * este mensaje y NO bloquean la operación del POS.
 */
export const siigoProvider: EInvoiceProvider<SiigoConfig> = {
  id: 'siigo',
  label: 'Siigo',
  description: 'API de Siigo Nube. Requiere una cuenta de Siigo Nube por gastrobar y sus credenciales de integración.',
  implemented: false,
  environments: ['test', 'production'],
  credentialFields: [
    { key: 'username', label: 'Usuario API', type: 'text', help: 'Siigo Nube → Configuración → Credenciales de integración' },
    { key: 'access_key', label: 'Access Key', type: 'password' },
    { key: 'document_type_id', label: 'ID del tipo de documento', type: 'text', help: 'Documento de facturación configurado en Siigo' },
  ],
  configSchema,
  hint: (config) => `Usuario ${config.username} · clave ${maskSecret(config.access_key)}`,

  async testConnection() {
    return { ok: false, message: 'El conector de Siigo está pendiente: se implementa con credenciales de integración reales.' };
  },

  async issue() {
    throw new EInvoiceNotConnectedError(
      'Conector de Siigo pendiente de implementación. El documento queda en cola y se enviará cuando se conecte.',
    );
  },
};
