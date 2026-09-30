import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type CachedSession = { accessToken: string; expiresAt: number };

/** Sesiones por usuario agente, reutilizadas mientras el access token siga vigente (por instancia). */
const sessionCache = new Map<string, CachedSession>();

/**
 * Access token de Supabase para un usuario ai_agent (claves API y conectores de IA):
 * enlace mágico generado por el servidor (no envía correo) y canjeado de inmediato.
 * Así todo lo que haga el agente pasa por RLS con su propia identidad.
 */
export async function accessTokenForUser(userId: string): Promise<string | null> {
  const cached = sessionCache.get(userId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;

  const admin = createSupabaseAdminClient();
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userData.user?.email) return null;

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: userData.user.email });
  if (linkError) throw linkError;

  const env = getPublicEnv();
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (verifyError || !verified.session) throw verifyError ?? new Error('No se pudo abrir sesión para el agente');

  const session: CachedSession = {
    accessToken: verified.session.access_token,
    expiresAt: (verified.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
  sessionCache.set(userId, session);
  return session.accessToken;
}

export function forgetAgentSession(userId: string): void {
  sessionCache.delete(userId);
}
