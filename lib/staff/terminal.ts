import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { AppRole } from '@/types/domain';
import { PIN_ROLES } from './pin';

/**
 * Terminales compartidas: una tablet que el admin autoriza para su gastrobar.
 * Guarda un token aleatorio (256 bits) en una cookie httpOnly; en la base sólo
 * vive el SHA-256. Sólo desde una terminal válida se puede entrar con PIN.
 */
export const TERMINAL_COOKIE = 'gb_terminal';
export const TERMINAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~13 meses (máximo de los navegadores)

/** Dominio reservado (RFC 2606): nunca recibe correo. Para empleados sin correo propio. */
export const STAFF_EMAIL_DOMAIN = process.env.STAFF_EMAIL_DOMAIN || 'staff.gastrobar.invalid';

export function hashTerminalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateTerminalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashTerminalToken(token) };
}

export function syntheticStaffEmail(): string {
  return `pin-${randomBytes(9).toString('hex')}@${STAFF_EMAIL_DOMAIN}`;
}

export type Terminal = { id: string; name: string; tenantId: string; tenantName: string };

const SEEN_THROTTLE_MS = 10 * 60_000;

/** La terminal de este dispositivo, o null si no hay cookie, fue revocada o el gastrobar no está activo. */
export async function getTerminal(): Promise<Terminal | null> {
  const token = (await cookies()).get(TERMINAL_COOKIE)?.value;
  if (!token) return null;

  const admin = createSupabaseAdminClient();
  const { data: device, error } = await admin
    .from('terminal_devices')
    .select('id, name, tenant_id, revoked_at, last_seen_at')
    .eq('token_hash', hashTerminalToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!device || device.revoked_at) return null;

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('name, status')
    .eq('id', device.tenant_id)
    .maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant || tenant.status !== 'active') return null;

  if (!device.last_seen_at || Date.now() - new Date(device.last_seen_at).getTime() > SEEN_THROTTLE_MS) {
    void admin.from('terminal_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id);
  }
  return { id: device.id, name: device.name, tenantId: device.tenant_id, tenantName: tenant.name };
}

/** ¿Este dispositivo tiene cookie de terminal? (sin validar; para decidir a dónde volver al salir). */
export async function hasTerminalCookie(): Promise<boolean> {
  return (await cookies()).has(TERMINAL_COOKIE);
}

export type TerminalStaff = { id: string; name: string; role: AppRole };

/** Personal activo del gastrobar de la terminal que tiene PIN asignado. */
export async function listTerminalStaff(terminal: Terminal): Promise<TerminalStaff[]> {
  const admin = createSupabaseAdminClient();
  const { data: pins, error: pinsError } = await admin.from('staff_pins').select('profile_id').eq('tenant_id', terminal.tenantId);
  if (pinsError) throw pinsError;
  const ids = (pins ?? []).map((p) => p.profile_id);
  if (!ids.length) return [];

  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .eq('tenant_id', terminal.tenantId)
    .eq('is_active', true)
    .in('role', [...PIN_ROLES])
    .in('id', ids)
    .order('full_name');
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name, role: p.role }));
}
