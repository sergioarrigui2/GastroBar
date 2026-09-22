import type {
  AppRole,
  ItemStatus,
  OrderStatus,
  PaymentMethod,
  SplitType,
  Station,
  TableStatus,
  Tables,
  Views,
} from './database';

export type Tenant = Tables<'tenants'>;
export type Profile = Tables<'profiles'>;
export type Zone = Tables<'zones'>;
export type DiningTable = Tables<'tables'>;
export type Category = Tables<'categories'>;
export type Modifier = Tables<'modifiers'>;
export type Ingredient = Tables<'ingredients'>;
export type Order = Tables<'orders'>;
export type OrderItem = Tables<'order_items'>;
export type Payment = Tables<'payments'>;
export type InventoryMovement = Tables<'inventory_movements'>;
export type MenuProduct = Views<'product_availability'>;

export type { AppRole, ItemStatus, OrderStatus, PaymentMethod, SplitType, Station, TableStatus };

/** Resultado de la RPC submit_order. */
export type SubmitOrderResult = {
  order_id: string;
  order_number: number;
  round: number;
  status: OrderStatus;
  total: number;
  table_id: string | null;
};

/** Resultado de la RPC register_payments. */
export type RegisterPaymentsResult = {
  order_id: string;
  status: OrderStatus;
  total: number;
  paid_amount: number;
  remaining: number;
  split_group: string;
};

/** Resultado de la RPC get_shift_metrics. */
export type ShiftMetrics = {
  from: string;
  to: string;
  revenue: number;
  tips: number;
  orders_closed: number;
  avg_ticket: number;
  items_sold: number;
  discounts: number;
  comps: number;
  tax_collected: number;
  voided_payments: number;
  open_orders: number;
  open_orders_value: number;
  occupied_tables: number;
  total_tables: number;
  ingredient_cost: number;
  waste_cost: number;
  payments_by_method: Partial<Record<PaymentMethod, number>>;
  sales_by_station: Partial<Record<Station, number>>;
  avg_prep_minutes: Partial<Record<Station, number>>;
  top_products: Array<{
    product_id: string;
    product_name: string;
    station: Station;
    quantity: number;
    revenue: number;
  }>;
  hourly_revenue: Array<{ hour: string; revenue: number }>;
};

/** Orden abierta de una mesa con sus ítems y lo ya asignado en pagos por ítem. */
export type TableBill = {
  order: Order;
  items: Array<OrderItem & { allocated: number }>;
  payments: Payment[];
};

/** Ticket del KDS: una ronda de una orden, sólo con los ítems de una estación. */
export type KdsTicket = {
  key: string;
  orderId: string;
  orderNumber: number;
  round: number;
  tableLabel: string | null;
  source: Order['source'];
  orderNotes: string | null;
  createdAt: string;
  items: OrderItem[];
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
