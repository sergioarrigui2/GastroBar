import { NextResponse } from 'next/server';
import { listAiTools } from '@/lib/ai-tools';
import { toUserMessage } from '@/lib/errors';
import { getTenantContextFromRequest, TenantContextError } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/** GET /api/v1/ai-tools — catálogo de herramientas disponibles para el rol del token. */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContextFromRequest(request);
    return NextResponse.json({
      tenant: { id: ctx.tenant.id, slug: ctx.tenant.slug, currency: ctx.tenant.currency },
      role: ctx.role,
      tools: listAiTools(ctx.role),
    });
  } catch (error) {
    const status = error instanceof TenantContextError ? error.status : 500;
    return NextResponse.json({ error: toUserMessage(error) }, { status });
  }
}
