import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Superusuarios de la plataforma (tabla platform_admins, migración 011). No son un
 * rol dentro de un gastrobar: la consola /platform opera con el rol de servicio,
 * SIEMPRE después de verificar aquí la sesión.
 */
export const getPlatformAdminId = cache(async (): Promise<string | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) return null;
    const { data } = await supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
    return data ? userId : null;
  } catch {
    return null;
  }
});

export async function isPlatformAdmin(): Promise<boolean> {
  return (await getPlatformAdminId()) !== null;
}

/** Para páginas de /platform. */
export async function requirePlatformAdmin(): Promise<string> {
  const id = await getPlatformAdminId();
  if (!id) redirect('/login?next=/platform');
  return id;
}

export class PlatformForbiddenError extends Error {
  constructor() {
    super('Sólo el superusuario de la plataforma puede hacer esto.');
  }
}

/** Para Server Actions de /platform. */
export async function assertPlatformAdmin(): Promise<string> {
  const id = await getPlatformAdminId();
  if (!id) throw new PlatformForbiddenError();
  return id;
}
