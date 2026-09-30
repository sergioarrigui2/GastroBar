import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Piezas puras del servidor OAuth 2.1 para conectores de IA (sin base de datos).
 * Tokens opacos con prefijo (se guardan sólo como SHA-256) y PKCE S256 obligatorio.
 */
export const SCOPES = {
  'gastrobar.read': 'Consultar ventas, análisis, menú con costos, inventario y mesas (sólo lectura)',
} as const;
export type Scope = keyof typeof SCOPES;
export const DEFAULT_SCOPES: Scope[] = ['gastrobar.read'];

export const ACCESS_TTL_SECONDS = 60 * 60; // 1 hora
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 días (rota en cada uso)
export const CODE_TTL_SECONDS = 5 * 60;

export const ACCESS_PREFIX = 'gba_';
export const REFRESH_PREFIX = 'gbr_';

export function randomToken(prefix = ''): string {
  return prefix + randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** PKCE S256: BASE64URL(SHA256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** Direcciones de retorno válidas: https, o http sólo en localhost (clientes de escritorio). */
export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Permisos pedidos ∩ permisos que existen; si no pide nada, los de por defecto. */
export function normalizeScopes(requested: string | null | undefined): Scope[] {
  const asked = (requested ?? '').split(/\s+/).filter(Boolean);
  const known = asked.filter((s): s is Scope => Object.hasOwn(SCOPES, s));
  return known.length ? [...new Set(known)] : DEFAULT_SCOPES;
}

/** Nombre legible del asistente según su dirección de retorno (para la pantalla de permisos). */
export function assistantLabel(clientName: string | null | undefined, redirectUri: string): string {
  const host = (() => {
    try {
      return new URL(redirectUri).hostname;
    } catch {
      return '';
    }
  })();
  if (/(^|\.)claude\.(ai|com)$/.test(host) || /anthropic\.com$/.test(host)) return 'Claude';
  if (/(^|\.)(chatgpt|openai)\.com$/.test(host)) return 'ChatGPT';
  return (clientName || host || 'Asistente de IA').slice(0, 60);
}
