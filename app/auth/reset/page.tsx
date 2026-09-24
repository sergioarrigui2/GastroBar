import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata = { title: 'Nueva contraseña' };

export default function ResetPasswordPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Nueva contraseña</h1>
          <p className="mt-1 text-sm text-zinc-500">Mínimo 10 caracteres</p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
