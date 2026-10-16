import Link from 'next/link';
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

  // Estación sin pantalla (Ajustes → Pantallas de cocina y barra): sus platos nacen entregados.
  const enabled = station === 'bar' ? ctx.tenant.uses_bar_screen : ctx.tenant.uses_kitchen_screen;
  if (enabled === false) {
    return (
      <main className="mx-auto max-w-md space-y-3 p-8 text-center">
        <h1 className="text-xl font-bold">Esta pantalla está desactivada</h1>
        <p className="text-zinc-500">
          {station === 'bar' ? 'La barra' : 'La cocina'} de {ctx.tenant.name} no usa pantalla: las comandas se dan por entregadas al enviarlas.
        </p>
        {ctx.role === 'admin' && (
          <Link href="/admin/settings" className="inline-block font-semibold text-brand-600 hover:underline">
            Activarla en Ajustes
          </Link>
        )}
      </main>
    );
  }
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
