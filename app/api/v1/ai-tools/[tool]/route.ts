import { NextResponse } from 'next/server';
import { executeAiTool } from '@/lib/ai-tools';
import { toUserMessage } from '@/lib/errors';
import { getTenantContextFromRequest, TenantContextError } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

const STATUS_BY_ERROR = {
  unknown_tool: 404,
  invalid_input: 422,
  forbidden: 403,
  unauthenticated: 401,
  execution_error: 400,
} as const;

/**
 * POST /api/v1/ai-tools/:tool
 * Headers: Authorization: Bearer <access token de Supabase del usuario ai_agent>
 * Body: JSON con la entrada de la herramienta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;

  let input: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { ok: false, tool, error: { code: 'invalid_input', message: 'El cuerpo debe ser JSON válido' } },
        { status: 400 },
      );
    }
  }

  try {
    const ctx = await getTenantContextFromRequest(request);
    const result = await executeAiTool(tool, input, ctx);
    return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_ERROR[result.error.code] });
  } catch (error) {
    const status = error instanceof TenantContextError ? error.status : 500;
    const code = status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'execution_error';
    return NextResponse.json({ ok: false, tool, error: { code, message: toUserMessage(error) } }, { status });
  }
}
