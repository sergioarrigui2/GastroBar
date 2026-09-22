import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getPublicEnv } from '@/lib/env';
import type { Database } from '@/types/database';

export type TypedSupabaseClient = SupabaseClient<Database>;

/** Cliente para Server Components, Server Actions y Route Handlers con sesión por cookies. */
export async function createSupabaseServerClient(): Promise<TypedSupabaseClient> {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Invocado desde un Server Component: el proxy ya refresca la sesión.
        }
      },
    },
  });
}

/**
 * Cliente autenticado con un access token (JWT) de Supabase, para agentes de IA e
 * integraciones que llaman a /api/v1 con `Authorization: Bearer <token>`.
 * RLS se evalúa con la identidad del token, exactamente igual que en la app.
 */
export function createSupabaseTokenClient(accessToken: string): TypedSupabaseClient {
  const env = getPublicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
