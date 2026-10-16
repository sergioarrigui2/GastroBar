'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/lib/actions';
import { rememberBrand } from '@/lib/branding';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { TenantContext } from '@/lib/tenant-context';
import type { AppRole } from '@/types/domain';

const EVERYONE = ['admin', 'supervisor', 'cashier', 'waiter', 'kitchen', 'bar'] as const satisfies readonly AppRole[];

const name = z.string().trim().min(2, 'El nombre debe tener al menos 2 letras').max(120);
const phone = z.string().trim().regex(/^[0-9+() -]{6,30}$/, 'El teléfono sólo puede tener números, espacios, + ( ) -').nullable();
const url = z.url().max(500).nullable();

const refresh = () => revalidatePath('/', 'layout');

/** Quita del almacenamiento la imagen que se reemplazó (sólo si es de esta carpeta). */
async function removeOld(ctx: TenantContext, bucket: string, folder: string, oldUrl: string | null | undefined, newUrl: string | null) {
  if (!oldUrl || oldUrl === newUrl) return;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = oldUrl.indexOf(marker);
  if (at < 0) return;
  const path = decodeURIComponent(new URL(oldUrl).pathname.split(marker)[1] ?? '');
  if (path.startsWith(`${folder}/`)) await ctx.supabase.storage.from(bucket).remove([path]);
}

const avatarFolder = (tenantId: string, profileId: string) => `${tenantId}/${profileId}`;
const inFolder = (value: string, bucket: string, folder: string) => new URL(value).pathname.startsWith(`/storage/v1/object/public/${bucket}/${folder}/`);

/** Mis datos: nombre, teléfono y foto. El rol, los permisos y el estado no se tocan aquí. */
export async function updateMyProfileAction(input: { full_name: string; phone: string | null; avatar_url: string | null }) {
  return runAction(EVERYONE, async (ctx) => {
    const data = z.object({ full_name: name, phone, avatar_url: url }).parse(input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('update_my_profile', {
      p_full_name: data.full_name,
      p_phone: data.phone ?? undefined,
      p_avatar_url: data.avatar_url ?? undefined,
      p_clear_phone: data.phone === null,
      p_clear_avatar: data.avatar_url === null,
    });
    if (error) throw error;
    await removeOld(ctx, 'avatars', avatarFolder(ctx.tenant.id, ctx.userId), ctx.profile.avatar_url, data.avatar_url);
    refresh();
  });
}

/** El administrador actualiza los datos de cualquier persona de su equipo. */
export async function updateStaffProfileAction(profileId: string, input: { full_name: string; phone: string | null; avatar_url: string | null }) {
  return runAction(['admin'], async (ctx) => {
    const id = z.uuid().parse(profileId);
    const data = z.object({ full_name: name, phone, avatar_url: url }).parse(input);
    if (data.avatar_url !== null && !inFolder(data.avatar_url, 'avatars', avatarFolder(ctx.tenant.id, id))) {
      throw new Error('La foto debe estar en la carpeta de esa persona');
    }
    const { data: before } = await ctx.supabase.from('profiles').select('avatar_url').eq('tenant_id', ctx.tenant.id).eq('id', id).maybeSingle();
    const { error } = await ctx.supabase
      .from('profiles')
      .update({ full_name: data.full_name, phone: data.phone, avatar_url: data.avatar_url })
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', id);
    if (error) throw error;
    await removeOld(ctx, 'avatars', avatarFolder(ctx.tenant.id, id), before?.avatar_url, data.avatar_url);
    refresh();
  });
}

/** El administrador cambia el logo del negocio (o lo quita con null). */
export async function setTenantLogoAction(logoUrl: string | null) {
  return runAction(['admin'], async (ctx) => {
    const value = url.parse(logoUrl);
    const folder = `${ctx.tenant.id}/branding`;
    if (value !== null && !inFolder(value, 'product-images', folder)) throw new Error('El logo debe estar en la carpeta del gastrobar');
    const { error } = await ctx.supabase.from('tenants').update({ logo_url: value }).eq('id', ctx.tenant.id);
    if (error) throw error;
    await removeOld(ctx, 'product-images', folder, ctx.tenant.logo_url, value);
    await rememberBrand({ name: ctx.tenant.name, logo: value });
    refresh();
  });
}
