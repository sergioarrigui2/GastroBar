'use client';

import { useActionState } from 'react';
import { requestPasswordResetAction, type AuthFormState } from '@/app/actions/auth';
import { Button, Input, Label } from '@/components/ui/primitives';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestPasswordResetAction, null);

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="email">Correo</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {state.error}
        </p>
      )}
      {state?.info && (
        <p role="status" className="rounded-xl bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200">
          {state.info}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar enlace'}
      </Button>
    </form>
  );
}
