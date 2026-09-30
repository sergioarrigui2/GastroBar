import { CORS_HEADERS } from '@/lib/oauth/metadata';
import { revokeToken } from '@/lib/oauth/server';

/** Revocación (RFC 7009): siempre responde 200, exista o no el token. */
export async function POST(request: Request) {
  const params = new URLSearchParams(await request.text());
  const token = params.get('token');
  if (token) await revokeToken(token).catch(() => undefined);
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
