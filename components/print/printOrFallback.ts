'use client';

import type { Queued } from '@/lib/printing/enqueue';
import type { ActionResult } from '@/types/domain';

/**
 * Manda a la cola de impresión térmica; si el gastrobar aún no tiene impresora
 * configurada para ese documento, abre la impresión del navegador como antes.
 * Devuelve el mensaje para mostrar o null si se usó el navegador.
 */
export async function printOrFallback(action: () => Promise<ActionResult<Queued>>, fallbackUrl: string): Promise<string | null> {
  try {
    const result = await action();
    if (result.ok && result.data.queued) return result.data.printer ? `Enviado a la impresora ${result.data.printer}` : 'Enviado a la impresora';
  } catch {
    // sin conexión o error: imprimir desde el navegador
  }
  window.open(fallbackUrl, '_blank', 'width=420,height=720');
  return null;
}
