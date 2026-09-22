'use client';

import { Bot } from 'lucide-react';
import { useActionState, useTransition } from 'react';
import { createStaffAction, setStaffActiveAction, type FormState } from '@/app/actions/admin';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { AppRole, Profile } from '@/types/domain';

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrador',
  cashier: 'Caja',
  waiter: 'Mesero',
  kitchen: 'Cocina',
  bar: 'Barra',
  ai_agent: 'Agente IA',
};

export function StaffManager({ staff, currentUserId }: { staff: Profile[]; currentUserId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createStaffAction, null);
  const [toggling, startToggle] = useTransition();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Personal</h1>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {staff.map((p) => (
              <li key={p.id} className={cn('flex items-center gap-3 py-3', !p.is_active && 'opacity-50')}>
                <span className="grid size-10 place-items-center rounded-full bg-zinc-100 font-bold dark:bg-zinc-800">
                  {p.role === 'ai_agent' ? <Bot className="size-5" /> : p.full_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.full_name}</span>
                  <Badge className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{ROLE_LABELS[p.role]}</Badge>
                </span>
                {p.id !== currentUserId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={toggling}
                    onClick={() => startToggle(async () => void (await setStaffActiveAction(p.id, !p.is_active)))}
                  >
                    {p.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Agregar usuario</h2>
          <form action={action} className="space-y-3">
            <div>
              <Label htmlFor="full_name">Nombre</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div>
              <Label htmlFor="email">Correo</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="password">Contraseña inicial (mín. 10)</Label>
              <Input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
            </div>
            <div>
              <Label htmlFor="role">Rol</Label>
              <Select id="role" name="role" defaultValue="waiter">
                {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-zinc-500">
                Los agentes IA se autentican con su usuario y consumen <code>/api/v1/mcp</code>.
              </p>
            </div>
            {state && (
              <p role="status" className={cn('text-sm font-medium', state.ok ? 'text-emerald-600' : 'text-red-600')}>
                {state.message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Creando…' : 'Crear usuario'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
