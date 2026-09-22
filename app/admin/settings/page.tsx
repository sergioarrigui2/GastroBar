import { SettingsForm } from '@/components/admin/SettingsForm';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Ajustes' };

export default async function SettingsPage() {
  const ctx = await requirePageRole(['admin']);
  return <SettingsForm tenant={ctx.tenant} />;
}
