import { NextResponse } from 'next/server';
import { executeAiTool, listAiTools } from '@/lib/ai-tools';
import { toUserMessage } from '@/lib/errors';
import { getTenantContextFromRequest, TenantContextError, type TenantContext } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/**
 * Servidor MCP mínimo sobre Streamable HTTP en modo stateless (respuestas JSON,
 * sin sesiones ni SSE). Compatible con clientes MCP que envían:
 *   Authorization: Bearer <access token de Supabase>
 * Métodos: initialize, notifications/initialized, ping, tools/list, tools/call.
 */
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
const SERVER_INFO = { name: 'gastrobar-pos', title: 'GastroBar POS', version: '0.1.0' };

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: Record<string, unknown> };

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message },
});

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (value as { method?: unknown }).method === 'string'
  );
}

async function handle(message: JsonRpcRequest, ctx: TenantContext) {
  const id = message.id ?? null;

  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.find((v) => v === requested) ?? SUPPORTED_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          `Herramientas POS del gastrobar "${ctx.tenant.name}" (moneda ${ctx.tenant.currency}). ` +
          'Consulta mesas y menú antes de crear comandas; usa process_split_payment_tool en modo ' +
          '"calculate" y confirma antes de registrar pagos.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: listAiTools(ctx.role) });
    case 'tools/call': {
      const name = message.params?.name;
      if (typeof name !== 'string') return rpcError(id, -32602, 'params.name es requerido');
      const result = await executeAiTool(name, message.params?.arguments ?? {}, ctx);
      if (!result.ok && result.error.code === 'unknown_tool') return rpcError(id, -32602, result.error.message);
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result.ok ? result.data : result.error) }],
        structuredContent: result.ok ? result.data : undefined,
        isError: !result.ok,
      });
    }
    default:
      return rpcError(id, -32601, `Método no soportado: ${message.method}`);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }
  if (!isJsonRpcRequest(body)) {
    return NextResponse.json(rpcError(null, -32600, 'Invalid Request'), { status: 400 });
  }

  let ctx: TenantContext;
  try {
    ctx = await getTenantContextFromRequest(request);
  } catch (error) {
    const status = error instanceof TenantContextError ? error.status : 500;
    return NextResponse.json(rpcError(body.id ?? null, -32001, toUserMessage(error)), {
      status,
      headers: status === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined,
    });
  }

  // Notificaciones (sin id): se aceptan sin cuerpo de respuesta.
  if (body.id === undefined) return new Response(null, { status: 202 });

  return NextResponse.json(await handle(body, ctx));
}

export function GET() {
  // Modo stateless: no se ofrece stream SSE iniciado por el servidor.
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
