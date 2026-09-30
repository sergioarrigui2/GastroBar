'use server';

import { createHash, randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/lib/actions';
import { enqueueBill, enqueueCashReport, enqueueOrderTickets, enqueueTestTicket, type Queued } from '@/lib/printing/enqueue';
import { PRINT_DOCUMENTS, PRINTER_PROFILES, type PrintDoc } from '@/lib/printing/types';
import type { Json } from '@/types/database';

const ADMIN = ['admin'] as const;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_MINUTES = 15;

const done = <T>(result: T) => {
  revalidatePath('/admin/printing');
  return result;
};

/** SHA-256 del código sin guiones y en mayúsculas (igual que private.print_token_hash en la base). */
const hashCode = (code: string) => createHash('sha256').update(code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).digest('hex');

/** Crea una estación (o renueva el código de una existente) y devuelve el código de vinculación. */
export async function createPairingCodeAction(input: { name?: string; stationId?: string }) {
  return runAction(ADMIN, async (ctx) => {
    const code = Array.from({ length: 8 }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join('');
    const expires = new Date(Date.now() + PAIRING_MINUTES * 60_000).toISOString();
    const pairing = { pairing_code_hash: hashCode(code), pairing_expires_at: expires };
    if (input.stationId) {
      // Renovar: el token anterior deja de servir hasta que el PC se vuelva a vincular.
      const { error } = await ctx.supabase
        .from('print_stations')
        .update({ ...pairing, token_hash: null, revoked_at: null })
        .eq('tenant_id', ctx.tenant.id)
        .eq('id', z.uuid().parse(input.stationId));
      if (error) throw error;
    } else {
      const name = z.string().trim().min(1).max(60).parse(input.name || 'PC de caja');
      const { error } = await ctx.supabase.from('print_stations').insert({ name, ...pairing });
      if (error) throw error;
    }
    return done({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: expires });
  });
}

export async function revokeStationAction(stationId: string) {
  return runAction(ADMIN, async (ctx) => {
    const { error } = await ctx.supabase
      .from('print_stations')
      .update({ revoked_at: new Date().toISOString(), token_hash: null, pairing_code_hash: null })
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', z.uuid().parse(stationId));
    if (error) throw error;
    return done(true);
  });
}

const printerSchema = z.object({
  id: z.uuid().optional(),
  station_id: z.uuid(),
  name: z.string().trim().min(1, 'Ponle un nombre (Caja, Cocina…)').max(40),
  connection: z.enum(['windows', 'network']),
  target: z.string().trim().min(1, 'Elige la impresora o escribe su IP').max(200),
  paper_width: z.union([z.literal(58), z.literal(80)]),
  profile: z.enum(PRINTER_PROFILES.map((p) => p.id) as [string, ...string[]]),
  codepage: z.enum(['cp850', 'cp1252', 'ascii']),
  mode: z.enum(['escpos', 'text']),
  cut: z.boolean(),
  is_active: z.boolean().default(true),
});

export async function savePrinterAction(input: z.input<typeof printerSchema>) {
  return runAction(ADMIN, async (ctx) => {
    const { id, ...data } = printerSchema.parse(input);
    if (data.connection === 'network' && !/^[\w.-]+(:\d{2,5})?$/.test(data.target)) throw new Error('Escribe la IP de la impresora, por ejemplo 192.168.1.50');
    const { error } = id
      ? await ctx.supabase.from('printers').update(data).eq('tenant_id', ctx.tenant.id).eq('id', id)
      : await ctx.supabase.from('printers').insert(data);
    if (error) throw error;
    return done(true);
  });
}

export async function deletePrinterAction(printerId: string) {
  return runAction(ADMIN, async (ctx) => {
    const { error } = await ctx.supabase.from('printers').delete().eq('tenant_id', ctx.tenant.id).eq('id', z.uuid().parse(printerId));
    if (error) throw error;
    return done(true);
  });
}

export async function testPrinterAction(printerId: string) {
  return runAction(ADMIN, async (ctx) => {
    const { data: printer, error } = await ctx.supabase.from('printers').select('id, name').eq('tenant_id', ctx.tenant.id).eq('id', z.uuid().parse(printerId)).single();
    if (error) throw error;
    const doc: PrintDoc = {
      blocks: [
        { t: 'text', text: 'PRUEBA DE IMPRESIÓN', align: 'center', bold: true, big: true },
        { t: 'text', text: `${ctx.tenant.name} · ${printer.name}`, align: 'center' },
        { t: 'rule' },
        { t: 'text', text: 'Tildes: á é í ó ú  Á É Í Ó Ú' },
        { t: 'text', text: 'Eñes: ñ Ñ  ·  ¿Todo bien? ¡Listo!' },
        { t: 'row', left: '2 x Café con leche', right: '$ 12.000' },
        { t: 'row', left: 'TOTAL', right: '$ 12.000', bold: true },
        { t: 'rule', char: '=' },
        { t: 'text', text: 'Si las tildes salen bien, la tabla de caracteres es la correcta.', align: 'center' },
      ],
    };
    await enqueueTestTicket(ctx, printer.id, doc);
    return done(true);
  });
}

const settingsSchema = z.object({
  routes: z.partialRecord(z.enum(PRINT_DOCUMENTS), z.uuid().nullable()),
  category_overrides: z.record(z.uuid(), z.union([z.uuid(), z.literal('none')])),
  options: z.object({
    order_copies: z.number().int().min(1).max(5),
    large_notes: z.boolean(),
    prices_on_order: z.boolean(),
    open_drawer_on_cash: z.boolean(),
    receipt_on_payment: z.boolean(),
    cash_report_on_close: z.boolean(),
  }),
});

export async function savePrintSettingsAction(input: z.input<typeof settingsSchema>) {
  return runAction(ADMIN, async (ctx) => {
    const data = settingsSchema.parse(input);
    const { error } = await ctx.supabase.from('print_settings').upsert(
      {
        tenant_id: ctx.tenant.id,
        routes: data.routes as unknown as Json,
        category_overrides: data.category_overrides as unknown as Json,
        options: data.options as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    );
    if (error) throw error;
    return done(true);
  });
}

export async function reprintJobAction(jobId: string) {
  return runAction(['admin', 'cashier'], async (ctx) => {
    const { error } = await ctx.supabase
      .from('print_jobs')
      .update({ status: 'pending', attempts: 0, error: null, claimed_at: null, printed_at: null })
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', z.uuid().parse(jobId));
    if (error) throw error;
    return done(true);
  });
}

// ─── Botones de impresión en la operación ──────────────────────────────────────
// Devuelven queued=false si no hay impresora configurada: la pantalla usa entonces
// la impresión del navegador como antes.

export async function printBillAction(orderId: string) {
  return runAction(['admin', 'cashier', 'waiter'], (ctx): Promise<Queued> => enqueueBill(ctx, z.uuid().parse(orderId)));
}

export async function printOrderTicketAction(input: { orderId: string; station: 'kitchen' | 'bar'; round?: number }) {
  return runAction(['admin', 'cashier', 'waiter', 'kitchen', 'bar'], async (ctx): Promise<Queued> => {
    const n = await enqueueOrderTickets(ctx, z.uuid().parse(input.orderId), input.round, z.enum(['kitchen', 'bar']).parse(input.station));
    return { queued: n > 0 };
  });
}

export async function printCashReportAction(sessionId: string) {
  return runAction(['admin', 'cashier'], (ctx): Promise<Queued> => enqueueCashReport(ctx, z.uuid().parse(sessionId)));
}
