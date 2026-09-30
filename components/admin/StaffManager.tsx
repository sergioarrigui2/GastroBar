'use client';

import { Bot, KeyRound } from 'lucide-react';
import { useActionState, useState, useTransition } from 'react';
import { createStaffAction, setStaffActiveAction, type FormState } from '@/app/actions/admin';
import { setStaffPinAction, type TerminalFormState } from '@/app/actions/terminal';
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
const PIN_ROLES: AppRole[] = ['waiter', 'cashier', 'kitchen', 'bar'];

type PinInfo = Record<string, { locked: boolean }>;

export function StaffManager({ staff, currentUserId, pins }: { staff: Profile[]; currentUserId: string; pins: PinInfo }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createStaffAction, null);
  const [access, setAccess] = useState<'password' | 'pin'>('pin');
  const [role, setRole] = useState<AppRole>('waiter');
  const active = staff.filter((p) => p.is_active);
  const inactive = staff.filter((p) => !p.is_active);
  const roles = (Object.keys(ROLE_LABELS) as AppRole[]).filter((r) => access === 'password' || PIN_ROLES.includes(r));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Personal</h1>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-1 font-semibold">Activos ({active.length})</h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {active.map((p) => (
              <StaffRow key={p.id} p={p} self={p.id === currentUserId} pin={pins[p.id]} />
            ))}
          </ul>
          {inactive.length > 0 && (
            <details className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-500">
                Ya no trabajan aquí ({inactive.length}) · su historial de ventas se conserva
              </summary>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {inactive.map((p) => (
                  <StaffRow key={p.id} p={p} self={false} pin={pins[p.id]} />
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Agregar persona</h2>
          <form action={action} className="space-y-3">
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Cómo va a entrar</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['pin', 'Sólo PIN', 'Sin correo, en la tablet'],
                    ['password', 'Con correo', 'Desde cualquier equipo'],
                  ] as const
                ).map(([value, title, hint]) => (
                  <label
                    key={value}
                    className={cn(
                      'cursor-pointer rounded-xl border p-2.5 text-sm',
                      access === value ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-zinc-200 dark:border-zinc-700',
                    )}
                  >
                    <input
                      type="radio"
                      name="access"
                      value={value}
                      checked={access === value}
                      onChange={() => {
                        setAccess(value);
                        if (value === 'pin' && !PIN_ROLES.includes(role)) setRole('waiter');
                      }}
                      className="sr-only"
                    />
                    <span className="block font-semibold">{title}</span>
                    <span className="block text-xs text-zinc-500">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <Label htmlFor="full_name">Nombre</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div>
              <Label htmlFor="role">Rol</Label>
              <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            {access === 'password' && (
              <>
                <div>
                  <Label htmlFor="email">Correo</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <div>
                  <Label htmlFor="password">Contraseña inicial (mín. 10)</Label>
                  <Input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
                </div>
              </>
            )}
            {PIN_ROLES.includes(role) && (
              <div>
                <Label htmlFor="pin">PIN {access === 'password' && '(opcional)'}</Label>
                <Input
                  id="pin"
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  autoComplete="off"
                  placeholder="4 a 6 números"
                  required={access === 'pin'}
                />
                <p className="mt-1 text-xs text-zinc-500">Entrégaselo en persona. Sirve sólo en las terminales del negocio.</p>
              </div>
            )}
            {role === 'ai_agent' && (
              <p className="text-xs text-zinc-500">
                Los agentes IA se autentican con su usuario y consumen <code>/api/v1/mcp</code>.
              </p>
            )}
            {state && (
              <p role="status" className={cn('text-sm font-medium', state.ok ? 'text-emerald-600' : 'text-red-600')}>
                {state.message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Creando…' : 'Agregar'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function StaffRow({ p, self, pin }: { p: Profile; self: boolean; pin?: { locked: boolean } }) {
  const [toggling, startToggle] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [result, setResult] = useState<TerminalFormState>(null);
  const [saving, startSave] = useTransition();
  const canPin = PIN_ROLES.includes(p.role) && p.is_active;

  return (
    <li className={cn('py-3', !p.is_active && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-100 font-bold dark:bg-zinc-800">
          {p.role === 'ai_agent' ? <Bot className="size-5" /> : p.full_name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.full_name}</span>
          <span className="flex flex-wrap gap-1.5">
            <Badge className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{ROLE_LABELS[p.role]}</Badge>
            {p.pin_only && <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">Sin correo</Badge>}
            {pin && !pin.locked && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">PIN</Badge>}
            {pin?.locked && <Badge className="bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200">PIN bloqueado</Badge>}
            {canPin && !pin && <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Sin PIN</Badge>}
          </span>
        </span>
        {canPin && (
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            <KeyRound className="size-4" /> {pin ? 'Cambiar PIN' : 'Asignar PIN'}
          </Button>
        )}
        {!self && (
          <Button
            variant="secondary"
            size="sm"
            disabled={toggling}
            onClick={() => startToggle(async () => void (await setStaffActiveAction(p.id, !p.is_active)))}
          >
            {p.is_active ? 'Dar de baja' : 'Reactivar'}
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 pl-13"
          onSubmit={(e) => {
            e.preventDefault();
            startSave(async () => {
              const r = await setStaffPinAction(p.id, value);
              setResult(r);
              if (r?.ok) {
                setValue('');
                setEditing(false);
              }
            });
          }}
        >
          <Input
            aria-label={`Nuevo PIN de ${p.full_name}`}
            inputMode="numeric"
            pattern="\d{4,6}"
            maxLength={6}
            autoComplete="off"
            placeholder="Nuevo PIN"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
            className="w-36"
            required
          />
          <Button type="submit" size="sm" disabled={saving || value.length < 4}>
            Guardar
          </Button>
        </form>
      )}
      {result && (
        <p role="status" className={cn('mt-1 pl-13 text-sm font-medium', result.ok ? 'text-emerald-600' : 'text-red-600')}>
          {result.message}
        </p>
      )}
    </li>
  );
}
