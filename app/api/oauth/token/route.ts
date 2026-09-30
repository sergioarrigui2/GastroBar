import { NextResponse } from 'next/server';
import { CORS_HEADERS } from '@/lib/oauth/metadata';
import { exchangeCode, OAuthError, refreshTokens } from '@/lib/oauth/server';

const noStore = { ...CORS_HEADERS, 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/** Lee el cuerpo (form o JSON) y las credenciales del cliente (Basic o en el cuerpo). */
async function readRequest(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';
  const body: Record<string, string> = {};
  if (type.includes('application/json')) {
    for (const [k, v] of Object.entries((await request.json()) as Record<string, unknown>)) if (typeof v === 'string') body[k] = v;
  } else {
    for (const [k, v] of new URLSearchParams(await request.text())) body[k] = v;
  }
  const basic = /^Basic\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (basic) {
    const [id, secret] = Buffer.from(basic[1]!, 'base64').toString().split(':');
    body.client_id ??= decodeURIComponent(id ?? '');
    body.client_secret ??= decodeURIComponent(secret ?? '');
  }
  return body;
}

export async function POST(request: Request) {
  try {
    const b = await readRequest(request);
    if (!b.client_id) throw new OAuthError('invalid_client', 'Falta client_id', 401);
    if (b.grant_type === 'authorization_code') {
      if (!b.code || !b.redirect_uri || !b.code_verifier) throw new OAuthError('invalid_request', 'Faltan code, redirect_uri o code_verifier');
      const tokens = await exchangeCode({
        code: b.code,
        clientId: b.client_id,
        clientSecret: b.client_secret || null,
        redirectUri: b.redirect_uri,
        codeVerifier: b.code_verifier,
      });
      return NextResponse.json(tokens, { headers: noStore });
    }
    if (b.grant_type === 'refresh_token') {
      if (!b.refresh_token) throw new OAuthError('invalid_request', 'Falta refresh_token');
      const tokens = await refreshTokens({ refreshToken: b.refresh_token, clientId: b.client_id, clientSecret: b.client_secret || null });
      return NextResponse.json(tokens, { headers: noStore });
    }
    throw new OAuthError('unsupported_grant_type', 'grant_type no soportado');
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json({ error: error.code, error_description: error.message }, { status: error.status, headers: noStore });
    }
    console.error('[oauth/token]', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: noStore });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
