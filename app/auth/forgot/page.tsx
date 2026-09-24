import Link from 'next/link';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata = { title: 'Recuperar contraseña' };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
          <p className="mt-1 text-sm text-zinc-500">Te enviaremos un enlace para crear una nueva</p>
        </div>
        {error === 'expired' && (
          <p className="mb-4 rounded-xl bg-red-100 p-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
            El enlace no es válido o expiró. Solicita uno nuevo.
          </p>
        )}
        <ForgotPasswordForm />
        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Volver a ingresar
          </Link>
        </p>
      </div>
    </main>
  );
}
