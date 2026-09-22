'use client';

import { Bot, ChefHat, Expand, Martini, Printer, RotateCcw, Shrink, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { getKdsTicketsAction, updateItemsStatusAction } from '@/app/actions/orders';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useRealtimeRefresh } from '@/components/ui/useRealtimeRefresh';
import { cn, formatElapsed, minutesSince } from '@/lib/utils';
import type { ItemStatus, KdsTicket, Station } from '@/types/domain';

type Sla = 'ok' | 'warn' | 'late';

const SLA_STYLES: Record<Sla, { bar: string; ring: string; text: string; label: string }> = {
  ok: { bar: 'bg-sla-ok', ring: 'ring-sla-ok/40', text: 'text-sla-ok', label: 'A tiempo' },
  warn: { bar: 'bg-sla-warn', ring: 'ring-sla-warn/60', text: 'text-sla-warn', label: 'Al límite' },
  late: { bar: 'bg-sla-late', ring: 'ring-sla-late/70', text: 'text-sla-late', label: 'Retrasado' },
};

const NEXT_STATUS: Partial<Record<ItemStatus, ItemStatus>> = {
  pending: 'in_preparation',
  in_preparation: 'ready',
  ready: 'in_preparation', // deshacer
};

/** Densidad del grid según la carga: pocas comandas = tarjetas grandes legibles a distancia. */
function gridDensity(count: number) {
  if (count <= 2) return { min: '26rem', text: 'text-xl', compact: false };
  if (count <= 6) return { min: '20rem', text: 'text-lg', compact: false };
  if (count <= 12) return { min: '16.5rem', text: 'text-base', compact: true };
  return { min: '14rem', text: 'text-sm', compact: true };
}

function beep() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio bloqueado por el navegador hasta la primera interacción.
  }
}

export function KDSDisplay({
  station,
  tenantId,
  tenantName,
  sla,
  initialTickets,
}: {
  station: Station;
  tenantId: string;
  tenantName: string;
  sla: { warningMinutes: number; lateMinutes: number };
  initialTickets: KdsTicket[];
}) {
  const [tickets, setTickets] = useState<KdsTicket[]>(initialTickets);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [lastBumped, setLastBumped] = useState<{ key: string; itemIds: string[]; label: string } | null>(null);
  const [sound, setSound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const knownKeys = useRef(new Set(initialTickets.map((t) => t.key)));
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const refresh = useCallback(async () => {
    const result = await getKdsTicketsAction(station);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    const incoming = result.data.filter((t) => !knownKeys.current.has(t.key)).map((t) => t.key);
    if (incoming.length > 0) {
      if (soundRef.current) beep();
      setFresh((prev) => new Set([...prev, ...incoming]));
      setTimeout(() => setFresh((prev) => new Set([...prev].filter((k) => !incoming.includes(k)))), 12_000);
    }
    knownKeys.current = new Set(result.data.map((t) => t.key));
    setTickets(result.data);
  }, [station]);

  const realtime = useRealtimeRefresh({
    channel: `kds:${tenantId}:${station}`,
    // RLS limita al tenant; el filtro de Realtime enruta sólo la estación de esta pantalla.
    subscriptions: [{ table: 'order_items', filter: `station=eq.${station}` }],
    onRefresh: () => void refresh(),
    debounceMs: 200,
    fallbackPollMs: 30_000,
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  /** Cambio optimista + Server Action; ante error se re-sincroniza. */
  const setStatus = (itemIds: string[], status: ItemStatus) => {
    if (itemIds.length === 0) return;
    const ids = new Set(itemIds);
    setTickets((prev) =>
      prev
        .map((t) => ({ ...t, items: t.items.map((i) => (ids.has(i.id) ? { ...i, status } : i)) }))
        .filter((t) => t.items.some((i) => i.status !== 'ready')),
    );
    startTransition(async () => {
      const result = await updateItemsStatusAction({ item_ids: itemIds, status });
      if (!result.ok) setError(result.error);
      await refresh();
    });
  };

  const bump = (ticket: KdsTicket) => {
    const ids = ticket.items.filter((i) => i.status !== 'ready').map((i) => i.id);
    setLastBumped({ key: ticket.key, itemIds: ids, label: ticket.tableLabel ? `Mesa ${ticket.tableLabel}` : `#${ticket.orderNumber}` });
    setStatus(ids, 'ready');
  };

  const slaFor = (createdAt: string): Sla => {
    const minutes = minutesSince(createdAt, now);
    if (minutes >= sla.lateMinutes) return 'late';
    if (minutes >= sla.warningMinutes) return 'warn';
    return 'ok';
  };

  const density = gridDensity(tickets.length);
  const counts: Record<Sla, number> = { ok: 0, warn: 0, late: 0 };
  for (const t of tickets) counts[slaFor(t.createdAt)] += 1;
  const StationIcon = station === 'bar' ? Martini : ChefHat;

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-100 dark:bg-black">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <StationIcon className="size-7 text-brand-500" />
        <div className="mr-auto">
          <h1 className="text-xl font-black uppercase tracking-wide">{station === 'bar' ? 'Barra' : 'Cocina'}</h1>
          <p className="text-xs text-zinc-500">{tenantName}</p>
        </div>

        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="tabular rounded-lg bg-zinc-100 px-3 py-1 dark:bg-zinc-900">{tickets.length} comandas</span>
          {(['ok', 'warn', 'late'] as const).map((k) => (
            <span key={k} className="tabular flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1 dark:bg-zinc-900" title={SLA_STYLES[k].label}>
              <span className={cn('size-3 rounded-full', SLA_STYLES[k].bar)} />
              {counts[k]}
            </span>
          ))}
        </div>

        {lastBumped && (
          <button
            onClick={() => {
              setStatus(lastBumped.itemIds, 'in_preparation');
              setLastBumped(null);
            }}
            className="flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-3 text-sm font-semibold text-white dark:bg-zinc-800"
          >
            <RotateCcw className="size-4" /> Deshacer {lastBumped.label}
          </button>
        )}

        {realtime !== 'live' && (
          <span className="flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-600">
            <WifiOff className="size-4" /> Sin tiempo real
          </span>
        )}
        <button onClick={() => setSound((s) => !s)} aria-label={sound ? 'Silenciar' : 'Activar sonido'} className="grid size-10 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
        </button>
        <button onClick={toggleFullscreen} aria-label="Pantalla completa" className="grid size-10 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {fullscreen ? <Shrink className="size-5" /> : <Expand className="size-5" />}
        </button>
        <ThemeToggle />
      </header>

      {error && <p className="bg-red-600 px-4 py-2 text-sm font-semibold text-white">{error}</p>}

      {tickets.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center text-zinc-400">
          <div>
            <StationIcon className="mx-auto mb-4 size-16 opacity-30" />
            <p className="text-2xl font-bold">Sin comandas pendientes</p>
            <p className="mt-1 text-sm">Las nuevas comandas aparecerán aquí al instante.</p>
          </div>
        </div>
      ) : (
        <main
          className="grid flex-1 content-start items-start gap-3 p-3"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${density.min}), 1fr))` }}
        >
          {tickets.map((ticket) => {
            const level = slaFor(ticket.createdAt);
            const style = SLA_STYLES[level];
            const allPending = ticket.items.every((i) => i.status === 'pending');
            return (
              <article
                key={ticket.key}
                className={cn(
                  'flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-2 dark:bg-zinc-900',
                  style.ring,
                  fresh.has(ticket.key) && 'animate-pop ring-4 ring-sky-500',
                  level === 'late' && 'motion-safe:animate-pulse',
                )}
              >
                <header className={cn('flex items-center gap-2 px-3 py-2 text-zinc-950', style.bar)}>
                  <span className="text-2xl font-black leading-none">{ticket.tableLabel ? ticket.tableLabel : 'BARRA'}</span>
                  <span className="text-sm font-bold opacity-80">
                    #{ticket.orderNumber}
                    {ticket.round > 1 && ` · R${ticket.round}`}
                  </span>
                  {ticket.source === 'ai_agent' && <Bot className="size-4" aria-label="Creada por agente IA" />}
                  <span suppressHydrationWarning className="tabular ml-auto text-xl font-black">{formatElapsed(ticket.createdAt, now)}</span>
                  <button
                    onClick={() =>
                      window.open(
                        `/print/order/${ticket.orderId}?station=${station}&round=${ticket.round}&auto=1`,
                        '_blank',
                        'width=420,height=720',
                      )
                    }
                    aria-label="Imprimir comanda"
                    className="grid size-8 place-items-center rounded-lg hover:bg-black/10"
                  >
                    <Printer className="size-4" />
                  </button>
                </header>

                {ticket.orderNotes && (
                  <p className="border-b border-zinc-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900 dark:border-zinc-800 dark:bg-amber-500/10 dark:text-amber-200">
                    📝 {ticket.orderNotes}
                  </p>
                )}

                <ul className={cn('flex-1 divide-y divide-zinc-200 dark:divide-zinc-800', density.text)}>
                  {ticket.items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => {
                          const next = NEXT_STATUS[item.status];
                          if (next) setStatus([item.id], next);
                        }}
                        className={cn(
                          'flex w-full items-start gap-3 px-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
                          density.compact ? 'py-1.5' : 'py-2.5',
                          item.status === 'ready' && 'opacity-40',
                        )}
                      >
                        <span
                          className={cn(
                            'tabular mt-0.5 grid shrink-0 place-items-center rounded-lg font-black',
                            density.compact ? 'size-7 text-sm' : 'size-9',
                            item.status === 'in_preparation'
                              ? 'bg-amber-400 text-zinc-950'
                              : item.status === 'ready'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-zinc-200 dark:bg-zinc-700',
                          )}
                        >
                          {item.quantity}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block font-bold', item.status === 'ready' && 'line-through')}>{item.product_name}</span>
                          {item.modifiers.length > 0 && (
                            <span className="block text-[0.85em] font-semibold text-brand-600 dark:text-brand-400">
                              {item.modifiers.map((m) => m.name).join(' · ')}
                            </span>
                          )}
                          {item.notes && <span className="block text-[0.85em] italic text-red-600 dark:text-red-400">⚠ {item.notes}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <footer className="grid grid-cols-2 gap-2 p-2">
                  <button
                    onClick={() => setStatus(ticket.items.filter((i) => i.status === 'pending').map((i) => i.id), 'in_preparation')}
                    disabled={!ticket.items.some((i) => i.status === 'pending')}
                    className="h-12 rounded-xl bg-amber-400 font-bold text-zinc-950 active:scale-[0.98] disabled:opacity-30"
                  >
                    {allPending ? 'Iniciar' : 'Iniciar resto'}
                  </button>
                  <button onClick={() => bump(ticket)} className="h-12 rounded-xl bg-emerald-600 font-bold text-white active:scale-[0.98]">
                    ✓ Listo
                  </button>
                </footer>
              </article>
            );
          })}
        </main>
      )}
    </div>
  );
}
