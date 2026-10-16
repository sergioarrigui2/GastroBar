import Link from 'next/link';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { homeFor, getTenantContext } from '@/lib/tenant-context';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Mi perfil' };
export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  cashier: 'Caja',
  waiter: 'Mesero',
  kitchen: 'Cocina',
  bar: 'Barra',
};

/** Datos de la persona que ingresó: nombre, teléfono y foto. Disponible para todo el personal. */
export default async function ProfilePage() {
  const ctx = await getTenantContext().catch(() => null);
  if (!ctx) redirect('/login?next=/perfil');
  const { data } = await ctx.supabase.auth.getUser();
  const email = data.user?.email && !data.user.email.endsWith('.invalid') ? data.user.email : null;

  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-lg px-4 pt-4">
        <Link href={homeFor(ctx)} className="text-sm font-semibold text-brand-600 hover:underline">
          ← Volver
        </Link>
      </div>
      <ProfileForm
        tenantId={ctx.tenant.id}
        userId={ctx.userId}
        roleLabel={ROLE_LABELS[ctx.role] ?? ctx.role}
        email={email}
        initial={{ full_name: ctx.profile.full_name, phone: ctx.profile.phone, avatar_url: ctx.profile.avatar_url }}
      />
    </main>
  );
}
