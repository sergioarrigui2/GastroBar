/**
 * Convierte un evento de la auditoría en una frase legible. Es un módulo puro (sin base de datos ni
 * servidor) para usarlo en la pantalla, en la exportación y en las pruebas. Los detalles que guarda la
 * base (migración 027) son datos crudos: aquí se les da lenguaje, dinero con el formato del negocio, etc.
 */
import type { AuditCategory, AuditSeverity } from '@/types/database';

export type AuditEntry = {
  id?: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  category: AuditCategory;
  severity: AuditSeverity;
  entity?: string | null;
  entity_id?: string | null;
  details: Record<string, unknown>;
};
type Money = (n: number) => string;
/** Nombres legibles de los permisos (la pantalla los pasa desde lib/permissions; este módulo no importa nada en tiempo de ejecución). */
export type DescribeOptions = { permissionLabels?: Record<string, string> };

export const SEVERITY_LABEL: Record<AuditSeverity, string> = { info: 'Normal', important: 'Importante', critical: 'Crítico' };
export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  ventas: 'Ventas',
  caja: 'Caja',
  inventario: 'Inventario',
  menu: 'Menú',
  compras: 'Compras',
  personal: 'Personal',
  ajustes: 'Ajustes',
  seguridad: 'Seguridad',
};
export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  cashier: 'Caja',
  waiter: 'Mesero',
  kitchen: 'Cocina',
  bar: 'Barra',
  ai_agent: 'Agente IA',
};
const METHOD: Record<string, string> = { cash: 'efectivo', card: 'tarjeta', transfer: 'transferencia', other: 'otro medio' };
const ITEM_STATUS: Record<string, string> = { pending: 'pendiente', in_preparation: 'en preparación', ready: 'lista', delivered: 'entregada' };
const SETTING_LABEL: Record<string, string> = {
  name: 'nombre del negocio',
  timezone: 'zona horaria',
  currency: 'moneda',
  tax_name: 'nombre del impuesto',
  tax_rate: 'tarifa del impuesto',
  prices_include_tax: 'precios con impuesto incluido',
  allow_negative_stock: 'vender sin stock suficiente',
  public_menu_enabled: 'menú QR público',
  uses_kitchen_screen: 'pantalla de cocina',
  uses_bar_screen: 'pantalla de barra',
  einvoice_enabled: 'facturación electrónica',
  einvoice_provider: 'proveedor de facturación',
  einvoice_environment: 'ambiente de facturación',
};

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const q = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(n);
const qty = (n: unknown, unit: unknown) => `${q(num(n))} ${unit === 'unit' ? 'u' : str(unit)}`;
const order = (d: Record<string, unknown>) => `#${str(d.order_number)}${d.table ? ` (${str(d.table)})` : ''}`;
const because = (reason: unknown) => (str(reason).trim() ? ` — «${str(reason).trim()}»` : '');
const flag = (v: unknown) => (v === true ? 'sí' : v === false ? 'no' : str(v));
const roleName = (r: unknown) => ROLE_LABEL[str(r)] ?? str(r);

function items(list: unknown): string {
  if (!Array.isArray(list)) return '';
  return list.map((i: { name?: string; qty?: number }) => `${i.qty ?? 1}× ${i.name ?? '?'}`).join(', ');
}

export function describeAudit(e: Pick<AuditEntry, 'action' | 'details'>, money: Money, opts: DescribeOptions = {}): string {
  const d = (e.details ?? {}) as Record<string, unknown>;
  switch (e.action) {
    // Ventas
    case 'order.opened':
      return `Abrió la cuenta ${order(d)}`;
    case 'order.round_sent':
      return `Envió la ronda ${str(d.round)} de la cuenta ${order(d)}: ${items(d.items) || 'sin detalle'}`;
    case 'order.cancelled':
      return `Anuló la cuenta ${order(d)} por ${money(num(d.total))}${num(d.paid) > 0 ? ` (tenía ${money(num(d.paid))} cobrados)` : ''}${because(d.reason)}`;
    case 'order.deleted':
      return `Eliminó la cuenta #${str(d.order_number)} (${money(num(d.total))}, estado «${str(d.status)}»)`;
    case 'order.table_moved':
      return `Pasó la cuenta #${str(d.order_number)} de ${str(d.from)} a ${str(d.to)}`;
    case 'order.discount_applied':
      return `Dio un descuento de ${d.type === 'percent' ? `${num(d.value)} %` : money(num(d.value))} a la cuenta ${order(d)} (${money(num(d.discount_total))} sobre ${money(num(d.subtotal))})${because(d.reason)}`;
    case 'order.discount_removed':
      return `Quitó el descuento de la cuenta ${order(d)}`;
    case 'order.items_moved':
      return `Movió productos de la cuenta #${str(d.from_order)} a la #${str(d.to_order)}`;
    case 'item.removed':
      return `Quitó ${num(d.quantity)}× ${str(d.product)} (${money(num(d.amount))}) de la cuenta ${order(d)}; estaba ${ITEM_STATUS[str(d.status_before)] ?? str(d.status_before)}${because(d.reason)}`;
    case 'item.comped':
      return `Dio de cortesía ${num(d.quantity)}× ${str(d.product)} (${money(num(d.amount))}) en la cuenta #${str(d.order_number)}${because(d.reason)}`;
    case 'item.comp_removed':
      return `Quitó la cortesía de ${str(d.product)} en la cuenta #${str(d.order_number)}`;
    case 'payment.registered':
      return `Cobró ${money(num(d.amount))} en ${METHOD[str(d.method)] ?? str(d.method)} a la cuenta #${str(d.order_number)}${num(d.tip) > 0 ? ` (propina ${money(num(d.tip))})` : ''}${d.split_label ? ` · ${str(d.split_label)}` : ''}`;
    case 'payment.voided':
      return `Anuló un pago de ${money(num(d.amount))} en ${METHOD[str(d.method)] ?? str(d.method)} de la cuenta #${str(d.order_number)}${because(d.reason)}`;
    case 'payment.deleted':
      return `Eliminó un pago de ${money(num(d.amount))} (${METHOD[str(d.method)] ?? str(d.method)})`;
    // Caja
    case 'cash.opened':
      return `Abrió la caja con ${money(num(d.opening_float))}`;
    case 'cash.movement':
      return `${d.type === 'out' ? 'Sacó' : 'Metió'} ${money(num(d.amount))} de la caja${because(d.reason)}`;
    case 'cash.closed': {
      const diff = num(d.difference);
      return diff === 0
        ? `Cerró la caja: contó ${money(num(d.counted_cash))} y cuadró`
        : `Cerró la caja: contó ${money(num(d.counted_cash))} y esperaba ${money(num(d.expected_cash))} → ${diff > 0 ? 'sobran' : 'faltan'} ${money(Math.abs(diff))}${because(d.notes)}`;
    }
    // Inventario
    case 'inventory.purchase':
      return `Registró la compra de ${qty(d.quantity, d.unit)} de ${str(d.ingredient)} por ${money(num(d.value))}${because(d.reason)}`;
    case 'inventory.waste':
      return `Registró una merma de ${qty(Math.abs(num(d.quantity)), d.unit)} de ${str(d.ingredient)} (${money(num(d.value))})${because(d.reason)}`;
    case 'inventory.adjustment':
      return `Ajustó ${str(d.ingredient)}: ${num(d.quantity) > 0 ? '+' : ''}${qty(d.quantity, d.unit)} (${money(num(d.value))}); quedó en ${qty(d.stock_after, d.unit)}${because(d.reason)}`;
    case 'ingredient.cost_changed':
      return `Cambió a mano el costo de ${str(d.name)}: de ${q(num(d.from))} a ${q(num(d.to))} por ${str(d.unit) === 'unit' ? 'unidad' : str(d.unit)}`;
    case 'ingredient.unit_changed':
      return `Cambió la unidad de ${str(d.name)} de ${str(d.from)} a ${str(d.to)} (stock ${q(num(d.stock_from))} → ${q(num(d.stock_to))})`;
    case 'ingredient.min_changed':
      return `Cambió el stock mínimo de ${str(d.name)}: ${q(num(d.from))} → ${q(num(d.to))} ${str(d.unit) === 'unit' ? 'u' : str(d.unit)}`;
    case 'ingredient.created':
      return `Creó el insumo ${str(d.name)} (${str(d.unit)})`;
    case 'ingredient.deleted':
      return `Eliminó el insumo ${str(d.name)} (tenía ${qty(d.stock, d.unit)})`;
    // Menú
    case 'product.price_changed':
      return `Cambió el precio de ${str(d.name)}: ${money(num(d.from))} → ${money(num(d.to))}`;
    case 'product.created':
      return `Creó el producto ${str(d.name)} a ${money(num(d.price))}`;
    case 'product.deleted':
      return `Eliminó el producto ${str(d.name)}`;
    case 'product.activated':
      return `Activó el producto ${str(d.name)}`;
    case 'product.deactivated':
      return `Desactivó el producto ${str(d.name)}`;
    case 'product.tax_changed':
      return `Cambió el impuesto de ${str(d.name)}: ${d.from === null ? 'el del negocio' : `${num(d.from)} %`} → ${d.to === null ? 'el del negocio' : `${num(d.to)} %`}`;
    case 'recipe.changed':
      return `Modificó la receta de ${str(d.product)}`;
    // Compras
    case 'supplier.created':
      return `Creó el proveedor ${str(d.name)}`;
    case 'supplier.deleted':
      return `Eliminó el proveedor ${str(d.name)}`;
    case 'supplier.activated':
      return `Reactivó el proveedor ${str(d.name)}`;
    case 'supplier.deactivated':
      return `Desactivó el proveedor ${str(d.name)}`;
    case 'purchase.received':
      return `Recibió un pedido de compras (${str(d.lines)} insumos, estimado ${money(num(d.total_estimated))})`;
    case 'purchase.discarded':
      return `Descartó un pedido de compras (${str(d.lines)} insumos)`;
    // Personal
    case 'staff.created':
      return `Agregó a ${str(d.name)} como ${roleName(d.role)}`;
    case 'staff.role_changed':
      return `Cambió el rol de ${str(d.name)}: ${roleName(d.from)} → ${roleName(d.to)}`;
    case 'staff.permissions_changed': {
      const to = Array.isArray(d.to) ? (d.to as string[]) : [];
      return `Cambió los permisos de ${str(d.name)}: ${to.length ? to.map((p) => opts.permissionLabels?.[p] ?? p).join(', ') : 'ninguno'}`;
    }
    case 'staff.activated':
      return `Reactivó a ${str(d.name)}`;
    case 'staff.deactivated':
      return `Dio de baja a ${str(d.name)}`;
    case 'staff.deleted':
      return `Eliminó el usuario de ${str(d.name)}`;
    case 'staff.pin_set':
      return `Asignó un PIN nuevo a ${str(d.name)}`;
    // Ajustes y seguridad
    case 'settings.changed': {
      const ch = (d.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const list = Object.entries(ch).map(([k, v]) => `${SETTING_LABEL[k] ?? k}: ${flag(v.from)} → ${flag(v.to)}`);
      return `Cambió los ajustes del negocio — ${list.join('; ')}`;
    }
    case 'apikey.created':
      return `Creó la clave de acceso «${str(d.name)}»`;
    case 'apikey.revoked':
      return `Revocó la clave de acceso «${str(d.name)}»`;
    case 'terminal.paired':
      return `Autorizó la tablet «${str(d.name)}» como terminal`;
    case 'terminal.revoked':
      return `Revocó la tablet «${str(d.name)}»`;
    case 'ai.connected':
      return `Conectó el asistente de IA «${str(d.client)}» (sólo lectura)`;
    case 'ai.disconnected':
      return `Desconectó el asistente de IA «${str(d.client)}»`;
    case 'auth.pin_login':
      return 'Entró con su PIN';
    case 'auth.pin_failed':
      return `PIN incorrecto al intentar entrar como ${str(d.name)}`;
    case 'auth.pin_locked':
      return `El PIN de ${str(d.name)} se bloqueó por intentos fallidos`;
    default:
      return e.action;
  }
}

/** Quién lo hizo, listo para mostrar. */
export function actorLabel(e: Pick<AuditEntry, 'actor_name' | 'actor_role'>): { name: string; role: string | null } {
  return e.actor_name ? { name: e.actor_name, role: e.actor_role ? roleName(e.actor_role) : null } : { name: 'El sistema', role: null };
}

/** Columnas de la tabla «acciones sensibles por persona»: qué acciones cuentan en cada una. */
export const SENSITIVE_COLUMNS: Array<{ key: string; label: string; actions: string[] }> = [
  { key: 'voids', label: 'Anulaciones', actions: ['order.cancelled', 'item.removed', 'order.deleted'] },
  { key: 'discounts', label: 'Descuentos y cortesías', actions: ['order.discount_applied', 'item.comped'] },
  { key: 'payments', label: 'Pagos anulados', actions: ['payment.voided', 'payment.deleted'] },
  { key: 'cash', label: 'Caja con diferencia o movimientos', actions: ['cash.closed', 'cash.movement'] },
  { key: 'stock', label: 'Ajustes y mermas', actions: ['inventory.adjustment', 'inventory.waste'] },
  { key: 'menu', label: 'Precios y recetas', actions: ['product.price_changed', 'recipe.changed', 'ingredient.cost_changed'] },
];

export type ActorTotals = { actor_id: string | null; name: string; role: string | null; counts: Record<string, number> };

/** Pivota el resumen de la base (por persona y acción) en una fila por persona. */
export function summarizeByActor(rows: Array<{ actor_id: string | null; name: string | null; role: string | null; action: string; n: number }>): ActorTotals[] {
  const byActor = new Map<string, ActorTotals>();
  for (const r of rows) {
    const key = r.actor_id ?? 'system';
    const cur = byActor.get(key) ?? { actor_id: r.actor_id, name: r.name ?? 'El sistema', role: r.role ? roleName(r.role) : null, counts: {} };
    for (const col of SENSITIVE_COLUMNS) if (col.actions.includes(r.action)) cur.counts[col.key] = (cur.counts[col.key] ?? 0) + Number(r.n);
    byActor.set(key, cur);
  }
  return [...byActor.values()]
    .filter((a) => Object.values(a.counts).some((n) => n > 0))
    .sort((a, b) => Object.values(b.counts).reduce((s, n) => s + n, 0) - Object.values(a.counts).reduce((s, n) => s + n, 0));
}
