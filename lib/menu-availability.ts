/**
 * Política de stock negativo: cuando el negocio permite vender sin inventario (Ajustes → «Permitir stock negativo»),
 * un producto activo siempre se puede pedir aunque sus insumos estén en cero; el stock queda negativo hasta que ingresen
 * la compra. Las porciones y el aviso de poco stock se conservan, sólo se levanta el bloqueo de «Agotado».
 */
export function withStockPolicy<T extends { is_available: boolean }>(products: T[], allowNegativeStock: boolean): T[] {
  return allowNegativeStock ? products.map((p) => (p.is_available ? p : { ...p, is_available: true })) : products;
}
