import type { EInvoiceProviderId } from '@/types/database';
import type { EInvoiceProvider } from '../types';
import { alegraProvider } from './alegra';
import { siigoProvider } from './siigo';
import { simulatorProvider } from './simulator';

/** Registro de proveedores. Para agregar uno nuevo: implementar EInvoiceProvider y sumarlo aquí. */
export const einvoiceProviders = {
  simulator: simulatorProvider,
  alegra: alegraProvider,
  siigo: siigoProvider,
} satisfies Record<EInvoiceProviderId, { id: EInvoiceProviderId }>;

export function getEInvoiceProvider(id: string): EInvoiceProvider<unknown> | null {
  return (einvoiceProviders as Record<string, EInvoiceProvider<unknown>>)[id] ?? null;
}

/** Datos públicos (sin funciones) para la pantalla de configuración. */
export function listEInvoiceProviders() {
  return Object.values(einvoiceProviders).map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    implemented: p.implemented,
    environments: [...p.environments],
    credentialFields: [...p.credentialFields],
  }));
}
export type EInvoiceProviderInfo = ReturnType<typeof listEInvoiceProviders>[number];
