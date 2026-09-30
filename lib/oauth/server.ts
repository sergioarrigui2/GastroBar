import 'server-only';

import { randomBytes } from 'node:crypto';
import { forgetAgentSession } from '@/lib/agent-session';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  ACCESS_PREFIX,
  ACCESS_TTL_SECONDS,
  assistantLabel,
  CODE_TTL_SECONDS,
  isAllowedRedirectUri,
  randomToken,
  REFRESH_PREFIX,
  REFRESH_TTL_SECONDS,
  type Scope,
  sha256Hex,
  verifyPkce,
} from './core';

/**
 * Servidor OAuth 2.1 de GastroBar para conectores de IA (Claude, ChatGPT…).
 * Todo corre con el rol de servicio y valida explícitamente cliente, gastrobar,
 * vigencia y revocación. Un asistente conectado actúa como un usuario ai_agent
 * propio de esa conexión: al desconectarlo se desactiva y sus tokens mueren.
 */
export class OAuthError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_client_metadata' | 'invalid_redirect_uri',
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const db = () => createSupabaseAdminClient();
const STAFF_EMAIL_DOMAIN = process.env.STAFF_EMAIL_DOMAIN || 'staff.gastrobar.invalid';
export const CALLS_PER_HOUR = 120;

// ─── Registro dinámico de clientes (RFC 7591) ───────────────────────────────────

export async function registerClient(meta: Record<string, unknown>) {
  const redirectUris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!redirectUris.length || redirectUris.length > 10) throw new OAuthError('invalid_redirect_uri', 'redirect_uris es obligatorio (1 a 10)');
  const bad = redirectUris.find((u) => !isAllowedRedirectUri(u));
  if (bad) throw new OAuthError('invalid_redirect_uri', `redirect_uri no permitida: ${bad}`);
  const authMethod = typeof meta.token_endpoint_auth_method === 'string' ? meta.token_endpoint_auth_method : 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method no soportado');
  const clientName = typeof meta.client_name === 'string' && meta.client_name.trim() ? meta.client_name.trim().slice(0, 120) : 'Asistente de IA';

  const clientId = `gbc_${randomBytes(16).toString('base64url')}`;
  const clientSecret = authMethod === 'none' ? null : randomToken('gbs_');
  const { error } = await db()
    .from('oauth_clients')
    .insert({ client_id: clientId, client_secret_hash: clientSecret ? sha256Hex(clientSecret) : null, client_name: clientName, redirect_uris: redirectUris });
  if (error) throw error;
  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
  };
}

export async function getClient(clientId: string) {
  const { data, error } = await db().from('oauth_clients').select('client_id, client_name, redirect_uris, client_secret_hash').eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  return data;
}

async function authenticateClient(clientId: string, clientSecret: string | null) {
  const client = await getClient(clientId);
  if (!client) throw new OAuthError('invalid_client', 'Cliente desconocido', 401);
  if (client.client_secret_hash && (!clientSecret || sha256Hex(clientSecret) !== client.client_secret_hash)) {
    throw new OAuthError('invalid_client', 'Credenciales del cliente inválidas', 401);
  }
  return client;
}

// ─── Código de autorización (después de que el admin acepta) ───────────────────

export async function createAuthorizationCode(p: {
  clientId: string;
  tenantId: string;
  grantedBy: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: Scope[];
  resource: string | null;
}): Promise<string> {
  const code = randomToken('gbk-code_');
  const { error } = await db()
    .from('oauth_codes')
    .insert({
      code_hash: sha256Hex(code),
      client_id: p.clientId,
      tenant_id: p.tenantId,
      granted_by: p.grantedBy,
      redirect_uri: p.redirectUri,
      code_challenge: p.codeChallenge,
      scopes: p.scopes,
      resource: p.resource,
      expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
    });
  if (error) throw error;
  return code;
}

// ─── Tokens ────────────────────────────────────────────────────────────────────

async function issueTokens(connectionId: string, scopes: string[]) {
  const access = randomToken(ACCESS_PREFIX);
  const refresh = randomToken(REFRESH_PREFIX);
  const now = Date.now();
  const { error } = await db()
    .from('ai_connection_tokens')
    .insert([
      { token_hash: sha256Hex(access), connection_id: connectionId, kind: 'access', expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString() },
      { token_hash: sha256Hex(refresh), connection_id: connectionId, kind: 'refresh', expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString() },
    ]);
  if (error) throw error;
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: scopes.join(' ') };
}

/** Usuario ai_agent propio de la conexión (sin correo real, sin contraseña conocida). */
async function createAgentProfile(tenantId: string, label: string): Promise<string> {
  const admin = db();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `agente-${randomBytes(9).toString('hex')}@${STAFF_EMAIL_DOMAIN}`,
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
    user_metadata: { full_name: `Asistente IA · ${label}` },
  });
  if (error || !created.user) throw error ?? new Error('No se pudo crear el agente');
  const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, tenant_id: tenantId, role: 'ai_agent', full_name: `Asistente IA · ${label}`.slice(0, 120) });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw profileError;
  }
  return created.user.id;
}

export async function exchangeCode(p: { code: string; clientId: string; clientSecret: string | null; redirectUri: string; codeVerifier: string }) {
  const client = await authenticateClient(p.clientId, p.clientSecret);
  const admin = db();
  const { data: row, error } = await admin.from('oauth_codes').select('*').eq('code_hash', sha256Hex(p.code)).maybeSingle();
  if (error) throw error;
  if (!row || row.client_id !== client.client_id) throw new OAuthError('invalid_grant', 'Código inválido');
  if (row.used_at) throw new OAuthError('invalid_grant', 'El código ya se usó');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new OAuthError('invalid_grant', 'El código venció');
  if (row.redirect_uri !== p.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri no coincide');
  if (!verifyPkce(p.codeVerifier, row.code_challenge)) throw new OAuthError('invalid_grant', 'PKCE inválido');

  // Un solo uso: se marca antes de emitir (si dos canjes compiten, sólo uno lo logra).
  const { data: claimed } = await admin.from('oauth_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', row.code_hash).is('used_at', null).select('code_hash');
  if (!claimed?.length) throw new OAuthError('invalid_grant', 'El código ya se usó');

  const label = assistantLabel(client.client_name, row.redirect_uri);
  // Si este asistente ya estaba conectado a este gastrobar, se reutiliza la conexión.
  const { data: existing } = await admin
    .from('ai_connections')
    .select('id, agent_profile_id')
    .eq('tenant_id', row.tenant_id)
    .eq('client_id', client.client_id)
    .is('revoked_at', null)
    .maybeSingle();
  let connectionId = existing?.id;
  if (!connectionId) {
    const agentId = await createAgentProfile(row.tenant_id, label);
    const { data: conn, error: connError } = await admin
      .from('ai_connections')
      .insert({ tenant_id: row.tenant_id, client_id: client.client_id, client_name: label, agent_profile_id: agentId, granted_by: row.granted_by, scopes: row.scopes })
      .select('id')
      .single();
    if (connError) throw connError;
    connectionId = conn.id;
  }
  return issueTokens(connectionId, row.scopes);
}

export async function refreshTokens(p: { refreshToken: string; clientId: string; clientSecret: string | null }) {
  const client = await authenticateClient(p.clientId, p.clientSecret);
  const admin = db();
  const hash = sha256Hex(p.refreshToken);
  const { data: tok } = await admin.from('ai_connection_tokens').select('token_hash, connection_id, kind, expires_at, revoked_at').eq('token_hash', hash).maybeSingle();
  if (!tok || tok.kind !== 'refresh' || tok.revoked_at || new Date(tok.expires_at).getTime() < Date.now()) throw new OAuthError('invalid_grant', 'Token de renovación inválido');
  const { data: conn } = await admin.from('ai_connections').select('id, client_id, scopes, revoked_at').eq('id', tok.connection_id).maybeSingle();
  if (!conn || conn.revoked_at || conn.client_id !== client.client_id) throw new OAuthError('invalid_grant', 'La conexión fue desconectada');
  // Rotación: el token de renovación usado deja de servir.
  const { data: rotated } = await admin.from('ai_connection_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash).is('revoked_at', null).select('token_hash');
  if (!rotated?.length) throw new OAuthError('invalid_grant', 'Token de renovación ya usado');
  return issueTokens(conn.id, conn.scopes);
}

export async function revokeToken(token: string): Promise<void> {
  await db().from('ai_connection_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', sha256Hex(token)).is('revoked_at', null);
}

export type ResolvedConnection = { connectionId: string; tenantId: string; agentUserId: string; scopes: string[] };

/** Token de acceso → conexión vigente (no vencida, no revocada, agente y gastrobar activos). */
export async function resolveAccessToken(token: string): Promise<ResolvedConnection | null> {
  const admin = db();
  const { data: tok } = await admin.from('ai_connection_tokens').select('connection_id, kind, expires_at, revoked_at').eq('token_hash', sha256Hex(token)).maybeSingle();
  if (!tok || tok.kind !== 'access' || tok.revoked_at || new Date(tok.expires_at).getTime() < Date.now()) return null;
  const { data: conn } = await admin.from('ai_connections').select('id, tenant_id, agent_profile_id, scopes, revoked_at, last_used_at').eq('id', tok.connection_id).maybeSingle();
  if (!conn || conn.revoked_at) return null;
  if (!conn.last_used_at || Date.now() - new Date(conn.last_used_at).getTime() > 60_000) {
    void admin.from('ai_connections').update({ last_used_at: new Date().toISOString() }).eq('id', conn.id);
  }
  return { connectionId: conn.id, tenantId: conn.tenant_id, agentUserId: conn.agent_profile_id, scopes: conn.scopes };
}

/** Límite de uso por conexión (llamadas a herramientas en la última hora). */
export async function underRateLimit(connectionId: string): Promise<boolean> {
  const { count } = await db()
    .from('ai_connection_calls')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .gte('created_at', new Date(Date.now() - 3600_000).toISOString());
  return (count ?? 0) < CALLS_PER_HOUR;
}

export async function recordCall(c: { tenantId: string; connectionId: string }, tool: string, ok: boolean): Promise<void> {
  const { error } = await db().from('ai_connection_calls').insert({ tenant_id: c.tenantId, connection_id: c.connectionId, tool: tool.slice(0, 80), ok });
  if (error) console.error('[conexiones IA] no se pudo registrar la llamada', error);
}

/** Desconectar: tokens revocados, conexión cerrada y su agente desactivado. */
export async function disconnect(tenantId: string, connectionId: string): Promise<void> {
  const admin = db();
  const { data: conn } = await admin.from('ai_connections').select('id, agent_profile_id').eq('tenant_id', tenantId).eq('id', connectionId).maybeSingle();
  if (!conn) throw new Error('Conexión no encontrada');
  const now = new Date().toISOString();
  await admin.from('ai_connection_tokens').update({ revoked_at: now }).eq('connection_id', conn.id).is('revoked_at', null);
  await admin.from('ai_connections').update({ revoked_at: now }).eq('id', conn.id);
  await admin.from('profiles').update({ is_active: false }).eq('tenant_id', tenantId).eq('id', conn.agent_profile_id);
  forgetAgentSession(conn.agent_profile_id);
}
