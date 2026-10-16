import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { can, canAny, isPermission, PERMISSIONS, SUPERVISOR_PRESET, supervisorHome } from '../lib/permissions.ts';

describe('permisos del supervisor', () => {
  test('el administrador lo tiene todo; un supervisor sólo lo suyo; el resto de los roles, nada extra', () => {
    for (const p of PERMISSIONS) assert.equal(can({ role: 'admin' }, p), true);
    const sup = { role: 'supervisor', permissions: ['inventory.view', 'orders.take'] };
    assert.equal(can(sup, 'inventory.view'), true);
    assert.equal(can(sup, 'inventory.count'), false);
    assert.equal(can({ role: 'supervisor', permissions: [] }, 'orders.take'), false);
    assert.equal(can({ role: 'supervisor' }, 'orders.take'), false);
    // Un mesero con una lista (por error o por un cambio de rol) no gana nada.
    assert.equal(can({ role: 'waiter', permissions: ['inventory.count'] }, 'inventory.count'), false);
    assert.equal(can({ role: 'cashier', permissions: [...PERMISSIONS] }, 'purchasing.use'), false);
  });

  test('canAny y el reconocimiento de permisos válidos', () => {
    const sup = { role: 'supervisor', permissions: ['suppliers.manage'] };
    assert.equal(canAny(sup, 'purchasing.use', 'suppliers.manage'), true);
    assert.equal(canAny(sup, 'purchasing.use', 'inventory.view'), false);
    assert.equal(isPermission('orders.take'), true);
    assert.equal(isPermission('ventas.ver'), false);
    assert.deepEqual([...SUPERVISOR_PRESET].sort(), [...PERMISSIONS].sort());
  });

  test('a dónde llega un supervisor según lo que tiene, y a ningún lado si no tiene nada', () => {
    assert.equal(supervisorHome({ role: 'supervisor', permissions: ['purchasing.use', 'inventory.view'] }), '/admin/purchasing');
    assert.equal(supervisorHome({ role: 'supervisor', permissions: ['suppliers.manage'] }), '/admin/purchasing');
    assert.equal(supervisorHome({ role: 'supervisor', permissions: ['inventory.waste'] }), '/admin/inventory');
    assert.equal(supervisorHome({ role: 'supervisor', permissions: ['orders.take'] }), '/waiter');
    assert.equal(supervisorHome({ role: 'supervisor', permissions: [] }), null);
  });

  test('la lista coincide con la restricción de la base de datos', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/migrations/026_supervisor_permissions.sql', import.meta.url), 'utf8');
    const listed = [...sql.matchAll(/permissions <@ array\[([^\]]+)\]/g)].flatMap((m) => [...m[1]!.matchAll(/'([a-z.]+)'/g)].map((x) => x[1]));
    assert.deepEqual([...listed].sort(), [...PERMISSIONS].sort());
  });
});
