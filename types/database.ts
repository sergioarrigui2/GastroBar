/**
 * Tipos del esquema de Supabase (formato compatible con `supabase gen types typescript`).
 * Mantener sincronizado con supabase/schema.sql. Para regenerarlos automáticamente:
 *   npx supabase gen types typescript --project-id <id> --schema public > types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = 'admin' | 'cashier' | 'waiter' | 'kitchen' | 'bar' | 'ai_agent';
export type Station = 'kitchen' | 'bar';
export type OrderStatus = 'pending' | 'in_preparation' | 'ready' | 'delivered' | 'paid' | 'cancelled';
export type ItemStatus = 'pending' | 'in_preparation' | 'ready' | 'delivered' | 'cancelled';
export type TableStatus = 'free' | 'occupied' | 'reserved' | 'cleaning';
export type MeasureUnit = 'g' | 'ml' | 'unit';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other';
export type SplitType = 'full' | 'by_item' | 'equal' | 'custom';
export type MovementType = 'sale' | 'sale_reversal' | 'waste' | 'purchase' | 'adjustment';
export type OrderSource = 'pos' | 'ai_agent' | 'qr';

export type AppliedModifier = { id: string; name: string; price_delta: number };

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  locale: string;
  timezone: string;
  kds_warning_minutes: number;
  kds_late_minutes: number;
  allow_negative_stock: boolean;
  order_seq: number;
  created_at: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  receipt_footer: string | null;
  public_menu_enabled: boolean;
  tax_name: string;
  tax_rate: number;
  prices_include_tax: boolean;
};

type ProfileRow = {
  id: string;
  tenant_id: string;
  role: AppRole;
  full_name: string;
  is_active: boolean;
  created_at: string;
};

type ZoneRow = { id: string; tenant_id: string; name: string; sort_order: number; created_at: string };

type TableRow = {
  id: string;
  tenant_id: string;
  zone_id: string;
  label: string;
  seats: number;
  status: TableStatus;
  sort_order: number;
  created_at: string;
};

type CategoryRow = {
  id: string;
  tenant_id: string;
  name: string;
  station: Station;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

type ProductRow = {
  id: string;
  tenant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_active: boolean;
  track_stock: boolean;
  tax_rate: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ModifierRow = {
  id: string;
  tenant_id: string;
  category_id: string | null;
  product_id: string | null;
  name: string;
  price_delta: number;
  sort_order: number;
  is_active: boolean;
};

type IngredientRow = {
  id: string;
  tenant_id: string;
  name: string;
  unit: MeasureUnit;
  stock_quantity: number;
  min_stock: number;
  cost_per_unit: number;
  is_liquor: boolean;
  updated_at: string;
};

type SubRecipeRow = {
  id: string;
  tenant_id: string;
  name: string;
  yield_quantity: number;
  yield_unit: MeasureUnit;
  notes: string | null;
};

type SubRecipeIngredientRow = {
  id: string;
  tenant_id: string;
  sub_recipe_id: string;
  ingredient_id: string;
  quantity: number;
};

type RecipeRow = {
  id: string;
  tenant_id: string;
  product_id: string;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  quantity: number;
};

type OrderRow = {
  id: string;
  tenant_id: string;
  order_number: number;
  table_id: string | null;
  waiter_id: string | null;
  status: OrderStatus;
  source: OrderSource;
  guests: number | null;
  notes: string | null;
  subtotal: number;
  total: number;
  paid_amount: number;
  discount_type: 'percent' | 'amount' | null;
  discount_value: number;
  discount_reason: string | null;
  discount_by: string | null;
  discount_total: number;
  tax_total: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type OrderItemRow = {
  id: string;
  tenant_id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  station: Station;
  quantity: number;
  unit_price: number;
  modifier_ids: string[];
  modifiers: AppliedModifier[];
  modifiers_total: number;
  line_total: number;
  gross_total: number;
  tax_rate: number;
  tax_amount: number;
  comped: boolean;
  comp_reason: string | null;
  comped_by: string | null;
  notes: string | null;
  status: ItemStatus;
  round: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
};

type PaymentRow = {
  id: string;
  tenant_id: string;
  order_id: string;
  amount: number;
  tip: number;
  method: PaymentMethod;
  split_type: SplitType;
  split_group: string | null;
  split_label: string | null;
  reference: string | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

type PaymentAllocationRow = {
  id: string;
  tenant_id: string;
  payment_id: string;
  order_item_id: string;
  amount: number;
};

type InventoryMovementRow = {
  id: string;
  tenant_id: string;
  ingredient_id: string;
  movement_type: MovementType;
  quantity: number;
  unit_cost: number;
  order_item_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

type ApiKeyRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type CashSessionRow = {
  id: string;
  tenant_id: string;
  opened_by: string | null;
  opened_at: string;
  opening_float: number;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  notes: string | null;
  report: Json | null;
};

type CashMovementRow = {
  id: string;
  tenant_id: string;
  session_id: string;
  movement_type: 'in' | 'out';
  amount: number;
  reason: string;
  created_by: string | null;
  created_at: string;
};

type ProductAvailabilityRow = {
  product_id: string;
  tenant_id: string;
  category_id: string;
  category_name: string;
  station: Station;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  available_portions: number | null;
  is_available: boolean;
  low_stock: boolean;
};

/** tenant_id es opcional en inserts: lo rellena el trigger desde la sesión. */
type InsertOf<Row, Required extends keyof Row> = Partial<Row> & Pick<Row, Required>;
type Table<Row, Required extends keyof Row, Update = Partial<Row>> = {
  Row: Row;
  Insert: InsertOf<Row, Required>;
  Update: Update;
  Relationships: [];
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: '12' };
  public: {
    Tables: {
      tenants: Table<TenantRow, 'name' | 'slug'>;
      profiles: Table<ProfileRow, 'id' | 'tenant_id' | 'full_name'>;
      zones: Table<ZoneRow, 'name'>;
      tables: Table<TableRow, 'zone_id' | 'label'>;
      categories: Table<CategoryRow, 'name' | 'station'>;
      products: Table<ProductRow, 'category_id' | 'name' | 'price'>;
      modifiers: Table<ModifierRow, 'name'>;
      ingredients: Table<IngredientRow, 'name' | 'unit'>;
      sub_recipes: Table<SubRecipeRow, 'name' | 'yield_quantity' | 'yield_unit'>;
      sub_recipe_ingredients: Table<SubRecipeIngredientRow, 'sub_recipe_id' | 'ingredient_id' | 'quantity'>;
      recipes: Table<RecipeRow, 'product_id' | 'quantity'>;
      orders: Table<OrderRow, never>;
      order_items: Table<OrderItemRow, 'order_id' | 'product_id' | 'quantity'>;
      payments: Table<PaymentRow, 'order_id' | 'amount' | 'method'>;
      payment_allocations: Table<PaymentAllocationRow, 'payment_id' | 'order_item_id' | 'amount'>;
      inventory_movements: Table<InventoryMovementRow, 'ingredient_id' | 'movement_type' | 'quantity'>;
      api_keys: Table<ApiKeyRow, 'profile_id' | 'name' | 'key_prefix' | 'key_hash'>;
      cash_sessions: Table<CashSessionRow, never>;
      cash_movements: Table<CashMovementRow, 'session_id' | 'movement_type' | 'amount' | 'reason'>;
    };
    Views: {
      product_availability: { Row: ProductAvailabilityRow; Relationships: [] };
    };
    Functions: {
      create_tenant: {
        Args: { p_name: string; p_slug: string; p_full_name: string };
        Returns: string;
      };
      submit_order: {
        Args: { p_table_id: string | null; p_items: Json; p_notes?: string | null; p_guests?: number | null };
        Returns: Json;
      };
      register_payments: {
        Args: { p_order_id: string; p_split_type: SplitType; p_payments: Json };
        Returns: Json;
      };
      record_inventory_movement: {
        Args: {
          p_ingredient_id: string;
          p_type: MovementType;
          p_quantity: number;
          p_reason?: string | null;
          p_unit_cost?: number | null;
        };
        Returns: IngredientRow;
      };
      save_product: {
        Args: {
          p_id: string | null;
          p_category_id: string;
          p_name: string;
          p_description: string | null;
          p_price: number;
          p_is_active: boolean;
          p_track_stock: boolean;
          p_sort_order: number;
          p_recipe?: Json | null;
          p_tax_rate?: number | null;
        };
        Returns: string;
      };
      save_sub_recipe: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_yield_quantity: number;
          p_yield_unit: MeasureUnit;
          p_notes: string | null;
          p_lines: Json;
        };
        Returns: string;
      };
      open_cash_session: { Args: { p_opening_float?: number }; Returns: CashSessionRow };
      add_cash_movement: { Args: { p_type: 'in' | 'out'; p_amount: number; p_reason: string }; Returns: CashMovementRow };
      get_cash_session: { Args: { p_session_id?: string | null }; Returns: Json };
      close_cash_session: { Args: { p_counted_cash: number; p_notes?: string | null }; Returns: Json };
      get_public_menu: { Args: { p_slug: string }; Returns: Json };
      void_payment: { Args: { p_payment_id: string; p_reason: string }; Returns: Json };
      get_shift_metrics: {
        Args: { p_from?: string; p_to?: string };
        Returns: Json;
      };
    };
    Enums: {
      app_role: AppRole;
      station: Station;
      order_status: OrderStatus;
      item_status: ItemStatus;
      table_status: TableStatus;
      measure_unit: MeasureUnit;
      payment_method: PaymentMethod;
      split_type: SplitType;
      movement_type: MovementType;
      order_source: OrderSource;
    };
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type Views<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row'];
