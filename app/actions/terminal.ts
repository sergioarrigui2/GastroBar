'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { toUserMessage } from '@/lib/errors';
import { hashPin, isPinRole, lockAfterFailure, minutesLeft, pinProblem, verifyPin } from '@/lib/staff/pin';
import {
  generateTerminalToken,
  getTerminal,
  PIN_SESSION_COOKIE,
  PIN_SESSION_MAX_AGE,
  TERMINAL_COOKIE,
  TERMINAL_COOKIE_MAX_AGE,
} from '@/lib/staff/terminal';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertRole, getTenantContext, HOME_BY_ROLE } from '@/lib/tenant-context';

export type PinState = { error: string } | null;
export type TerminalFormState = { ok: boolean; message: string } | null;

const WRONG_PIN = 'PIN incorrecto';

/**
 * Entrada con PIN desde una terminal autorizada. Valida terminal → empleado del
 * mismo gastrobar, activo y con rol operativo → PIN (con bloqueo por intentos) y
 * abre una sesión normal de Supabase para ese empleado, así que todo lo que haga
 * queda a su nombre y pasa por RLS con su identidad.
 */
export async function signInWithPinAction(_prev: PinState, formData: FormData): Promise<PinState> {
  const profileId = z.uuid().safeParse(formData.get('profile_id'));
  const pin = String(formData.get('pin') ?? '');
  if (!profileId.success || !/^\d{4,6}$/.test(pin)) return { error: WRONG_PIN };

  const terminal = await getTerminal();
  if (!terminal) return { error: 'Esta tablet ya no está autorizada. Pide al administrador que la active de nuevo.' };

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('tenant_id', terminal.tenantId)
    .eq('id', profileId.data)
    .maybeSingle();
  const { data: row } = await admin
    .from('staff_pins')
    .select('pin_hash, failed_attempts, locked_until')
    .eq('tenant_id', terminal.tenantId)
    .eq('profile_id', profileId.data)
    .maybeSingle();
  if (!profile || !profile.is_active || !isPinRole(profile.role) || !row) return { error: WRONG_PIN };

  const now = new Date();
  const wait = minutesLeft(row.locked_until, now);
  if (wait > 0) return { error: `Demasiados intentos. Espera ${wait} min o pide al administrador un PIN nuevo.` };

  if (!verifyPin(pin, row.pin_hash)) {
    const failed = row.failed_attempts + 1;
    const lockedUntil = lockAfterFailure(failed, now);
    await admin
      .from('staff_pins')
      .update({ failed_attempts: failed, locked_until: lockedUntil?.toISOString() ?? null })
      .eq('tenant_id', terminal.tenantId)
      .eq('profile_id', profile.id);
    return { error: lockedUntil ? `PIN incorrecto. Bloqueado ${minutesLeft(lockedUntil.toISOString(), now)} min.` : WRONG_PIN };
  }
  if (row.failed_attempts > 0 || row.locked_until) {
    await admin.from('staff_pins').update({ failed_attempts: 0, locked_until: null }).eq('tenant_id', terminal.tenantId).eq('profile_id', profile.id);
  }

  // Sesión para el empleado: enlace mágico generado por el servidor (no envía correo) y canjeado aquí mismo.
  const { data: user, error: userError } = await admin.auth.admin.getUserById(profile.id);
  if (userError || !user.user?.email) return { error: 'No se pudo abrir la sesión. Intenta de nuevo.' };
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.user.email });
  if (linkError) return { error: 'No se pudo abrir la sesión. Intenta de nuevo.' };

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (verifyError) return { error: 'No se pudo abrir la sesión. Intenta de nuevo.' };
  (await cookies()).set(PIN_SESSION_COOKIE, '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PIN_SESSION_MAX_AGE,
  });

  redirect(HOME_BY_ROLE[profile.role]);
}

/** Cambiar de usuario / bloqueo por inactividad: cierra sólo la sesión de esta tablet. */
export async function lockTerminalAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' });
  (await cookies()).delete(PIN_SESSION_COOKIE);
  redirect('/terminal');
}

/** El admin autoriza el dispositivo desde el que está conectado como terminal compartida. */
export async function activateTerminalAction(_prev: TerminalFormState, formData: FormData): Promise<TerminalFormState> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, ['admin']);
    const name = z.string().trim().min(1, 'Ponle un nombre a la tablet').max(60).parse(String(formData.get('name') ?? ''));

    const { token, hash } = generateTerminalToken();
    const { error } = await ctx.supabase.from('terminal_devices').insert({ name, token_hash: hash });
    if (error) throw error;

    (await cookies()).set(TERMINAL_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: TERMINAL_COOKIE_MAX_AGE,
    });
    revalidatePath('/admin/staff');
    return { ok: true, message: `"${name}" quedó autorizada como terminal. Al cerrar tu sesión verás la pantalla de PIN.` };
  } catch (error) {
    return { ok: false, message: toUserMessage(error) };
  }
}

export async function revokeTerminalAction(deviceId: string): Promise<TerminalFormState> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, ['admin']);
    const { error } = await ctx.supabase
      .from('terminal_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', z.uuid().parse(deviceId));
    if (error) throw error;
    revalidatePath('/admin/staff');
    return { ok: true, message: 'Terminal revocada: ya no acepta PINs' };
  } catch (error) {
    return { ok: false, message: toUserMessage(error) };
  }
}

/** Quita la marca de terminal de este dispositivo (sin revocarla en otros). */
export async function forgetTerminalAction(): Promise<void> {
  (await cookies()).delete(TERMINAL_COOKIE);
  revalidatePath('/admin/staff');
}

/** Asigna o cambia el PIN de un empleado del gastrobar del admin (también lo desbloquea). */
export async function setStaffPinAction(profileId: string, pin: string): Promise<TerminalFormState> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, ['admin']);
    const problem = pinProblem(pin);
    if (problem) return { ok: false, message: problem };

    // RLS: el admin sólo ve perfiles de su gastrobar.
    const { data: profile, error } = await ctx.supabase
      .from('profiles')
      .select('id, role, full_name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', z.uuid().parse(profileId))
      .maybeSingle();
    if (error) throw error;
    if (!profile) return { ok: false, message: 'Empleado no encontrado' };
    if (!isPinRole(profile.role)) return { ok: false, message: 'Sólo meseros, caja, cocina y barra usan PIN' };

    const { error: upsertError } = await createSupabaseAdminClient()
      .from('staff_pins')
      .upsert(
        { profile_id: profile.id, tenant_id: ctx.tenant.id, pin_hash: hashPin(pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() },
        { onConflict: 'profile_id' },
      );
    if (upsertError) throw upsertError;
    revalidatePath('/admin/staff');
    return { ok: true, message: `PIN de ${profile.full_name} actualizado` };
  } catch (error) {
    return { ok: false, message: toUserMessage(error) };
  }
}
