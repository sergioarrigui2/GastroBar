import Link from 'next/link';
import { ActivateTerminalForm } from '@/components/terminal/ActivateTerminalForm';
import { TerminalPad } from '@/components/terminal/TerminalPad';
import { getTerminal, listTerminalStaff } from '@/lib/staff/terminal';
import { getTenantContext, HOME_BY_ROLE } from '@/lib/tenant-context';

export const metadata = { title: 'Terminal' };
export const dynamic = 'force-dynamic';

/** Pantalla de la tablet compartida del gastrobar: el personal entra con su PIN. */
export default async function TerminalPage() {
  const terminal = await getTerminal();
  const current = await getTenantContext().catch(() => null);

  if (!terminal) {
    return (
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <div className="w-full max-w-sm space-y-5 text-center">
          <h1 className="text-2xl font-bold">Terminal compartida</h1>
          {current?.role === 'admin' ? (
            <>
              <p className="text-sm text-zinc-500">
                Autoriza este dispositivo para que tu equipo de <b>{current.tenant.name}</b> entre con su PIN. Hazlo sólo en
                tablets o computadores del negocio.
              </p>
              <ActivateTerminalForm />
            </>
          ) : (
            <p className="text-sm text-zinc-500">
              Este dispositivo no está autorizado como terminal. Un administrador debe ingresar aquí con su correo y
              activarlo desde <b>Personal → Terminales</b>.
            </p>
          )}
          <Link href={current ? HOME_BY_ROLE[current.role] : '/login'} className="inline-block text-sm font-semibold text-brand-600 hover:underline">
            {current ? 'Volver' : 'Ingresar con correo'}
          </Link>
        </div>
      </main>
    );
  }

  const staff = await listTerminalStaff(terminal);
  const sameTenant = current?.tenant.id === terminal.tenantId;

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{terminal.name}</p>
          <h1 className="text-2xl font-bold">{terminal.tenantName}</h1>
          <p className="text-sm text-zinc-500">Toca tu nombre para empezar tu turno</p>
        </div>
        {current && sameTenant && (
          <Link href={HOME_BY_ROLE[current.role]} className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold dark:bg-zinc-800">
            Seguir como {current.profile.full_name}
          </Link>
        )}
      </header>
      <TerminalPad staff={staff} />
      <footer className="mt-auto text-center text-sm">
        <Link href="/login" className="text-zinc-500 hover:underline">
          Administrador: ingresar con correo
        </Link>
      </footer>
    </main>
  );
}
