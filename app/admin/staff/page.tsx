import { AgentNotice } from '@/components/admin/ai/AgentAvatar';
import { ApiKeysPanel } from '@/components/admin/ApiKeysPanel';
import { getStaffNotices } from '@/lib/services/agent-notices';
import { StaffManager } from '@/components/admin/StaffManager';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Personal' };

export default async function StaffPage() {
  const ctx = await requirePageRole(['admin']);
  const [staffRes, keysRes, notices] = await Promise.all([
    ctx.supabase.from('profiles').select('*').eq('tenant_id', ctx.tenant.id).order('role').order('full_name'),
    ctx.supabase
      .from('api_keys')
      .select('id, profile_id, name, key_prefix, created_at, last_used_at, revoked_at')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false }),
    getStaffNotices(ctx),
  ]);
  if (staffRes.error) throw staffRes.error;
  if (keysRes.error) throw keysRes.error;

  return (
    <div className="space-y-6">
      <AgentNotice agent="vigia" headline="lo que noté en el equipo (30 días)" items={notices} />
      <StaffManager staff={staffRes.data} currentUserId={ctx.userId} />
      <ApiKeysPanel
        keys={keysRes.data}
        agents={staffRes.data.filter((p) => p.role === 'ai_agent' && p.is_active)}
        locale={ctx.tenant.locale}
        timezone={ctx.tenant.timezone}
      />
    </div>
  );
}
