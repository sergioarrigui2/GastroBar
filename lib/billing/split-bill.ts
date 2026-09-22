/**
 * Motor puro de división de cuentas (sin dependencias: lo usan la UI, las
 * Server Actions y las AI tools). Todo el cálculo se hace en unidades mínimas
 * enteras (centavos, o pesos en monedas sin decimales) para no perder ni un
 * peso por redondeo: la suma de las partes SIEMPRE es igual al total.
 */

export type BillLine = {
  id: string;
  name: string;
  lineTotal: number;
  /** Monto ya pagado de esta línea en pagos por ítem anteriores. */
  allocated: number;
};

export type SplitShare = {
  label: string;
  amount: number;
  allocations: Array<{ order_item_id: string; amount: number }>;
};

const ZERO_DECIMAL = new Set(['COP', 'CLP', 'PYG', 'JPY', 'KRW']);

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

const factor = (decimals: number) => 10 ** decimals;
export const toMinor = (amount: number, decimals = 2) => Math.round(amount * factor(decimals));
export const fromMinor = (minor: number, decimals = 2) => minor / factor(decimals);

/** Reparte `minor` en `parts` enteros que suman exactamente `minor` (los primeros absorben el residuo). */
function distributeMinor(minor: number, parts: number): number[] {
  const base = Math.floor(minor / parts);
  const remainder = minor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** División en partes iguales. */
export function splitEqually(amount: number, parts: number, decimals = 2): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('parts debe ser un entero >= 1');
  if (amount < 0) throw new RangeError('amount no puede ser negativo');
  return distributeMinor(toMinor(amount, decimals), parts).map((m) => fromMinor(m, decimals));
}

export function buildEqualShares(amount: number, parts: number, decimals = 2): SplitShare[] {
  return splitEqually(amount, parts, decimals).map((value, i) => ({
    label: `Parte ${i + 1}`,
    amount: value,
    allocations: [],
  }));
}

/** itemId -> índices de comensales que comparten ese ítem. */
export type ItemAssignments = Record<string, number[]>;

export type ItemSplitResult = {
  shares: SplitShare[];
  /** Saldo de líneas sin asignar a nadie. */
  unassigned: number;
};

/**
 * División por ítem: cada línea pendiente se asigna a uno o varios comensales;
 * si se comparte, su saldo se reparte en partes iguales entre ellos.
 */
export function splitByItems(
  lines: BillLine[],
  assignments: ItemAssignments,
  guestLabels: string[],
  decimals = 2,
): ItemSplitResult {
  const totals = guestLabels.map(() => 0);
  const allocations: SplitShare['allocations'][] = guestLabels.map(() => []);
  let unassignedMinor = 0;

  for (const line of lines) {
    const pendingMinor = toMinor(line.lineTotal, decimals) - toMinor(line.allocated, decimals);
    if (pendingMinor <= 0) continue;

    const guests = [...new Set(assignments[line.id] ?? [])].filter((g) => g >= 0 && g < guestLabels.length);
    if (guests.length === 0) {
      unassignedMinor += pendingMinor;
      continue;
    }

    const parts = distributeMinor(pendingMinor, guests.length);
    guests.forEach((guest, i) => {
      const part = parts[i] ?? 0;
      if (part <= 0) return;
      totals[guest] = (totals[guest] ?? 0) + part;
      allocations[guest]?.push({ order_item_id: line.id, amount: fromMinor(part, decimals) });
    });
  }

  return {
    shares: guestLabels.map((label, i) => ({
      label,
      amount: fromMinor(totals[i] ?? 0, decimals),
      allocations: allocations[i] ?? [],
    })),
    unassigned: fromMinor(unassignedMinor, decimals),
  };
}

export type CustomSplitCheck = {
  assigned: number;
  difference: number; // > 0 falta por asignar, < 0 excede
  valid: boolean;
};

/** Montos personalizados: válidos si todos son > 0 y no exceden el saldo. */
export function checkCustomSplit(amounts: number[], remaining: number, decimals = 2): CustomSplitCheck {
  const assignedMinor = amounts.reduce((sum, a) => sum + toMinor(a, decimals), 0);
  const diffMinor = toMinor(remaining, decimals) - assignedMinor;
  return {
    assigned: fromMinor(assignedMinor, decimals),
    difference: fromMinor(diffMinor, decimals),
    valid: amounts.length > 0 && amounts.every((a) => a > 0) && diffMinor >= 0,
  };
}

/** Saldo pendiente de la cuenta. */
export function remainingBalance(total: number, paid: number, decimals = 2): number {
  return fromMinor(Math.max(0, toMinor(total, decimals) - toMinor(paid, decimals)), decimals);
}

/** Propina sugerida redondeada a la unidad mínima de la moneda. */
export function suggestedTip(amount: number, percent: number, decimals = 2): number {
  return fromMinor(Math.round((toMinor(amount, decimals) * percent) / 100), decimals);
}
