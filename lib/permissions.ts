/**
 * Permisos del rol «supervisor» (migración 026). Se usan en la interfaz para mostrar u ocultar
 * pantallas y en las Server Actions como segunda barrera; la barrera real está en la base de datos
 * (private.has_permission). El administrador siempre lo tiene todo.
 *
 * Importante: esta lista debe coincidir con el CHECK profiles_permissions_valid del esquema.
 */
export const PERMISSIONS = [
  'orders.take',
  'inventory.view',
  'inventory.receive',
  'inventory.count',
  'inventory.waste',
  'suppliers.manage',
  'purchasing.use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_INFO: Record<Permission, { label: string; hint: string }> = {
  'orders.take': { label: 'Tomar pedidos', hint: 'Apoya en sala con el comandero. No cobra, no anula ni da descuentos.' },
  'inventory.view': { label: 'Ver el inventario', hint: 'Existencias y costo de cada insumo. No ve el valor total.' },
  'inventory.receive': { label: 'Recibir mercancía', hint: 'Registra las compras que llegan y su costo.' },
  'inventory.count': { label: 'Contar y ajustar el inventario', hint: 'Conteos físicos; cada ajuste queda a su nombre y en la auditoría.' },
  'inventory.waste': { label: 'Registrar mermas', hint: 'Producto vencido, derramado o dañado, con su motivo.' },
  'suppliers.manage': { label: 'Gestionar proveedores', hint: 'Crear y editar proveedores. No maneja pagos: eso no existe en GastroBar.' },
  'purchasing.use': { label: 'Usar el Comprador', hint: 'Pedidos sugeridos y datos de compra de cada insumo (proveedor, empaque, mínimo).' },
};

/** Lo que recibe un supervisor nuevo si el administrador no cambia nada. */
export const SUPERVISOR_PRESET: Permission[] = [...PERMISSIONS];

type Who = { role: string; permissions?: readonly string[] | null };

export const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

/** Administrador: todo. Supervisor: sólo lo de su lista. Cualquier otro rol: nada extra. */
export function can(who: Who, permission: Permission): boolean {
  if (who.role === 'admin') return true;
  return who.role === 'supervisor' && Boolean(who.permissions?.includes(permission));
}

export function canAny(who: Who, ...permissions: Permission[]): boolean {
  return permissions.some((p) => can(who, p));
}

/** Pantalla de inicio de un supervisor según lo que se le dio (null = nada que mostrar). */
export function supervisorHome(who: Who): string | null {
  if (can(who, 'purchasing.use') || can(who, 'suppliers.manage')) return '/admin/purchasing';
  if (canAny(who, 'inventory.view', 'inventory.receive', 'inventory.count', 'inventory.waste')) return '/admin/inventory';
  if (can(who, 'orders.take')) return '/waiter';
  return null;
}
