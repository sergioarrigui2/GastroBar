import type { z } from 'zod';
import type { TenantContext } from '@/lib/tenant-context';
import type { AppRole } from '@/types/domain';

/**
 * Definición agnóstica de framework de una herramienta para agentes de IA.
 * La misma definición se expone como Vercel AI SDK `tool()`, como herramienta MCP
 * (`tools/list` + `tools/call`) y como endpoint REST `/api/v1/ai-tools/:name`.
 */
export type AiToolDefinition<Schema extends z.ZodType = z.ZodType, Output = unknown> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  /** Roles del perfil autenticado que pueden ejecutarla (además de lo que imponga RLS). */
  allowedRoles: readonly AppRole[];
  /** true = no modifica datos (MCP annotations.readOnlyHint). */
  readOnly: boolean;
  execute: (input: z.output<Schema>, ctx: TenantContext) => Promise<Output>;
};

export type AiToolErrorCode = 'unknown_tool' | 'invalid_input' | 'forbidden' | 'unauthenticated' | 'execution_error';

export type AiToolResult<Output = unknown> =
  | { ok: true; tool: string; tenant: { id: string; slug: string }; data: Output }
  | { ok: false; tool: string; error: { code: AiToolErrorCode; message: string } };

/** Helper con inferencia completa del tipo de entrada a partir del esquema Zod. */
export function defineAiTool<Schema extends z.ZodType, Output>(
  definition: AiToolDefinition<Schema, Output>,
): AiToolDefinition<Schema, Output> {
  return definition;
}
