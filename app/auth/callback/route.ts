import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Destino de los enlaces de confirmación de correo / magic link de Supabase.
 * Intercambia el `code` (PKCE) o el `token_hash` por una sesión y continúa.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const nextParam = searchParams.get('next') ?? '/onboarding';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/onboarding';

  const supabase = await createSupabaseServerClient();
  let ok = false;

  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && (type === 'signup' || type === 'email' || type === 'magiclink' || type === 'invite')) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  return NextResponse.redirect(new URL(ok ? next : '/login?error=confirm', origin));
}
