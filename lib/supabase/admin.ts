import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv, getServiceRoleKey } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Cliente con service role: IGNORA RLS. Usar sólo en el servidor para tareas
 * administrativas acotadas (alta de personal) y siempre filtrando explícitamente
 * por el tenant del admin que ejecuta la acción.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
