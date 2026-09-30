'use server';

import { redirect } from 'next/navigation';
import { normalizeScopes } from '@/lib/oauth/core';
import { createAuthorizationCode, getClient } from '@/lib/oauth/server';
import { getTenantContext } from '@/lib/tenant-context';

/** Vuelve al asistente con los parámetros dados (la dirección ya fue validada contra el cliente). */
function back(redirectUri: string, params: Record<string, string | undefined>): never {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  redirect(url.toString());
}

/** Todo se revalida aquí: nunca se confía en los campos ocultos del formulario. */
async function validated(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? '');
  const client = await getClient(get('client_id'));
  const redirectUri = get('redirect_uri');
  if (!client || !client.redirect_uris.includes(redirectUri)) throw new Error('Solicitud de conexión inválida');
  return { client, redirectUri, state: get('state') || undefined, codeChallenge: get('code_challenge'), scope: get('scope'), resource: get('resource') || null };
}

export async function approveAuthorizationAction(formData: FormData) {
  const req = await validated(formData);
  const ctx = await getTenantContext();
  if (ctx.role !== 'admin') back(req.redirectUri, { error: 'access_denied', error_description: 'Sólo el administrador puede conectar asistentes', state: req.state });
  if (!req.codeChallenge) back(req.redirectUri, { error: 'invalid_request', error_description: 'PKCE requerido', state: req.state });
  const code = await createAuthorizationCode({
    clientId: req.client.client_id,
    tenantId: ctx.tenant.id,
    grantedBy: ctx.userId,
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
    scopes: normalizeScopes(req.scope),
    resource: req.resource,
  });
  back(req.redirectUri, { code, state: req.state });
}

export async function denyAuthorizationAction(formData: FormData) {
  const req = await validated(formData);
  back(req.redirectUri, { error: 'access_denied', state: req.state });
}
