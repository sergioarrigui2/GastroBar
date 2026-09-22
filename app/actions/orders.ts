'use server';

import { z } from 'zod';
import { FLOOR_ROLES, KDS_ROLES, runAction } from '@/lib/actions';
import { cancelOrder, getKdsTickets, getOpenBill, submitOrder, updateItemsStatus } from '@/lib/services/orders';
import { getTableStatus, setTableStatus } from '@/lib/services/tables';
import { stationSchema, type SubmitOrderInput, type UpdateItemsStatusInput } from '@/lib/validations/order';
import type { Station, TableStatus } from '@/types/domain';

export async function submitOrderAction(input: SubmitOrderInput) {
  return runAction(FLOOR_ROLES, (ctx) => submitOrder(ctx, input));
}

export async function updateItemsStatusAction(input: UpdateItemsStatusInput) {
  return runAction([...FLOOR_ROLES, ...KDS_ROLES], (ctx) => updateItemsStatus(ctx, input));
}

export async function cancelOrderAction(orderId: string) {
  return runAction(['admin', 'cashier'], (ctx) => cancelOrder(ctx, z.uuid().parse(orderId)));
}

export async function getOpenBillAction(tableId: string) {
  return runAction(FLOOR_ROLES, (ctx) => getOpenBill(ctx, { table_id: z.uuid().parse(tableId) }));
}

export async function getTableStatusAction() {
  return runAction(FLOOR_ROLES, (ctx) => getTableStatus(ctx));
}

export async function setTableStatusAction(tableId: string, status: TableStatus) {
  return runAction(FLOOR_ROLES, (ctx) =>
    setTableStatus(ctx, z.uuid().parse(tableId), z.enum(['free', 'reserved', 'cleaning']).parse(status)),
  );
}

export async function getKdsTicketsAction(station: Station) {
  return runAction(KDS_ROLES, (ctx) => getKdsTickets(ctx, stationSchema.parse(station)));
}
