import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { accessTokenForUser } from '@/lib/agent-session';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Claves API de larga duración para agentes de IA.
 *
 * Formato: `gbk_<43 caracteres base64url>` (256 bits). En la base sólo se guarda
 * el SHA-256. Al usarla, el servidor valida el hash (y que no esté revocada) y
 * obtiene una sesión de Supabase del usuario `ai_agent` dueño de la clave, así
 * que TODO lo que haga el agente sigue pasando por RLS con su propia identidad.
 */
export const API_KEY_PREFIX = 'gbk_';

export function isApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

const LAST_USED_THROTTLE_MS = 5 * 60_000;

/**
 * Devuelve un access token de Supabase para la clave, o null si la clave no
 * existe o está revocada. La revocación se comprueba en CADA request.
 */
export async function accessTokenForApiKey(key: string): Promise<string | null> {
  const hash = hashApiKey(key);
  const admin = createSupabaseAdminClient();

  const { data: row, error } = await admin
    .from('api_keys')
    .select('id, profile_id, revoked_at, last_used_at')
    .eq('key_hash', hash)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.revoked_at) return null;

  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > LAST_USED_THROTTLE_MS) {
    void admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id);
  }

  return accessTokenForUser(row.profile_id);
}
