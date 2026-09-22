import { notFound } from 'next/navigation';
import { KDSDisplay } from '@/components/kds/KDSDisplay';
import { getKdsTickets } from '@/lib/services/orders';
import { requirePageRole } from '@/lib/tenant-context';
import { stationSchema } from '@/lib/validations/order';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ station: string }> }) {
  const { station } = await params;
  return { title: station === 'bar' ? 'KDS Barra' : 'KDS Cocina' };
}

export default async function KdsPage({ params }: { params: Promise<{ station: string }> }) {
  const parsed = stationSchema.safeParse((await params).station);
  if (!parsed.success) notFound();
  const station = parsed.data;

  // Ruteo por rol: la pantalla de barra sólo para barra y la de cocina sólo para cocina (admin ve ambas).
  const ctx = await requirePageRole(station === 'bar' ? ['admin', 'bar'] : ['admin', 'kitchen']);
  const tickets = await getKdsTickets(ctx, station);

  return (
    <KDSDisplay
      station={station}
      tenantId={ctx.tenant.id}
      tenantName={ctx.tenant.name}
      sla={{ warningMinutes: ctx.tenant.kds_warning_minutes, lateMinutes: ctx.tenant.kds_late_minutes }}
      initialTickets={tickets}
    />
  );
}
