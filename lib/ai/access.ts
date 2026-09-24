import { AGENT_ORDER, type AgentId } from './agents.ts';

/**
 * Qué agentes tiene contratados un gastrobar. Fuente: tabla tenant_agents
 * (migración 011), que sólo cambia la consola de plataforma.
 * Sin fila = contratado (los gastrobares creados antes de 011 conservan todo).
 */
export type AgentRow = { agent: string; enabled: boolean; trial_until: string | null };

export type AgentStatus = 'contracted' | 'trial' | 'off';

export type AgentAccess = Record<AgentId, { status: AgentStatus; active: boolean; trialUntil: string | null }>;

export function resolveAgentAccess(rows: AgentRow[], now = new Date()): AgentAccess {
  const byAgent = new Map(rows.map((r) => [r.agent, r]));
  return Object.fromEntries(
    AGENT_ORDER.map((id) => {
      const row = byAgent.get(id);
      let status: AgentStatus = 'contracted';
      if (row) {
        if (!row.enabled) status = 'off';
        else if (row.trial_until) status = new Date(row.trial_until) > now ? 'trial' : 'off';
      }
      return [id, { status, active: status !== 'off', trialUntil: row?.trial_until ?? null }];
    }),
  ) as AgentAccess;
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  contracted: 'Contratado',
  trial: 'En prueba',
  off: 'No contratado',
};
