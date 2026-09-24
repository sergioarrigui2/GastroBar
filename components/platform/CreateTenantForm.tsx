'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createTenantAction } from '@/app/actions/platform';
import { AgentAvatar } from '@/components/admin/ai/AgentAvatar';
import { FlashMessage, useAdminMutation } from '@/components/admin/useAdminMutation';
import { Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { AGENT_ORDER, AGENTS, type AgentId } from '@/lib/ai/agents';

const slugify = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export function CreateTenantForm({ plans }: { plans: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const { pending, flash, run } = useAdminMutation();
  const [form, setForm] = useState({
    business_name: '',
    slug: '',
    owner_name: '',
    owner_email: '',
    owner_password: '',
    trial_days: 14,
    plan: 'pro',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [agents, setAgents] = useState<AgentId[]>([...AGENT_ORDER]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Nuevo cliente</h2>
      <div>
        <Label htmlFor="t-name">Nombre del gastrobar</Label>
        <Input
          id="t-name"
          value={form.business_name}
          onChange={(e) => {
            set('business_name', e.target.value);
            if (!slugTouched) set('slug', slugify(e.target.value));
          }}
        />
      </div>
      <div>
        <Label htmlFor="t-slug">Identificador (menú QR: /m/…)</Label>
        <Input
          id="t-slug"
          value={form.slug}
          onChange={(e) => {
            setSlugTouched(true);
            set('slug', slugify(e.target.value));
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="t-owner">Dueño</Label>
          <Input id="t-owner" value={form.owner_name} onChange={(e) => set('owner_name', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="t-email">Correo del dueño</Label>
          <Input id="t-email" type="email" value={form.owner_email} onChange={(e) => set('owner_email', e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="t-pass">Contraseña inicial (mín. 10; se la entregas tú)</Label>
        <Input id="t-pass" type="text" autoComplete="off" value={form.owner_password} onChange={(e) => set('owner_password', e.target.value)} />
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Agentes contratados</legend>
        {AGENT_ORDER.map((a) => (
          <label key={a} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={agents.includes(a)}
              onChange={(e) => setAgents(e.target.checked ? [...agents, a] : agents.filter((x) => x !== a))}
              className="size-4 accent-brand-600"
            />
            <AgentAvatar agent={a} size="sm" /> {AGENTS[a].name}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="t-trial">Prueba gratis de los agentes</Label>
          <Select id="t-trial" value={form.trial_days} onChange={(e) => set('trial_days', Number(e.target.value))}>
            <option value={0}>Sin prueba (contratados)</option>
            {[7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="t-plan">Plan del Analista</Label>
          <Select id="t-plan" value={form.plan} onChange={(e) => set('plan', e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Button
        className="w-full"
        disabled={pending || !form.business_name || !form.slug || !form.owner_email || form.owner_password.length < 10}
        onClick={() =>
          run(
            () => createTenantAction({ ...form, agents, plan: form.plan as 'pro' }),
            'Cliente creado',
            (id) => router.push(`/platform/tenants/${id}`),
          )
        }
      >
        Crear cliente
      </Button>
      <p className="text-xs text-zinc-500">
        Se crea el gastrobar y el usuario administrador del dueño, ya confirmado. Entrégale su correo y contraseña; puede cambiarla con
        "¿Olvidaste tu contraseña?".
      </p>
      <FlashMessage flash={flash} />
    </Card>
  );
}
