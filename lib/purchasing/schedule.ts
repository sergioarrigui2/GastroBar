/**
 * Próxima ejecución de un agente programado, en la hora local del negocio.
 * El cron revisa cada hora qué horarios están vencidos (next_run_at <= ahora).
 */
export type AgentSchedule = {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  /** ISO: 1 = lunes … 7 = domingo. */
  weekday: number;
  day_of_month: number;
  hour: number;
  last_run_at?: string | null;
};

type Local = { y: number; m: number; d: number; h: number; min: number };

function localParts(at: Date, timezone: string): Local {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

/** Convierte una hora local del negocio a instante UTC (dos pasadas por cambios de horario). */
export function zonedToUtc(y: number, m: number, d: number, h: number, timezone: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, 0, 0);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timezone);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, 0);
    guess += Date.UTC(y, m - 1, d, h, 0, 0) - asUtc;
  }
  return new Date(guess);
}

const DAY = 86_400_000;

export function nextRunAt(s: AgentSchedule, after: Date, timezone: string): Date {
  const now = localParts(after, timezone);
  const base = Date.UTC(now.y, now.m - 1, now.d);
  const at = (offsetDays: number) => {
    const d = new Date(base + offsetDays * DAY);
    return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), s.hour, timezone);
  };

  if (s.frequency === 'daily') {
    const today = at(0);
    return today > after ? today : at(1);
  }

  if (s.frequency === 'weekly' || s.frequency === 'biweekly') {
    const dowToday = ((new Date(base).getUTCDay() + 6) % 7) + 1;
    let offset = (s.weekday - dowToday + 7) % 7;
    let candidate = at(offset);
    if (candidate <= after) {
      offset += 7;
      candidate = at(offset);
    }
    // Quincenal: al menos 13 días desde la última ejecución.
    if (s.frequency === 'biweekly' && s.last_run_at && candidate.getTime() - new Date(s.last_run_at).getTime() < 13 * DAY) {
      candidate = at(offset + 7);
    }
    return candidate;
  }

  // Mensual: el día indicado (1–28, existe en todos los meses).
  const thisMonth = zonedToUtc(now.y, now.m, s.day_of_month, s.hour, timezone);
  if (thisMonth > after) return thisMonth;
  const nm = now.m === 12 ? { y: now.y + 1, m: 1 } : { y: now.y, m: now.m + 1 };
  return zonedToUtc(nm.y, nm.m, s.day_of_month, s.hour, timezone);
}

export const FREQUENCY_LABEL: Record<AgentSchedule['frequency'], string> = {
  daily: 'Todos los días',
  weekly: 'Cada semana',
  biweekly: 'Cada 15 días',
  monthly: 'Cada mes',
};
