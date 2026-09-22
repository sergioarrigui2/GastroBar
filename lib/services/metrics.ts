import 'server-only';

import type { TenantContext } from '@/lib/tenant-context';
import type { ShiftMetrics } from '@/types/domain';

/** Inicio del día operativo en la zona horaria del tenant (06:00 local cubre turnos de madrugada). */
export function shiftStart(timezone: string, now = new Date(), dayStartHour = 6): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  // Diferencia entre la hora "de pared" local y UTC para esta fecha.
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = localAsUtc - now.getTime();

  const startLocal = Date.UTC(get('year'), get('month') - 1, get('day'), dayStartHour, 0, 0);
  let start = startLocal - offsetMs;
  if (get('hour') < dayStartHour) start -= 24 * 3_600_000;
  return new Date(start);
}

export async function getShiftMetrics(
  ctx: TenantContext,
  range: { from?: string; to?: string } = {},
): Promise<ShiftMetrics> {
  const from = range.from ?? shiftStart(ctx.tenant.timezone).toISOString();
  const to = range.to ?? new Date().toISOString();

  const { data, error } = await ctx.supabase.rpc('get_shift_metrics', { p_from: from, p_to: to });
  if (error) throw error;
  return data as unknown as ShiftMetrics;
}
