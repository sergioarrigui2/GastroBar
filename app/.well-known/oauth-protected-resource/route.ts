import { NextResponse } from 'next/server';
import { CORS_HEADERS, protectedResourceMetadata } from '@/lib/oauth/metadata';

export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(new URL(request.url).origin), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
