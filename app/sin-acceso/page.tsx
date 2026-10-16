import { redirect } from 'next/navigation';
import { signOutAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/primitives';
import { getTenantContext, homeFor, TenantContextError } from '@/lib/tenant-context';

export const metadata = { title: 'Sin permisos' };
export const dynamic = 'force-dynamic';

/** Destino de un supervisor al que todavía no se le asignó ningún permiso. */
export default async function NoAccessPage() {
  let name = '';
  try {
    const ctx = await getTenantContext();
    // Si ya tiene algo que hacer, no se queda aquí.
    const home = homeFor(ctx);
    if (home !== '/sin-acceso') redirect(home);
    name = ctx.profile.full_name;
  } catch (error) {
    if (error instanceof TenantContextError) redirect('/login');
    throw error;
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-bold">Hola, {name}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Tu usuario todavía no tiene permisos asignados. Pídele al administrador que te los active desde <b>Personal</b> y vuelve a entrar.
        </p>
        <form action={signOutAction}>
          <Button type="submit" variant="secondary" className="w-full">
            Cerrar sesión
          </Button>
        </form>
      </div>
    </main>
  );
}
