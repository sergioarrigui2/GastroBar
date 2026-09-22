import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();
const ZERO_DECIMAL_CURRENCIES = new Set(['COP', 'CLP', 'PYG', 'JPY']);

export function formatCurrency(amount: number, currency = 'COP', locale = 'es-CO'): string {
  const key = `${locale}:${currency}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    const digits = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter.format(amount);
}

/**
 * Fecha/hora en la zona del gastrobar. Normaliza los espacios especiales (U+00A0,
 * U+202F) que cada versión de ICU usa distinto en "p. m.": así el HTML del servidor
 * (Node) y el del navegador coinciden y no hay errores de hidratación.
 */
export function formatDateTime(
  value: string | number | Date,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(value)).replace(/[\u00a0\u202f]/g, ' ');
}

/** Costos por g / ml / unidad: conservan hasta 2 decimales aunque la moneda no los use. */
export function formatUnitCost(amount: number, currency = 'COP', locale = 'es-CO'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

export function formatQuantity(value: number, unit: 'g' | 'ml' | 'unit'): string {
  if (unit === 'unit') return `${Math.round(value * 100) / 100} u`;
  if (Math.abs(value) >= 1000) {
    const big = (value / 1000).toLocaleString('es-CO', { maximumFractionDigits: 2 });
    return `${big} ${unit === 'g' ? 'kg' : 'L'}`;
  }
  return `${value.toLocaleString('es-CO', { maximumFractionDigits: 1 })} ${unit}`;
}

/** Minutos transcurridos desde una fecha ISO. */
export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/** "m:ss" o "Xh Ym" para cronómetros de KDS. */
export function formatElapsed(iso: string, now: number = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`;
}
