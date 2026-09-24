import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/** /api/v1 se autentica con Bearer token (agentes), no con cookies. */
/** /m/* es el menú QR público para clientes. */
/** /api/cron valida su propio secreto (CRON_SECRET). */
const PUBLIC_PATHS = ['/login', '/onboarding', '/auth', '/api/v1', '/api/cron', '/m'];

/** Refresca la sesión de Supabase en cada request y protege las rutas privadas. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims() valida la firma del JWT; nunca autorizar con getSession().
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Enlaces de Supabase cuyo redirect no está permitido caen en la Site URL con ?code=:
  // el callback los canjea y decide el destino (recuperación → nueva contraseña).
  const authCode = pathname === '/' ? request.nextUrl.searchParams.get('code') : null;
  if (authCode) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    url.search = '';
    url.searchParams.set('code', authCode);
    return NextResponse.redirect(url);
  }

  if (!isAuthenticated && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
