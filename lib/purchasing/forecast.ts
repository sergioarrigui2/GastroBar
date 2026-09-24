import { holidaysBetween } from './holidays.ts';

/**
 * Motor del Comprador, sin IA: pronostica el consumo de cada insumo por día de la
 * semana (a partir de lo que realmente salió por las recetas) y calcula cuánto
 * pedir para cubrir la entrega del proveedor más el periodo elegido.
 *
 *   pedir = consumo esperado (días de entrega + días a cubrir) × (1 + % de merma)
 *         + reserva (máx. entre stock de seguridad estadístico y stock mínimo)
 *         − stock actual, redondeado a empaques completos.
 */

export type PurchaseInputIngredient = {
  id: string;
  name: string;
  unit: 'g' | 'ml' | 'unit';
  stock: number;
  min_stock: number;
  cost_per_unit: number;
  pack_size: number | null;
  pack_label: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  lead_time_days: number;
  sold: number;
  waste: number;
  first_day: string | null;
  /** Consumo por ventas por fecha local (YYYY-MM-DD); los días sin consumo no aparecen. */
  daily: Record<string, number>;
};

export type PurchaseInputs = {
  today: string;
  history_days: number;
  timezone: string;
  ingredients: PurchaseInputIngredient[];
};

export type Confidence = 'alta' | 'media' | 'baja';

export type PurchaseLine = {
  ingredient_id: string;
  name: string;
  unit: 'g' | 'ml' | 'unit';
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  stock: number;
  min_stock: number;
  avg_daily: number;
  demand: number;
  reserve: number;
  need: number;
  pack_size: number;
  pack_label: string | null;
  packs: number;
  order_qty: number;
  unit_cost: number;
  est_cost: number;
  days_left: number | null;
  urgent: boolean;
  confidence: Confidence;
  reason: string;
};

export type PurchasePlan = {
  coverage_from: string;
  coverage_to: string;
  horizon_days: number;
  lines: PurchaseLine[];
  total_estimated: number;
  notes: string[];
};

/** Nivel de servicio ~90 %: poca probabilidad de quedarse sin producto sin inflar el inventario. */
const Z_SERVICE = 1.28;
/** Las últimas 4 semanas pesan el doble: la carta y la temporada cambian. */
const RECENT_DAYS = 28;
const RECENT_WEIGHT = 2;
const MAX_WASTE_RATE = 0.3;
const UNIT_LABEL = { g: 'g', ml: 'ml', unit: 'u' } as const;

const DAY_MS = 86_400_000;
const parse = (d: string) => new Date(`${d}T12:00:00Z`);
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fmtDate(new Date(parse(d).getTime() + n * DAY_MS));
/** Día ISO: 1 = lunes … 7 = domingo. */
const isoDow = (d: string) => ((parse(d).getUTCDay() + 6) % 7) + 1;
const round = (n: number, dec = 1) => Math.round(n * 10 ** dec) / 10 ** dec;

function num(n: number, unit: 'g' | 'ml' | 'unit') {
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: unit === 'unit' ? 1 : 0 }).format(n)} ${UNIT_LABEL[unit]}`;
}

/** Perfil de consumo diario por día de la semana, ponderando lo reciente. */
export function weekdayProfile(ing: PurchaseInputIngredient, today: string, historyDays: number) {
  const windowStart = addDays(today, -historyDays);
  const start = ing.first_day && ing.first_day > windowStart ? ing.first_day : windowStart;
  const yesterday = addDays(today, -1);

  const days: Array<{ date: string; qty: number; weight: number }> = [];
  for (let d = start; d <= yesterday; d = addDays(d, 1)) {
    const age = (parse(today).getTime() - parse(d).getTime()) / DAY_MS;
    days.push({ date: d, qty: Number(ing.daily[d] ?? 0), weight: age <= RECENT_DAYS ? RECENT_WEIGHT : 1 });
  }
  if (!ing.first_day) return { observedDays: 0, mean: 0, sd: 0, byDow: new Map<number, number>() };

  const wsum = days.reduce((s, x) => s + x.weight, 0);
  const mean = wsum > 0 ? days.reduce((s, x) => s + x.qty * x.weight, 0) / wsum : 0;

  const byDow = new Map<number, number>();
  for (let dow = 1; dow <= 7; dow++) {
    const same = days.filter((x) => isoDow(x.date) === dow);
    const w = same.reduce((s, x) => s + x.weight, 0);
    byDow.set(dow, same.length > 0 && w > 0 ? same.reduce((s, x) => s + x.qty * x.weight, 0) / w : mean);
  }
  // La incertidumbre se mide contra el patrón semanal (no contra el promedio plano):
  // que el viernes venda más que el martes es esperado, no riesgo.
  const residuals = days.map((x) => x.qty - (byDow.get(isoDow(x.date)) ?? mean));
  const sd = residuals.length > 1 ? Math.sqrt(residuals.reduce((s, r) => s + r ** 2, 0) / (residuals.length - 1)) : 0;
  return { observedDays: days.length, mean, sd, byDow };
}

export function buildPurchasePlan(inputs: PurchaseInputs, horizonDays: number): PurchasePlan {
  const today = inputs.today;
  const notes: string[] = [];
  const lines: PurchaseLine[] = [];
  const maxLead = Math.max(0, ...inputs.ingredients.map((i) => i.lead_time_days ?? 1));
  const coverageTo = addDays(today, maxLead + horizonDays - 1);

  // Puentes festivos: el domingo anterior a un lunes festivo se vende como un sábado.
  // Se mira un día más allá del periodo: un lunes festivo justo después convierte el domingo en puente.
  const holidays = holidaysBetween(today, addDays(coverageTo, 1));
  const bridgeSundays = new Set(holidays.filter((h) => isoDow(h.date) === 1).map((h) => addDays(h.date, -1)));
  if (holidays.length) {
    notes.push(
      `El periodo incluye festivo(s): ${holidays.map((h) => `${h.name} (${h.date})`).join(', ')}. Los domingos de puente se proyectan como sábado.`,
    );
  }

  let noHistory = 0;
  let noSupplier = 0;
  let noPack = 0;

  for (const ing of inputs.ingredients) {
    const lead = Math.max(0, ing.lead_time_days ?? 1);
    const coverageDays = lead + horizonDays;
    const profile = weekdayProfile(ing, today, inputs.history_days);

    let demand = 0;
    for (let i = 0; i < coverageDays; i++) {
      const d = addDays(today, i);
      const dow = bridgeSundays.has(d) ? 6 : isoDow(d);
      demand += profile.byDow.get(dow) ?? profile.mean;
    }
    const wasteRate = ing.sold > 0 ? Math.min(MAX_WASTE_RATE, Math.max(0, Number(ing.waste)) / Number(ing.sold)) : 0;
    demand *= 1 + wasteRate;

    const safety = Z_SERVICE * profile.sd * Math.sqrt(coverageDays);
    const reserve = Math.max(safety, Number(ing.min_stock));
    const stock = Number(ing.stock);
    const need = demand + reserve - stock;
    if (need <= 0.0001) continue;

    const confidence: Confidence = profile.observedDays >= 28 ? 'alta' : profile.observedDays >= 7 ? 'media' : 'baja';
    if (confidence === 'baja') noHistory++;
    if (!ing.supplier_id) noSupplier++;

    let packSize = Number(ing.pack_size ?? 0);
    if (!packSize) {
      noPack++;
      // Sin empaque configurado: unidades enteras, o redondeo a 100 g/ml.
      packSize = ing.unit === 'unit' ? 1 : 100;
    }
    const packs = Math.ceil(need / packSize - 1e-9);
    const orderQty = packs * packSize;
    const unitCost = Number(ing.cost_per_unit);
    const daysLeft = profile.mean > 0 ? round(stock / profile.mean) : null;

    lines.push({
      ingredient_id: ing.id,
      name: ing.name,
      unit: ing.unit,
      supplier_id: ing.supplier_id,
      supplier_name: ing.supplier_name,
      supplier_phone: ing.supplier_phone,
      stock,
      min_stock: Number(ing.min_stock),
      avg_daily: round(profile.mean, 2),
      demand: round(demand),
      reserve: round(reserve),
      need: round(need),
      pack_size: packSize,
      pack_label: ing.pack_label,
      packs,
      order_qty: round(orderQty, 3),
      unit_cost: unitCost,
      est_cost: Math.round(orderQty * unitCost),
      days_left: daysLeft,
      urgent: daysLeft !== null && daysLeft <= lead + 1,
      confidence,
      reason:
        profile.mean > 0
          ? `Consumo esperado ${num(demand, ing.unit)} en ${coverageDays} días (${lead} de entrega + ${horizonDays} a cubrir)${wasteRate > 0 ? `, con ${Math.round(wasteRate * 100)}% de merma` : ''}; reserva ${num(reserve, ing.unit)}; tienes ${num(stock, ing.unit)}.`
          : `Sin consumo por ventas en el historial; se repone hasta el stock mínimo de ${num(Number(ing.min_stock), ing.unit)}.`,
    });
  }

  if (noHistory) notes.push(`${noHistory} insumo(s) tienen menos de una semana de ventas: su pronóstico es de baja confianza.`);
  if (noSupplier) notes.push(`${noSupplier} insumo(s) sugeridos no tienen proveedor asignado.`);
  if (noPack) notes.push(`${noPack} insumo(s) no tienen empaque configurado: se redondeó a unidades o a 100 g/ml.`);

  lines.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.supplier_name ?? '~').localeCompare(b.supplier_name ?? '~') || a.name.localeCompare(b.name));

  return {
    coverage_from: today,
    coverage_to: coverageTo,
    horizon_days: horizonDays,
    lines,
    total_estimated: lines.reduce((s, l) => s + l.est_cost, 0),
    notes,
  };
}

/** Agrupa el pedido por proveedor para enviarlo. */
export function groupBySupplier(lines: PurchaseLine[]) {
  const groups = new Map<string, { supplier_id: string | null; supplier_name: string; supplier_phone: string | null; lines: PurchaseLine[]; total: number }>();
  for (const l of lines) {
    const key = l.supplier_id ?? 'none';
    const g = groups.get(key) ?? {
      supplier_id: l.supplier_id,
      supplier_name: l.supplier_name ?? 'Sin proveedor asignado',
      supplier_phone: l.supplier_phone,
      lines: [],
      total: 0,
    };
    g.lines.push(l);
    g.total += l.est_cost;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => Number(a.supplier_id === null) - Number(b.supplier_id === null) || b.total - a.total);
}

/** Mensaje de pedido para WhatsApp: plantilla, sin IA. */
export function supplierMessage(input: { business: string; supplier: string; lines: PurchaseLine[] }): string {
  const items = input.lines.map((l) => {
    const what = l.pack_label ? `${l.packs} × ${l.pack_label}` : `${num(l.order_qty, l.unit)}`;
    return `• ${what} de ${l.name}`;
  });
  return [
    `Hola, ${input.supplier}. Te escribo de ${input.business} para hacer el siguiente pedido:`,
    '',
    ...items,
    '',
    '¿Me confirmas disponibilidad y fecha de entrega? ¡Gracias!',
  ].join('\n');
}

export function whatsappLink(phone: string | null, text: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
