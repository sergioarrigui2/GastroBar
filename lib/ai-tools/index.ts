import 'server-only';

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { toUserMessage } from '@/lib/errors';
import { TenantContextError, type TenantContext } from '@/lib/tenant-context';
import type { AppRole } from '@/types/domain';
import { createOrderTool } from './tools/create-order';
import { getBarMetricsTool } from './tools/get-bar-metrics';
import { getBusinessAnalysisTool } from './tools/get-business-analysis';
import { getMenuAvailabilityTool } from './tools/get-menu-availability';
import { getInventoryStatusTool } from './tools/get-inventory-status';
import { getMenuCostsTool } from './tools/get-menu-costs';
import { getTableStatusTool } from './tools/get-table-status';
import { processSplitPaymentTool } from './tools/process-split-payment';
import { fetchTool, searchTool } from './tools/search-fetch';
import type { AiToolDefinition, AiToolResult } from './types';

export type { AiToolDefinition, AiToolResult } from './types';
export { createOrderInput } from './tools/create-order';
export { getBarMetricsInput } from './tools/get-bar-metrics';
export { getBusinessAnalysisInput } from './tools/get-business-analysis';
export { getMenuAvailabilityInput } from './tools/get-menu-availability';
export { getTableStatusInput } from './tools/get-table-status';
export { processSplitPaymentInput } from './tools/process-split-payment';

/** Registro central de herramientas para agentes de IA. */
export const aiTools = {
  get_table_status: getTableStatusTool,
  get_menu_availability: getMenuAvailabilityTool,
  create_order_tool: createOrderTool,
  process_split_payment_tool: processSplitPaymentTool,
  get_bar_metrics_tool: getBarMetricsTool,
  get_business_analysis_tool: getBusinessAnalysisTool,
  get_menu_costs: getMenuCostsTool,
  get_inventory_status: getInventoryStatusTool,
  search: searchTool,
  fetch: fetchTool,
} as const;

export type AiToolName = keyof typeof aiTools;
export type AiToolInput<N extends AiToolName> = z.input<(typeof aiTools)[N]['inputSchema']>;
export type AiToolOutput<N extends AiToolName> = Awaited<ReturnType<(typeof aiTools)[N]['execute']>>;

// Vista homogénea del registro para iterarlo sin perder seguridad de tipos en cada herramienta.
const toolList = Object.values(aiTools) as unknown as AiToolDefinition[];

export function isAiToolName(name: string): name is AiToolName {
  return Object.hasOwn(aiTools, name);
}

function toolsForRole(role: AppRole, readOnlyOnly = false): AiToolDefinition[] {
  return toolList.filter((t) => t.allowedRoles.includes(role) && (!readOnlyOnly || t.readOnly));
}

/** Un asistente conectado por OAuth sólo tiene permiso de lectura: nunca ejecuta herramientas que escriben. */
export function isReadOnlyContext(ctx: TenantContext): boolean {
  return Boolean(ctx.connection) && !ctx.connection!.scopes.includes('gastrobar.write');
}

/**
 * Punto único de ejecución: valida el rol, parsea la entrada con Zod y ejecuta
 * contra Supabase con el cliente del usuario (RLS limita todo a su tenant).
 * Nunca lanza: devuelve un resultado serializable apto para el agente.
 */
export async function executeAiTool(name: string, rawInput: unknown, ctx: TenantContext): Promise<AiToolResult> {
  if (!isAiToolName(name)) {
    return { ok: false, tool: name, error: { code: 'unknown_tool', message: `Herramienta desconocida: ${name}` } };
  }
  const definition = aiTools[name] as unknown as AiToolDefinition;

  if (isReadOnlyContext(ctx) && !definition.readOnly) {
    return { ok: false, tool: name, error: { code: 'forbidden', message: 'Esta conexión es de sólo lectura' } };
  }

  if (!definition.allowedRoles.includes(ctx.role)) {
    return {
      ok: false,
      tool: name,
      error: { code: 'forbidden', message: `El rol "${ctx.role}" no puede usar ${name}` },
    };
  }

  const parsed = definition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { ok: false, tool: name, error: { code: 'invalid_input', message: toUserMessage(parsed.error) } };
  }

  try {
    const data = await definition.execute(parsed.data, ctx);
    return { ok: true, tool: name, tenant: { id: ctx.tenant.id, slug: ctx.tenant.slug }, data };
  } catch (error) {
    const code =
      error instanceof TenantContextError
        ? error.status === 401
          ? 'unauthenticated'
          : 'forbidden'
        : error instanceof z.ZodError
          ? 'invalid_input'
          : 'execution_error';
    return { ok: false, tool: name, error: { code, message: toUserMessage(error) } };
  }
}

/** Descriptor MCP (`tools/list`) con JSON Schema generado desde Zod. */
export type McpToolDescriptor = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
};

export function listAiTools(role?: AppRole, readOnlyOnly = false): McpToolDescriptor[] {
  return (role ? toolsForRole(role, readOnlyOnly) : toolList.filter((t) => !readOnlyOnly || t.readOnly)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
    annotations: {
      title: t.title,
      readOnlyHint: t.readOnly,
      destructiveHint: false,
      openWorldHint: false,
    },
  }));
}

/**
 * Adaptador Vercel AI SDK: devuelve un ToolSet listo para `generateText` /
 * `streamText` con el contexto de tenant ya inyectado. Ejemplo:
 *
 *   const ctx = await getTenantContext();
 *   const result = streamText({ model, tools: createVercelAiTools(ctx), prompt });
 */
export function createVercelAiTools(ctx: TenantContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const definition of toolsForRole(ctx.role, isReadOnlyContext(ctx))) {
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: (input: unknown) => executeAiTool(definition.name, input, ctx),
    });
  }
  return tools;
}
