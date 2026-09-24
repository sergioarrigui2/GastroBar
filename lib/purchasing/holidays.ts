/**
 * Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani"). Varios se trasladan al
 * lunes siguiente y crean "puentes", que en un gastrobar mueven mucho el consumo.
 * Fechas en formato YYYY-MM-DD (calendario local, sin zona horaria).
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** Traslada al lunes siguiente (si ya es lunes, se queda). */
function nextMonday(d: Date): Date {
  const dow = d.getUTCDay(); // 0 = domingo
  return dow === 1 ? d : addDays(d, (8 - dow) % 7);
}

export type Holiday = { date: string; name: string };

export function colombianHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const list: Array<[Date, string]> = [
    [utc(year, 1, 1), 'Año Nuevo'],
    [nextMonday(utc(year, 1, 6)), 'Reyes Magos'],
    [nextMonday(utc(year, 3, 19)), 'San José'],
    [addDays(easter, -3), 'Jueves Santo'],
    [addDays(easter, -2), 'Viernes Santo'],
    [utc(year, 5, 1), 'Día del Trabajo'],
    [addDays(easter, 43), 'Ascensión del Señor'],
    [addDays(easter, 64), 'Corpus Christi'],
    [addDays(easter, 71), 'Sagrado Corazón'],
    [nextMonday(utc(year, 6, 29)), 'San Pedro y San Pablo'],
    [utc(year, 7, 20), 'Día de la Independencia'],
    [utc(year, 8, 7), 'Batalla de Boyacá'],
    [nextMonday(utc(year, 8, 15)), 'Asunción de la Virgen'],
    [nextMonday(utc(year, 10, 12)), 'Día de la Raza'],
    [nextMonday(utc(year, 11, 1)), 'Todos los Santos'],
    [nextMonday(utc(year, 11, 11)), 'Independencia de Cartagena'],
    [utc(year, 12, 8), 'Inmaculada Concepción'],
    [utc(year, 12, 25), 'Navidad'],
  ];
  return list.map(([d, name]) => ({ date: iso(d), name })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Festivos entre dos fechas locales (inclusive). */
export function holidaysBetween(from: string, to: string): Holiday[] {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  return [...years].flatMap(colombianHolidays).filter((h) => h.date >= from && h.date <= to);
}
