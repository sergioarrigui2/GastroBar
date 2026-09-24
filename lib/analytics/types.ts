/** Forma exacta del JSON que devuelve `get_business_snapshot` (migración 006). */

export type SnapshotKpis = {
  revenue: number;
  net_revenue: number;
  orders: number;
  avg_ticket: number;
  guests: number;
  items_sold: number;
  tips: number;
  tax: number;
  discounts: number;
  comps: number;
  ingredient_cost: number;
  waste_cost: number;
  shrinkage_cost: number;
  voided_payments: number;
  cancelled_items: number;
  cancelled_value: number;
};

export type SnapshotProduct = {
  product_id: string;
  name: string;
  category: string | null;
  station: 'kitchen' | 'bar';
  quantity: number;
  comped_quantity: number;
  revenue: number;
  net_revenue: number;
  cost: number;
  comped_cost: number;
};

export type SnapshotStaff = {
  profile_id: string | null;
  name: string;
  role: string | null;
  orders: number;
  revenue: number;
  avg_ticket: number;
  discounts: number;
  discounted_orders: number;
  comps: number;
  voided_payments: number;
};

export type SnapshotStation = {
  station: 'kitchen' | 'bar';
  items: number;
  avg_minutes: number;
  p90_minutes: number;
  pct_warning: number;
  pct_late: number;
};

export type SnapshotIngredientUsage = {
  ingredient_id: string;
  name: string;
  unit: 'g' | 'ml' | 'unit';
  sold: number;
  waste: number;
  shrinkage: number;
  purchased: number;
  cost: number;
};

export type RawBusinessSnapshot = {
  period: {
    from: string;
    to: string;
    previous_from: string;
    previous_to: string;
    days: number;
    timezone: string;
    currency: string;
    kds_warning_minutes: number;
    kds_late_minutes: number;
  };
  kpis: SnapshotKpis;
  previous_kpis: SnapshotKpis;
  daily: Array<{ date: string; orders: number; revenue: number }>;
  /** dow ISO: 1 = lunes … 7 = domingo; `days` = cuántos de ese día hubo en el periodo. */
  weekdays: Array<{ dow: number; days: number; orders: number; revenue: number }>;
  heatmap: Array<{ dow: number; hour: number; orders: number; revenue: number }>;
  products: SnapshotProduct[];
  unsold_products: Array<{ product_id: string; name: string }>;
  categories: Array<{ name: string; quantity: number; revenue: number }>;
  staff: SnapshotStaff[];
  stations: SnapshotStation[];
  table_minutes: number | null;
  payments: Partial<Record<'cash' | 'card' | 'transfer' | 'other', number>>;
  channels: Partial<Record<'pos' | 'ai_agent' | 'qr', { orders: number; revenue: number }>>;
  cash: {
    sessions: number;
    total_difference: number;
    differences: Array<{ closed_at: string; difference: number; closed_by: string | null }>;
  };
  inventory: {
    stock_value: number;
    low_stock: Array<{ name: string; unit: 'g' | 'ml' | 'unit'; stock: number; min: number }>;
    usage: SnapshotIngredientUsage[];
  };
};

/** Cuadrantes de ingeniería de menú (Kasavana & Smith). */
export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';

export type AnalyzedProduct = SnapshotProduct & {
  /** Margen de contribución total (venta sin impuesto − costo de insumos). */
  margin: number;
  unit_margin: number;
  food_cost_pct: number | null;
  mix_pct: number;
  class: MenuClass;
};

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export type Anomaly = {
  /** Clave estable para enlazar hallazgos del LLM con la evidencia. */
  id: string;
  kind:
    | 'revenue_drop'
    | 'food_cost_high'
    | 'product_food_cost'
    | 'shrinkage'
    | 'waste'
    | 'cash_difference'
    | 'staff_discounts'
    | 'staff_voids'
    | 'station_delays'
    | 'low_stock'
    | 'unusual_day';
  severity: AnomalySeverity;
  title: string;
  detail: string;
  value: number;
  baseline?: number;
};

export type KpiChange = { current: number; previous: number; change_pct: number | null };

export type BusinessAnalysis = {
  snapshot: RawBusinessSnapshot;
  changes: Record<keyof SnapshotKpis, KpiChange>;
  ratios: {
    food_cost_pct: number | null;
    prev_food_cost_pct: number | null;
    discount_pct: number | null;
    comp_pct: number | null;
    revenue_per_guest: number | null;
    avg_daily_revenue: number;
  };
  menu: {
    products: AnalyzedProduct[];
    popularity_threshold_pct: number;
    avg_unit_margin: number;
  };
  weekdays: Array<{ dow: number; label: string; avg_revenue: number; avg_orders: number; days: number }>;
  peak_hours: Array<{ dow: number; hour: number; label: string; revenue: number; orders: number }>;
  anomalies: Anomaly[];
};
