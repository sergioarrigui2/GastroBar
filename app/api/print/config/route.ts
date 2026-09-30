import { NextResponse } from 'next/server';
import { getPublicEnv } from '@/lib/env';

/**
 * Datos públicos para que GastroBar Print se conecte (los mismos que ya usa el
 * navegador). La seguridad está en el código de vinculación y el token de estación.
 */
export function GET() {
  const env = getPublicEnv();
  return NextResponse.json({ supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
}
