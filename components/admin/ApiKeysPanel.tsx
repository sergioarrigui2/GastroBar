'use client';

import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { createApiKeyAction, revokeApiKeyAction } from '@/app/actions/api-keys';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { cn, formatDateTime } from '@/lib/utils';
import type { Tables } from '@/types/database';
import type { Profile } from '@/types/domain';
import { FlashMessage, useAdminMutation } from './useAdminMutation';

type ApiKey = Pick<Tables<'api_keys'>, 'id' | 'profile_id' | 'name' | 'key_prefix' | 'created_at' | 'last_used_at' | 'revoked_at'>;

export function ApiKeysPanel({
  keys,
  agents,
  locale,
  timezone,
}: {
  keys: ApiKey[];
  agents: Profile[];
  locale: string;
  timezone: string;
}) {
  const { pending, flash, run } = useAdminMutation();
  const [profileId, setProfileId] = useState(agents[0]?.id ?? '');
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fmt = (iso: string) => formatDateTime(iso, locale, timezone, { dateStyle: 'medium', timeStyle: 'short' });
  const agentName = new Map(agents.map((a) => [a.id, a.full_name]));

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 text-brand-600" />
        <div>
          <h2 className="font-semibold">Claves API para agentes de IA</h2>
          <p className="text-sm text-zinc-500">
            No caducan. Úsalas como <code>Authorization: Bearer gbk_…</code> en <code>/api/v1/mcp</code> o{' '}
            <code>/api/v1/ai-tools</code>. El agente actúa con los permisos de su usuario.
          </p>
        </div>
      </div>

      {agents.length === 0 ? (
        <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          Primero crea un usuario con rol <b>Agente IA</b>.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="key-agent">Agente</Label>
            <Select id="key-agent" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="key-name">Nombre de la clave</Label>
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Asistente WhatsApp" />
          </div>
          <Button
            disabled={pending || !name.trim() || !profileId}
            onClick={() =>
              run(() => createApiKeyAction({ profile_id: profileId, name }), 'Clave creada', (data) => {
                setNewKey(data.key);
                setCopied(false);
                setName('');
              })
            }
          >
            Generar clave
          </Button>
        </div>
      )}

      {newKey && (
        <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <p className="mb-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Copia la clave ahora: no se volverá a mostrar.
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white p-2 text-xs dark:bg-zinc-900">{newKey}</code>
            <Button
              variant="secondary"
              aria-label="Copiar clave"
              onClick={async () => {
                await navigator.clipboard.writeText(newKey);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setNewKey(null)}>
            Ya la guardé
          </Button>
        </div>
      )}

      <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {keys.map((k) => (
          <li key={k.id} className={cn('flex flex-wrap items-center gap-2 py-2.5', k.revoked_at && 'opacity-50')}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {k.name} <code className="text-xs text-zinc-500">{k.key_prefix}…</code>
              </span>
              <span className="text-xs text-zinc-500">
                {agentName.get(k.profile_id) ?? 'Agente'} · creada {fmt(k.created_at)}
                {k.last_used_at ? ` · último uso ${fmt(k.last_used_at)}` : ' · sin uso'}
              </span>
            </span>
            {k.revoked_at ? (
              <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Revocada</Badge>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600"
                disabled={pending}
                onClick={() => confirm(`¿Revocar "${k.name}"? Dejará de funcionar de inmediato.`) && run(() => revokeApiKeyAction(k.id), 'Clave revocada')}
              >
                Revocar
              </Button>
            )}
          </li>
        ))}
        {keys.length === 0 && <li className="py-3 text-zinc-500">Aún no hay claves.</li>}
      </ul>
      <FlashMessage flash={flash} />
    </Card>
  );
}
