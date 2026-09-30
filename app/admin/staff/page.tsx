import { AgentNotice } from '@/components/admin/ai/AgentAvatar';
import { headers } from 'next/headers';
import { AiConnectionsPanel } from '@/components/admin/AiConnectionsPanel';
import { ApiKeysPanel } from '@/components/admin/ApiKeysPanel';
import { getStaffNotices } from '@/lib/services/agent-notices';
import { StaffManager } from '@/components/admin/StaffManager';
import { TerminalsPanel } from '@/components/admin/TerminalsPanel';
import { getTerminal } from '@/lib/staff/terminal';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Personal' };

export default async function StaffPage() {
  const ctx = await requirePageRole(['admin']);
  const [staffRes, keysRes, notices, pinsRes, devicesRes, thisTerminal, connRes, callsRes] = await Promise.all([
    ctx.supabase.from('profiles').select('*').eq('tenant_id', ctx.tenant.id).order('role').order('full_name'),
    ctx.supabase
      .from('api_keys')
      .select('id, profile_id, name, key_prefix, created_at, last_used_at, revoked_at')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false }),
    getStaffNotices(ctx),
    // staff_pins no es legible con la sesión (RLS sin políticas): sólo el estado, nunca el hash.
    createSupabaseAdminClient().from('staff_pins').select('profile_id, locked_until').eq('tenant_id', ctx.tenant.id),
    ctx.supabase
      .from('terminal_devices')
      .select('id, name, created_at, last_seen_at, revoked_at')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false }),
    getTerminal(),
    ctx.supabase
      .from('ai_connections')
      .select('id, client_name, created_at, last_used_at, granted_by, agent_profile_id, revoked_at')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false }),
    ctx.supabase
      .from('ai_connection_calls')
      .select('id, connection_id, tool, ok, created_at')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  if (staffRes.error) throw staffRes.error;
  if (keysRes.error) throw keysRes.error;
  if (pinsRes.error) throw pinsRes.error;
  if (devicesRes.error) throw devicesRes.error;
  if (connRes.error) throw connRes.error;
  if (callsRes.error) throw callsRes.error;
  const h = await headers();
  const mcpUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}/api/v1/mcp`;
  const staffName = new Map(staffRes.data.map((p) => [p.id, p.full_name]));
  const connName = new Map(connRes.data.map((c) => [c.id, c.client_name]));
  const dayAgo = Date.now() - 86_400_000;
  // Los agentes de conexiones de IA no reciben claves API (convertirían sólo lectura en acceso completo).
  const connectionAgents = new Set(connRes.data.map((c) => c.agent_profile_id));
  const connections = connRes.data.filter((c) => !c.revoked_at).map((c) => ({
    id: c.id,
    client_name: c.client_name,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
    granted_by_name: c.granted_by ? (staffName.get(c.granted_by) ?? null) : null,
    calls24h: callsRes.data.filter((x) => x.connection_id === c.id && new Date(x.created_at).getTime() > dayAgo).length,
  }));
  const calls = callsRes.data.slice(0, 30).map((c) => ({ id: c.id, connection: connName.get(c.connection_id) ?? 'Desconectado', tool: c.tool, ok: c.ok, created_at: c.created_at }));
  const now = Date.now();
  const pins = Object.fromEntries(
    pinsRes.data.map((p) => [p.profile_id, { locked: Boolean(p.locked_until && new Date(p.locked_until).getTime() > now) }]),
  );

  return (
    <div className="space-y-6">
      <AgentNotice agent="vigia" headline="lo que noté en el equipo (30 días)" items={notices} />
      <StaffManager staff={staffRes.data} currentUserId={ctx.userId} pins={pins} />
      <TerminalsPanel
        devices={devicesRes.data}
        currentDeviceId={thisTerminal?.tenantId === ctx.tenant.id ? thisTerminal.id : null}
        locale={ctx.tenant.locale}
        timezone={ctx.tenant.timezone}
      />
      <AiConnectionsPanel mcpUrl={mcpUrl} connections={connections} calls={calls} locale={ctx.tenant.locale} timezone={ctx.tenant.timezone} />
      <ApiKeysPanel
        keys={keysRes.data}
        agents={staffRes.data.filter((p) => p.role === 'ai_agent' && p.is_active && !connectionAgents.has(p.id))}
        locale={ctx.tenant.locale}
        timezone={ctx.tenant.timezone}
      />
    </div>
  );
}
