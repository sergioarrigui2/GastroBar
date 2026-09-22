import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

type PublicEnv = z.infer<typeof publicSchema>;

let cached: PublicEnv | undefined;

/**
 * Variables públicas. Se referencian de forma literal para que Next.js las
 * incruste en el bundle del navegador; se validan de forma perezosa para no
 * romper el build cuando aún no están definidas.
 */
export function getPublicEnv(): PublicEnv {
  cached ??= publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return cached;
}

/** Sólo servidor. Lanza si falta la service role key. */
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurada');
  return key;
}
