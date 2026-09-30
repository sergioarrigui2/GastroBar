import { NextResponse } from 'next/server';
import { CORS_HEADERS } from '@/lib/oauth/metadata';
import { OAuthError, registerClient } from '@/lib/oauth/server';

/** Registro dinámico de clientes (RFC 7591): Claude / ChatGPT se registran solos al agregar el conector. */
export async function POST(request: Request) {
  let meta: Record<string, unknown>;
  try {
    meta = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'JSON inválido' }, { status: 400, headers: CORS_HEADERS });
  }
  try {
    return NextResponse.json(await registerClient(meta), { status: 201, headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json({ error: error.code, error_description: error.message }, { status: error.status, headers: CORS_HEADERS });
    }
    console.error('[oauth/register]', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: CORS_HEADERS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
