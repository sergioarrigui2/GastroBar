'use client';

import { KeyRound, Mail, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import {
  addTenantAdminAction,
  sendTenantAdminRecoveryAction,
  setTenantAdminActiveAction,
  setTenantAdminPasswordAction,
  updateTenantAdminAction,
} from '@/app/actions/platform';
import { FlashMessage, useAdminMutation } from '@/components/admin/useAdminMutation';
import { Badge, Button, Card, Input, Label } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Owner = { id: string; full_name: string; email?: string | null; is_active: boolean };
type Mode = { id: string; kind: 'edit' | 'password' } | null;

/** Administradores de un gastrobar: el superusuario agrega, edita, restablece acceso y desactiva. */
export function TenantAdmins({ tenantId, owners }: { tenantId: string; owners: Owner[] }) {
  const { pending, flash, run } = useAdminMutation();
  const [mode, setMode] = useState<Mode>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const activeCount = owners.filter((o) => o.is_active).length;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Administradores</h2>
        {!adding && (
          <Button variant="secondary" size="sm" onClick={() => (setAdding(true), setMode(null), setForm({ full_name: '', email: '', password: '' }))}>
            <Plus className="size-4" /> Agregar
          </Button>
        )}
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {owners.map((o) => (
          <li key={o.id} className={cn('py-2.5 text-sm', !o.is_active && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.full_name}</span>
                <span className="block truncate text-zinc-500">{o.email ?? 'sin correo'}</span>
              </span>
              {!o.is_active && <Badge className="bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200">Inactivo</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" onClick={() => (setAdding(false), setMode({ id: o.id, kind: 'edit' }), setForm({ full_name: o.full_name, email: o.email ?? '', password: '' }))}>
                <Pencil className="size-3.5" /> Editar
              </Button>
              <Button variant="ghost" size="sm" disabled={pending || !o.email} onClick={() => run(() => sendTenantAdminRecoveryAction(tenantId, o.id), `Correo de recuperación enviado a ${o.email}`)}>
                <Mail className="size-3.5" /> Enviar recuperación
              </Button>
              <Button variant="ghost" size="sm" onClick={() => (setAdding(false), setMode({ id: o.id, kind: 'password' }), setForm({ full_name: '', email: '', password: '' }))}>
                <KeyRound className="size-3.5" /> Contraseña temporal
              </Button>
              {o.is_active ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600"
                  disabled={pending || activeCount <= 1}
                  title={activeCount <= 1 ? 'Es el único administrador activo' : undefined}
                  onClick={() => confirm(`¿Desactivar a ${o.full_name}? Perderá el acceso de inmediato.`) && run(() => setTenantAdminActiveAction(tenantId, o.id, false), `${o.full_name} desactivado`)}
                >
                  <UserX className="size-3.5" /> Desactivar
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setTenantAdminActiveAction(tenantId, o.id, true), `${o.full_name} reactivado`)}>
                  <UserCheck className="size-3.5" /> Reactivar
                </Button>
              )}
            </div>

            {mode?.id === o.id && mode.kind === 'edit' && (
              <div className="mt-2 grid gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
                <div>
                  <Label htmlFor={`n-${o.id}`}>Nombre</Label>
                  <Input id={`n-${o.id}`} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`e-${o.id}`}>Correo para ingresar</Label>
                  <Input id={`e-${o.id}`} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <p className="mt-1 text-xs text-zinc-500">Si cambias el correo, el nuevo sirve de inmediato y el anterior deja de funcionar. La contraseña no cambia.</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending} onClick={() => run(() => updateTenantAdminAction(tenantId, o.id, { full_name: form.full_name, email: form.email }), 'Administrador actualizado', () => setMode(null))}>
                    Guardar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {mode?.id === o.id && mode.kind === 'password' && (
              <div className="mt-2 grid gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
                <Label htmlFor={`p-${o.id}`}>Contraseña temporal (mín. 10)</Label>
                <Input id={`p-${o.id}`} type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <p className="text-xs text-zinc-500">Díctasela en persona o por teléfono y pídele que la cambie con «¿Olvidaste tu contraseña?». No la envíes por chat.</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending || form.password.length < 10} onClick={() => run(() => setTenantAdminPasswordAction(tenantId, o.id, form.password), 'Contraseña temporal asignada', () => setMode(null))}>
                    Asignar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="grid gap-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
          <p className="font-semibold">Nuevo administrador</p>
          <div>
            <Label htmlFor="a-name">Nombre</Label>
            <Input id="a-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Gerente o socio" />
          </div>
          <div>
            <Label htmlFor="a-email">Correo</Label>
            <Input id="a-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="a-pass">Contraseña inicial (mín. 10)</Label>
            <Input id="a-pass" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => addTenantAdminAction(tenantId, form), `${form.full_name} agregado como administrador`, () => setAdding(false))}>
              Agregar administrador
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <FlashMessage flash={flash} />
    </Card>
  );
}
