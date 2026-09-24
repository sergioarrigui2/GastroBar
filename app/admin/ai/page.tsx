import { AiTeamView } from '@/components/admin/ai/AiTeamView';
import { getAiTeamOverview } from '@/lib/services/ai-team';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Equipo IA' };

export default async function AiTeamPage() {
  const ctx = await requirePageRole(['admin']);
  return <AiTeamView overview={await getAiTeamOverview(ctx)} tenant={ctx.tenant} />;
}
