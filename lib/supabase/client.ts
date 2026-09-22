'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/env';
import type { Database } from '@/types/database';

let browserClient: SupabaseClient<Database> | undefined;

/**
 * Cliente de navegador (singleton). La sesión viaja en cookies compartidas con
 * el servidor, por lo que Realtime recibe sólo eventos permitidos por RLS.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    const env = getPublicEnv();
    browserClient = createBrowserClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }
  return browserClient;
}
