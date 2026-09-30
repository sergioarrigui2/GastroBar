'use client';

import { useActionState } from 'react';
import { activateTerminalAction, type TerminalFormState } from '@/app/actions/terminal';
import { Button, Input, Label } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** El admin autoriza el dispositivo en el que está como terminal compartida. */
export function ActivateTerminalForm() {
  const [state, action, pending] = useActionState<TerminalFormState, FormData>(activateTerminalAction, null);
  return (
    <form action={action} className="space-y-3 text-left">
      <div>
        <Label htmlFor="terminal_name">Nombre de este dispositivo</Label>
        <Input id="terminal_name" name="name" placeholder="Tablet salón" maxLength={60} required />
      </div>
      {state && (
        <p role="status" className={cn('text-sm font-medium', state.ok ? 'text-emerald-600' : 'text-red-600')}>
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Autorizando…' : 'Autorizar como terminal'}
      </Button>
    </form>
  );
}
