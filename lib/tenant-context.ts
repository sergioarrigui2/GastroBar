import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';
import { accessTokenForApiKey, isApiKey } from '@/lib/api-keys';
import {
  createSupabaseServerClient,
  createSupabaseTokenClient,
  type TypedSupabaseClient,
} from '@/lib/supabase/server';
import type { AppRole, Profile, Tenant } from '@/types/domain';

/**
 * Contexto de ejecución por inquilino. El `supabase` que contiene está
 * autenticado como el usuario, así que TODA consulta queda limitada por RLS al
 * tenant del perfil; `tenant.id` se usa además como filtro explícito (defensa en
 * profundidad y mejores planes de consulta).
 */
export type TenantContext = {
  supabase: TypedSupabaseClient;
  userId: string;
  role: AppRole;
  profile: Profile;
  tenant: Tenant;
};

export class TenantContextError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: 'unauthenticated' | 'no_profile' | 'inactive' | 'suspended' | 'forbidden',
  ) {
    super(message);
    this.name = 'TenantContextError';
  }
}

async function resolveTenantContext(supabase: TypedSupabaseClient, accessToken?: string): Promise<TenantContext> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(accessToken);
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) {
    throw new TenantContextError('Sesión inválida o expirada', 401, 'unauthenticated');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new TenantContextError('El usuario no pertenece a ningún gastrobar', 403, 'no_profile');
  if (!profile.is_active) throw new TenantContextError('Usuario desactivado', 403, 'inactive');

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', profile.tenant_id)
    .maybeSingle();
  if (tenantError) throw tenantError;
  // RLS oculta el gastrobar cuando la plataforma lo suspende (migración 011).
  if (!tenant) throw new TenantContextError('Tu gastrobar está suspendido. Comunícate con tu asesor.', 403, 'suspended');

  return { supabase, userId, role: profile.role, profile, tenant };
}

/** Contexto para Server Components / Server Actions (memoizado por request). */
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const supabase = await createSupabaseServerClient();
  return resolveTenantContext(supabase);
});

/**
 * Contexto a partir de `Authorization: Bearer <token>` (API / agentes). El token
 * puede ser un access token de Supabase o una clave API `gbk_…` de larga duración.
 */
export async function getTenantContextFromRequest(request: Request): Promise<TenantContext> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  let token = match?.[1]?.trim();
  if (!token) throw new TenantContextError('Falta el header Authorization: Bearer <token>', 401, 'unauthenticated');

  if (isApiKey(token)) {
    const accessToken = await accessTokenForApiKey(token);
    if (!accessToken) throw new TenantContextError('Clave API inválida o revocada', 401, 'unauthenticated');
    token = accessToken;
  }
  return resolveTenantContext(createSupabaseTokenClient(token), token);
}

export function assertRole(ctx: TenantContext, allowed: readonly AppRole[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new TenantContextError(`Rol "${ctx.role}" sin permiso para esta operación`, 403, 'forbidden');
  }
}

const LOGIN_BY_ERROR: Partial<Record<TenantContextError['code'], string>> = {
  no_profile: '/login?error=no_account',
  inactive: '/login?error=inactive',
  suspended: '/login?error=suspended',
};

export const HOME_BY_ROLE: Record<AppRole, string> = {
  admin: '/admin',
  cashier: '/waiter',
  waiter: '/waiter',
  kitchen: '/kds/kitchen',
  bar: '/kds/bar',
  ai_agent: '/login?error=ai_agent',
};

/** Para páginas: resuelve el contexto o redirige (login con el motivo, o home del rol). */
export async function requirePageRole(allowed: readonly AppRole[]): Promise<TenantContext> {
  let ctx: TenantContext;
  try {
    ctx = await getTenantContext();
  } catch (error) {
    if (error instanceof TenantContextError) {
      redirect(LOGIN_BY_ERROR[error.code] ?? '/login');
    }
    throw error;
  }
  if (!allowed.includes(ctx.role)) redirect(HOME_BY_ROLE[ctx.role]);
  return ctx;
}
