import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { RecoveryRedirect } from './RecoveryRedirect';

export const metadata = { title: 'Ingresar' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-zinc-900 text-2xl dark:bg-zinc-800">
            🍸
          </div>
          <h1 className="text-2xl font-bold">GastroBar POS</h1>
          <p className="mt-1 text-sm text-zinc-500">Ingresa con tu usuario del gastrobar</p>
        </div>
        {error === 'confirm' && (
          <p className="mb-4 rounded-xl bg-red-100 p-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
            No pudimos abrir tu sesión con ese enlace. Si acabas de confirmar tu correo, ingresa aquí con tu correo y
            contraseña; si aún no terminas de crear tu gastrobar, te llevaremos a hacerlo.
          </p>
        )}
        {(error === 'suspended' || error === 'no_account' || error === 'inactive') && (
          <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            {error === 'suspended'
              ? 'Tu gastrobar está suspendido. Comunícate con tu asesor de GastroBar para reactivarlo.'
              : error === 'inactive'
                ? 'Tu usuario está desactivado. Habla con el administrador de tu gastrobar.'
                : 'Este usuario no está asociado a ningún gastrobar. Si eres cliente, pide a tu asesor que te dé acceso.'}
          </p>
        )}
        {error === 'ai_agent' && (
          <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            Los usuarios <b>ai_agent</b> sólo acceden por API (/api/v1/mcp o /api/v1/ai-tools).
          </p>
        )}
        <RecoveryRedirect />
        <LoginForm next={next ?? '/'} />
        <p className="mt-4 text-center text-sm">
          <Link href="/auth/forgot" className="text-zinc-500 hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
        <p className="mt-6 text-center text-sm text-zinc-500">
          ¿Quieres GastroBar para tu negocio?{' '}
          <Link href="/onboarding" className="font-semibold text-brand-600 hover:underline">
            Solicita una demo
          </Link>
        </p>
      </div>
    </main>
  );
}
