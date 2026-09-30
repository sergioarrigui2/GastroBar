'use client';

import { Copy, PlugZap } from 'lucide-react';
import { useState, useTransition } from 'react';
import { disconnectAiConnectionAction } from '@/app/actions/ai-connections';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { cn, formatDateTime } from '@/lib/utils';

type Connection = { id: string; client_name: string; created_at: string; last_used_at: string | null; granted_by_name: string | null; calls24h: number };
type Call = { id: string; connection: string; tool: string; ok: boolean; created_at: string };

const TOOL_LABEL: Record<string, string> = {
  get_business_analysis_tool: 'Análisis del negocio',
  get_bar_metrics_tool: 'Métricas del turno',
  get_menu_costs: 'Carta con costos',
  get_inventory_status: 'Inventario',
  get_table_status: 'Estado de mesas',
  get_menu_availability: 'Menú disponible',
  search: 'Búsqueda',
  fetch: 'Detalle',
};

/** Conectar Claude, ChatGPT u otro asistente al gastrobar (sólo lectura) y controlar lo que consulta. */
export function AiConnectionsPanel({ mcpUrl, connections, calls, locale, timezone }: { mcpUrl: string; connections: Connection[]; calls: Call[]; locale: string; timezone: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fmt = (iso: string) => formatDateTime(iso, locale, timezone, { dateStyle: 'short', timeStyle: 'short' });
  const copy = () => void navigator.clipboard?.writeText(mcpUrl).then(() => setMessage({ ok: true, text: 'Dirección copiada' })).catch(() => undefined);

  return (
    <Card>
      <div className="mb-4 flex items-start gap-3">
        <PlugZap className="mt-0.5 size-5 shrink-0 text-zinc-500" />
        <div>
          <h2 className="font-semibold">Conexiones de IA</h2>
          <p className="text-sm text-zinc-500">
            Conecta tu propio Claude o ChatGPT para preguntarle por tus ventas, márgenes e inventario. Sólo lectura: no puede vender, cobrar ni anular nada, y las respuestas las paga tu suscripción.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
          <p className="font-semibold">Cómo conectarlo</p>
          <div className="flex items-center gap-2 rounded-lg bg-zinc-900 p-2 font-mono text-xs text-zinc-100">
            <code className="min-w-0 flex-1 break-all">{mcpUrl}</code>
            <button type="button" onClick={copy} aria-label="Copiar dirección" className="shrink-0 rounded p-1 hover:bg-zinc-700">
              <Copy className="size-4" />
            </button>
          </div>
          <p>
            <b>Claude</b> (web, escritorio o celular): Configuración → Conectores → Agregar conector personalizado → pega la dirección.
          </p>
          <p>
            <b>ChatGPT</b>: Configuración → Aplicaciones y conectores → Crear o agregar conector → pega la dirección. (Según tu plan, puede requerir activar el modo desarrollador.)
          </p>
          <p className="text-zinc-500">
            El asistente te llevará al login de GastroBar: entra con tu correo de administrador y toca <b>Permitir</b>. Luego pregúntale, por ejemplo: «¿Cuáles fueron mis 10 productos más vendidos este mes y cuánto margen dejan?».
          </p>
        </div>

        <div className="min-w-0 space-y-3">
          <p className="text-sm font-semibold">Asistentes conectados</p>
          {connections.length === 0 ? (
            <p className="text-sm text-zinc-500">Ninguno por ahora.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {connections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      {c.client_name}
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">Sólo lectura</Badge>
                    </span>
                    <span className="block text-xs text-zinc-500">
                      Conectado {fmt(c.created_at)}
                      {c.granted_by_name ? ` por ${c.granted_by_name}` : ''} · {c.last_used_at ? `última consulta ${fmt(c.last_used_at)}` : 'sin consultas aún'} · {c.calls24h} en 24 h
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-red-600"
                    disabled={pending}
                    onClick={() =>
                      confirm(`¿Desconectar ${c.client_name}? Dejará de tener acceso de inmediato.`) &&
                      start(async () => {
                        const r = await disconnectAiConnectionAction(c.id);
                        setMessage(r.ok ? { ok: true, text: `${c.client_name} desconectado` } : { ok: false, text: r.error });
                      })
                    }
                  >
                    Desconectar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {calls.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-zinc-600 dark:text-zinc-300">Últimas consultas ({calls.length})</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {calls.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {c.connection} · {TOOL_LABEL[c.tool] ?? c.tool}
                      {!c.ok && <b className="ml-1 text-red-600">falló</b>}
                    </span>
                    <span className="text-zinc-500">{fmt(c.created_at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {message && <p className={cn('text-sm font-medium', message.ok ? 'text-emerald-600' : 'text-red-600')}>{message.text}</p>}
        </div>
      </div>
    </Card>
  );
}
