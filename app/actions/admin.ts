'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { toUserMessage } from '@/lib/errors';
import { recordInventoryMovement } from '@/lib/services/inventory';
import { hashPin, isPinRole, pinProblem } from '@/lib/staff/pin';
import { syntheticStaffEmail } from '@/lib/staff/terminal';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { assertRole, getTenantContext } from '@/lib/tenant-context';
import { createStaffSchema, inventoryMovementSchema } from '@/lib/validations/admin';

export type FormState = { ok: boolean; message: string } | null;

const field = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
};

export async function recordInventoryMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, ['admin', 'kitchen', 'bar', 'cashier']);
    const input = inventoryMovementSchema.parse({
      ingredient_id: field(formData, 'ingredient_id'),
      type: field(formData, 'type'),
      quantity: field(formData, 'quantity'),
      reason: field(formData, 'reason'),
      unit_cost: field(formData, 'unit_cost'),
    });
    const ingredient = await recordInventoryMovement(ctx, input);
    revalidatePath('/admin/inventory');
    return { ok: true, message: `${ingredient.name}: stock actualizado a ${ingredient.stock_quantity} ${ingredient.unit}` };
  } catch (error) {
    return { ok: false, message: toUserMessage(error) };
  }
}

/**
 * Alta de personal (incluye usuarios ai_agent). Requiere service role para crear
 * el usuario en Auth; el tenant se toma SIEMPRE de la sesión del admin.
 * Con acceso "pin" el empleado no necesita correo: se le crea un correo interno
 * en un dominio reservado y una contraseña aleatoria que nadie conoce; entra sólo
 * con su PIN desde una terminal autorizada.
 */
export async function createStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, ['admin']);
    const input = createStaffSchema.parse({
      access: field(formData, 'access') ?? 'password',
      email: field(formData, 'email'),
      password: field(formData, 'password'),
      full_name: field(formData, 'full_name'),
      role: field(formData, 'role'),
      pin: field(formData, 'pin'),
    });
    if (input.pin) {
      if (!isPinRole(input.role)) throw new Error('Sólo meseros, caja, cocina y barra usan PIN');
      const problem = pinProblem(input.pin);
      if (problem) throw new Error(problem);
    }

    const pinOnly = input.access === 'pin';
    const admin = createSupabaseAdminClient();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: pinOnly ? syntheticStaffEmail() : input.email,
      password: pinOnly ? randomBytes(32).toString('base64url') : input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });
    if (authError || !created.user) throw authError ?? new Error('No se pudo crear el usuario');

    const rollback = async (error: unknown) => {
      await admin.auth.admin.deleteUser(created.user.id);
      throw error;
    };
    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id,
      tenant_id: ctx.tenant.id,
      role: input.role,
      full_name: input.full_name,
      pin_only: pinOnly,
    });
    if (profileError) await rollback(profileError);
    if (input.pin) {
      const { error: pinError } = await admin
        .from('staff_pins')
        .insert({ profile_id: created.user.id, tenant_id: ctx.tenant.id, pin_hash: hashPin(input.pin) });
      if (pinError) await rollback(pinError);
    }

    revalidatePath('/admin/staff');
    return { ok: true, message: `${input.full_name} agregado${input.pin ? ' con PIN' : ''}` };
  } catch (error) {
    return { ok: false, message: toUserMessage(error) };
  }
}

export async function setStaffActiveAction(profileId: string, isActive: boolean): Promise<FormState> {
  try {
    const ctx = await getTenantContext();
    assertRole(ctx, ['admin']);
    if (profileId === ctx.userId) throw new Error('No puedes desactivar tu propio usuario');
    const { error } = await ctx.supabase
      .from('profiles')
      .update({ is_active: isActive })
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', profileId);
    if (error) throw error;
    revalidatePath('/admin/staff');
    return { ok: true, message: isActive ? 'Usuario activado' : 'Usuario desactivado' };
  } catch (error) {
    return { ok: false, message: toUserMessage(error) };
  }
}
