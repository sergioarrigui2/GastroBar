/**
 * Documento de impresión que la app arma y el programa GastroBar Print convierte a
 * ESC/POS (o texto) al ancho de cada impresora. Mantener en sincronía con
 * public/descargas/gastrobar-print.mjs (función layout).
 */
export type PrintBlock =
  | { t: 'text'; text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; big?: boolean }
  | { t: 'row'; left: string; right: string; bold?: boolean }
  | { t: 'rule'; char?: '-' | '=' }
  | { t: 'feed'; lines?: number };

export type PrintDoc = { blocks: PrintBlock[] };

export const PRINT_DOCUMENTS = ['kitchen_order', 'bar_order', 'prebill', 'receipt', 'cash_report'] as const;
export type PrintDocumentKind = (typeof PRINT_DOCUMENTS)[number];

export const PRINT_DOCUMENT_LABELS: Record<PrintDocumentKind, { label: string; when: string }> = {
  kitchen_order: { label: 'Comanda de cocina', when: 'al enviar el pedido' },
  bar_order: { label: 'Comanda de barra', when: 'al enviar el pedido' },
  prebill: { label: 'Precuenta', when: 'al pedirla, desde cualquier equipo' },
  receipt: { label: 'Recibo de pago', when: 'al cobrar la cuenta completa' },
  cash_report: { label: 'Cierre de caja (X / Z)', when: 'al cerrar la caja o pedir el corte' },
};

export type PrintOptions = {
  order_copies: number;
  large_notes: boolean;
  prices_on_order: boolean;
  open_drawer_on_cash: boolean;
  receipt_on_payment: boolean;
  cash_report_on_close: boolean;
};

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  order_copies: 1,
  large_notes: true,
  prices_on_order: false,
  open_drawer_on_cash: true,
  receipt_on_payment: true,
  cash_report_on_close: true,
};

export type PrintSettings = {
  /** Documento → impresora (null o ausente = no se imprime automáticamente). */
  routes: Partial<Record<PrintDocumentKind, string | null>>;
  /** Categoría → impresora o 'none' (no imprimir comanda). Sin entrada = según su estación. */
  category_overrides: Record<string, string>;
  options: PrintOptions;
};

export const PRINTER_PROFILES = [
  { id: 'generic', label: 'Genérica ESC/POS', codepage: 'cp850' },
  { id: 'epson', label: 'Epson', codepage: 'cp850' },
  { id: 'bixolon', label: 'Bixolon', codepage: 'cp850' },
  { id: 'xprinter', label: 'Xprinter', codepage: 'cp850' },
  { id: 'sat', label: 'SAT', codepage: 'cp850' },
  { id: '3nstar', label: '3nStar', codepage: 'cp850' },
  { id: 'digitalpos', label: 'Digital POS', codepage: 'cp850' },
  { id: 'star', label: 'Star (modo ESC/POS)', codepage: 'cp1252' },
] as const;

export function normalizeSettings(row: { routes?: unknown; category_overrides?: unknown; options?: unknown } | null): PrintSettings {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  return {
    routes: obj(row?.routes) as PrintSettings['routes'],
    category_overrides: obj(row?.category_overrides) as Record<string, string>,
    options: { ...DEFAULT_PRINT_OPTIONS, ...(obj(row?.options) as Partial<PrintOptions>) },
  };
}

/**
 * Reparte los ítems de una ronda entre impresoras: excepción de su categoría si la
 * hay ('none' = no se imprime); si no, la impresora de su estación.
 */
export function routeOrderItems<T extends { station: 'kitchen' | 'bar'; category_id: string | null }>(
  items: T[],
  settings: PrintSettings,
): Map<string, T[]> {
  const byPrinter = new Map<string, T[]>();
  for (const item of items) {
    const override = item.category_id ? settings.category_overrides[item.category_id] : undefined;
    const printerId =
      override === 'none' ? null : (override ?? settings.routes[item.station === 'bar' ? 'bar_order' : 'kitchen_order'] ?? null);
    if (!printerId) continue;
    byPrinter.set(printerId, [...(byPrinter.get(printerId) ?? []), item]);
  }
  return byPrinter;
}
