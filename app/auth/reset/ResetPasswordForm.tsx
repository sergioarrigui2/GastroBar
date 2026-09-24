'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { updatePasswordAction, type AuthFormState } from '@/app/actions/auth';
import { Button, Input, Label } from '@/components/ui/primitives';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type SessionState = 'checking' | 'ready' | 'missing';

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(updatePasswordAction, null);
  const [session, setSession] = useState<SessionState>('checking');

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    // Enlaces con flujo implícito (p. ej. enviados desde el panel de Supabase) traen los tokens en el hash.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');

    const resolve = async () => {
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        window.history.replaceState(null, '', window.location.pathname);
        setSession(error ? 'missing' : 'ready');
        return;
      }
      const { data } = await supabase.auth.getClaims();
      setSession(data?.claims?.sub ? 'ready' : 'missing');
    };
    void resolve();
  }, []);

  if (session === 'checking') return <p className="text-center text-sm text-zinc-500">Verificando enlace…</p>;

  if (session === 'missing') {
    return (
      <div className="space-y-4 text-center">
        <p className="rounded-xl bg-red-100 p-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
          El enlace no es válido o expiró.
        </p>
        <Link href="/auth/forgot" className="font-semibold text-brand-600 hover:underline">
          Solicitar un enlace nuevo
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="password">Nueva contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} required />
      </div>
      <div>
        <Label htmlFor="confirm">Repite la contraseña</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={72} required />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar y entrar'}
      </Button>
    </form>
  );
}
