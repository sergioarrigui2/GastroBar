'use client';

import { MonitorSmartphone } from 'lucide-react';
import { useState, useTransition } from 'react';
import { forgetTerminalAction, revokeTerminalAction, type TerminalFormState } from '@/app/actions/terminal';
import { ActivateTerminalForm } from '@/components/terminal/ActivateTerminalForm';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { cn, formatDateTime } from '@/lib/utils';

type Device = { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null };

/** Tablets compartidas donde el personal entra con PIN. */
export function TerminalsPanel({
  devices,
  currentDeviceId,
  locale,
  timezone,
}: {
  devices: Device[];
  currentDeviceId: string | null;
  locale: string;
  timezone: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<TerminalFormState>(null);
  const fmt = (iso: string) => formatDateTime(iso, locale, timezone, { dateStyle: 'medium', timeStyle: 'short' });
  const active = devices.filter((d) => !d.revoked_at);

  return (
    <Card>
      <div className="mb-4 flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 size-5 shrink-0 text-zinc-500" />
        <div>
          <h2 className="font-semibold">Terminales compartidas</h2>
          <p className="text-sm text-zinc-500">
            Tablets del negocio donde cada empleado entra con su PIN y la pantalla se bloquea sola tras 3 minutos sin uso.
            Sólo en estos dispositivos funciona el PIN.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          {active.length === 0 ? (
            <p className="text-sm text-zinc-500">Aún no hay terminales autorizadas.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {active.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {d.name}
                      {d.id === currentDeviceId && <Badge className="bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100">Este dispositivo</Badge>}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {d.last_seen_at ? `Último uso ${fmt(d.last_seen_at)}` : `Autorizada ${fmt(d.created_at)}`}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => start(async () => setResult(await revokeTerminalAction(d.id)))}
                  >
                    Revocar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {result && (
            <p role="status" className={cn('mt-2 text-sm font-medium', result.ok ? 'text-emerald-600' : 'text-red-600')}>
              {result.message}
            </p>
          )}
        </div>

        <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
          {currentDeviceId ? (
            <div className="space-y-3 text-sm">
              <p>
                Este dispositivo ya es una terminal. Cuando cierres tu sesión verás la pantalla de PIN.
              </p>
              <form action={forgetTerminalAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Dejar de usar este dispositivo como terminal
                </Button>
              </form>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                ¿Estás en la tablet del negocio? Autorízala aquí mismo.
              </p>
              <ActivateTerminalForm />
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
