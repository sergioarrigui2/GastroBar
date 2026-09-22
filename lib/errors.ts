import { z } from 'zod';
import { TenantContextError } from '@/lib/tenant-context';

/** Mensajes para las excepciones de negocio lanzadas por las funciones SQL. */
const DB_ERROR_MESSAGES: Record<string, string> = {
  insufficient_stock: 'Stock insuficiente de un insumo para preparar este pedido',
  invalid_modifier: 'Uno de los modificadores no aplica a este producto',
  product_not_found: 'Producto no encontrado',
  product_inactive: 'El producto no está disponible',
  table_not_found: 'Mesa no encontrada',
  order_not_found: 'Orden no encontrada',
  order_closed: 'La orden ya está cerrada (pagada o cancelada)',
  order_has_payments: 'No se puede cancelar una orden con pagos registrados',
  order_status_is_derived: 'El estado de la orden se calcula a partir de sus ítems',
  empty_order: 'La comanda no tiene productos',
  overpayment: 'El monto supera el saldo pendiente de la cuenta',
  item_overallocated: 'Un ítem ya fue pagado por completo',
  allocation_item_mismatch: 'El ítem asignado no pertenece a esta cuenta',
  no_payments: 'No hay pagos para registrar',
  forbidden: 'Tu rol no tiene permiso para esta operación',
  forbidden_transition: 'Tu estación no puede aplicar ese cambio de estado',
  item_status_final: 'El ítem ya fue entregado o cancelado',
  waste_reason_required: 'Indica el motivo de la merma',
  invalid_quantity: 'Cantidad inválida',
  ingredient_not_found: 'Insumo no encontrado',
  already_member: 'Tu usuario ya pertenece a un gastrobar',
  name_required: 'El nombre es obligatorio',
  sub_recipe_not_found: 'Sub-receta no encontrada',
  cash_session_already_open: 'Ya hay una caja abierta',
  cash_session_not_open: 'No hay una caja abierta',
  api_key_requires_ai_agent: 'Las claves API sólo pueden asignarse a usuarios con rol Agente IA',
};

type PgLikeError = { message?: string; code?: string; details?: string | null };

function isPgLikeError(error: unknown): error is PgLikeError {
  return typeof error === 'object' && error !== null && 'message' in error;
}

/** Convierte cualquier error (Zod, Postgres, contexto) en un mensaje apto para UI/agentes. */
export function toUserMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
  }
  if (error instanceof TenantContextError) return error.message;
  if (isPgLikeError(error)) {
    const key = (error.message ?? '').split(':')[0]?.trim() ?? '';
    const known = DB_ERROR_MESSAGES[key];
    if (known) return error.details ? `${known} (${error.details})` : known;
    if (error.code === '23505') return 'Ya existe un registro con ese nombre';
    if (error.code === '23503') {
      return 'No se puede eliminar porque está en uso (ventas, recetas o productos asociados). Desactívalo en su lugar.';
    }
    if (error.code === '23514') return 'Algún valor no cumple las reglas (cantidades y precios deben ser válidos)';
    if (error.code === '42501') return DB_ERROR_MESSAGES.forbidden!;
    if (error.message) return error.message;
  }
  return 'Error inesperado';
}
