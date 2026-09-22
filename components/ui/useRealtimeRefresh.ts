'use client';

import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

type TableName = keyof Database['public']['Tables'];
type Row<T extends TableName> = Database['public']['Tables'][T]['Row'];

/** Unión discriminada por `table`: `onChange` recibe el tipo de fila correcto. */
export type RealtimeSubscription = {
  [T in TableName]: {
    table: T;
    event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
    /** Filtro de Realtime (una condición), ej. `station=eq.bar`. */
    filter?: string;
    onChange?: (payload: RealtimePostgresChangesPayload<Row<T>>) => void;
  };
}[TableName];

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * Suscripción Realtime a cambios de Postgres (RLS aplica: sólo llegan filas del
 * tenant del usuario) que dispara `onRefresh` con debounce, más un sondeo de
 * respaldo por si la conexión se cae.
 */
export function useRealtimeRefresh({
  channel,
  subscriptions,
  onRefresh,
  debounceMs = 300,
  fallbackPollMs = 60_000,
}: {
  channel: string;
  subscriptions: RealtimeSubscription[];
  onRefresh: () => void;
  debounceMs?: number;
  fallbackPollMs?: number;
}): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const refreshRef = useRef(onRefresh);
  const subsRef = useRef(subscriptions);
  useEffect(() => {
    refreshRef.current = onRefresh;
    subsRef.current = subscriptions;
  });

  const subsKey = subscriptions.map((s) => `${s.table}:${s.event ?? '*'}:${s.filter ?? ''}`).join('|');

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current(), debounceMs);
    };

    let ch = supabase.channel(channel);
    subsRef.current.forEach((sub, index) => {
      ch = ch.on(
        'postgres_changes',
        { event: sub.event ?? '*', schema: 'public', table: sub.table, filter: sub.filter },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          // Cada suscripción sólo recibe eventos de su propia tabla.
          const handler = subsRef.current[index]?.onChange as ((p: typeof payload) => void) | undefined;
          handler?.(payload);
          schedule();
        },
      );
    });

    ch.subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        setStatus('live');
        schedule(); // re-sincroniza tras (re)conectar
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        setStatus('offline');
      }
    });

    const poll = setInterval(() => refreshRef.current(), fallbackPollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  }, [channel, subsKey, debounceMs, fallbackPollMs]);

  return status;
}
