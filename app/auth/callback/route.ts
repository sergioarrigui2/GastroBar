import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Destino de los enlaces de Supabase (confirmación de correo, magic link,
 * recuperación). Intercambia el `code` (PKCE) o el `token_hash` por una sesión y
 * continúa. Las sesiones de recuperación siempre van a fijar la nueva contraseña.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  const supabase = await createSupabaseServerClient();
  let ok = false;

  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && (type === 'signup' || type === 'email' || type === 'magiclink' || type === 'invite' || type === 'recovery')) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  if (!ok) {
    // Supabase confirma el correo antes de redirigir: aunque el intercambio falle
    // (p. ej. el enlace se abrió en otro navegador), la cuenta ya puede ingresar.
    const fallback = next === '/auth/reset' ? '/auth/forgot?error=expired' : '/login?error=confirm';
    return NextResponse.redirect(new URL(fallback, origin));
  }

  const { data } = await supabase.auth.getClaims();
  const amr = (data?.claims as { amr?: { method?: string }[] } | undefined)?.amr ?? [];
  const isRecovery = type === 'recovery' || amr.some((entry) => entry.method === 'recovery');

  return NextResponse.redirect(new URL(isRecovery ? '/auth/reset' : next, origin));
}
