import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';
import type { TenantContext } from '@/lib/tenant-context';
import type { Database } from '@/types/database';
import { type AgentAccess, resolveAgentAccess } from './access';
import { AGENTS, type AgentId } from './agents';

/** Agentes contratados por el gastrobar de la sesión (memoizado por request). */
export const getAgentAccess = cache(async (ctx: TenantContext): Promise<AgentAccess> => {
  const { data, error } = await ctx.supabase.from('tenant_agents').select('agent, enabled, trial_until').eq('tenant_id', ctx.tenant.id);
  // Si la tabla aún no existe (migración 011 pendiente), todo sigue activo como antes.
  if (error) return resolveAgentAccess([]);
  return resolveAgentAccess(data ?? []);
});

/** Para tareas programadas con el rol de servicio. */
export async function getAgentAccessFor(admin: SupabaseClient<Database>, tenantId: string): Promise<AgentAccess> {
  const { data, error } = await admin.from('tenant_agents').select('agent, enabled, trial_until').eq('tenant_id', tenantId);
  if (error) return resolveAgentAccess([]);
  return resolveAgentAccess(data ?? []);
}

export class AgentNotContractedError extends Error {
  constructor(agent: AgentId) {
    super(`El ${AGENTS[agent].name} no está contratado en tu plan. Habla con tu asesor para activarlo.`);
  }
}

/** Corta una acción si el agente no está contratado (defensa en el servidor). */
export async function assertAgent(ctx: TenantContext, agent: AgentId): Promise<void> {
  const access = await getAgentAccess(ctx);
  if (!access[agent].active) throw new AgentNotContractedError(agent);
}
