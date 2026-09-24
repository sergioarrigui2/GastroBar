import { notFound } from 'next/navigation';
import { AgentProfileView } from '@/components/admin/ai/AgentProfileView';
import { MessengerConfig } from '@/components/admin/ai/MessengerConfig';
import { AGENTS, isAgentId } from '@/lib/ai/agents';
import { getAgentAccess } from '@/lib/ai/entitlements';
import { emailFrom, isEmailConfigured } from '@/lib/messenger/resend';
import { getAgentStats } from '@/lib/services/agent-stats';
import { buildTenantDigest, getMessengerOverview } from '@/lib/services/messenger';
import { requirePageRole } from '@/lib/tenant-context';

export async function generateMetadata({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  return { title: isAgentId(agent) ? AGENTS[agent].name : 'Agente' };
}

export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const ctx = await requirePageRole(['admin']);
  const { agent } = await params;
  if (!isAgentId(agent)) notFound();

  const access = (await getAgentAccess(ctx))[agent];
  // Las cifras son un extra: si fallan (p. ej. faltan migraciones), la presentación se ve igual.
  const stats = access.active
    ? await getAgentStats(ctx, agent).catch((error: unknown) => {
        console.error('[agent-stats]', error);
        return [];
      })
    : [];

  let messenger = null;
  if (agent === 'mensajero' && access.active) {
    const [overview, preview] = await Promise.all([
      getMessengerOverview(ctx),
      buildTenantDigest(ctx.supabase, ctx.tenant, false).catch((error: unknown) => {
        console.error('[digest]', error);
        return null;
      }),
    ]);
    messenger = (
      <MessengerConfig
        {...overview}
        preview={preview}
        emailConfigured={isEmailConfigured()}
        sandboxSender={emailFrom().includes('resend.dev')}
        locale={ctx.tenant.locale}
        timezone={ctx.tenant.timezone}
      />
    );
  }

  return (
    <AgentProfileView
      agent={AGENTS[agent]}
      stats={stats}
      status={access.status}
      trialLabel={
        access.trialUntil
          ? new Intl.DateTimeFormat(ctx.tenant.locale, { timeZone: ctx.tenant.timezone, day: 'numeric', month: 'long' }).format(new Date(access.trialUntil))
          : null
      }
    >
      {messenger}
    </AgentProfileView>
  );
}
