'use client';

import { useActionState, useState } from 'react';
import { onboardingAction, type AuthFormState } from '@/app/actions/auth';
import { Button, Input, Label } from '@/components/ui/primitives';

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export function OnboardingForm({ needsCredentials }: { needsCredentials: boolean }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(onboardingAction, null);
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="full_name">Tu nombre</Label>
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </div>
      <div>
        <Label htmlFor="business_name">Nombre del gastrobar</Label>
        <Input
          id="business_name"
          name="business_name"
          required
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </div>
      <div>
        <Label htmlFor="slug">Identificador</Label>
        <Input
          id="slug"
          name="slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(slugify(e.target.value));
          }}
          pattern="[a-z0-9][a-z0-9\-]{1,46}[a-z0-9]"
          required
        />
      </div>
      {needsCredentials && (
        <>
          <div>
            <Label htmlFor="email">Correo</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <Label htmlFor="password">Contraseña (mín. 10)</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          </div>
        </>
      )}
      {state?.error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {state.error}
        </p>
      )}
      {state?.info && (
        <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
          {state.info}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creando…' : 'Crear gastrobar'}
      </Button>
    </form>
  );
}
