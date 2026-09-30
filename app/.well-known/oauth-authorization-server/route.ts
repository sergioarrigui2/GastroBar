import { NextResponse } from 'next/server';
import { authorizationServerMetadata, CORS_HEADERS } from '@/lib/oauth/metadata';

export function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(new URL(request.url).origin), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
