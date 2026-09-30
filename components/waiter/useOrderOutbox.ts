'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { submitOrderAction } from '@/app/actions/orders';
import type { SubmitOrderInput } from '@/lib/validations/order';
import type { SubmitOrderResult } from '@/types/domain';

/**
 * Cola de comandas sin conexión. Si no hay internet, la comanda se guarda en el
 * dispositivo y se envía sola al volver la conexión. Cada una lleva un client_id:
 * si ya había entrado (se cortó la respuesta), la base no la duplica.
 */
export type OutboxEntry = {
  client_id: string;
  table_label: string;
  input: SubmitOrderInput & { client_id: string };
  created_at: string;
  /** Rechazo del servidor (p. ej. producto agotado): no se reintenta sola. */
  error?: string;
};

const RETRY_MS = 10_000;

function read(key: string): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, entries: OutboxEntry[]) {
  try {
    if (entries.length) localStorage.setItem(key, JSON.stringify(entries));
    else localStorage.removeItem(key);
  } catch {
    // Sin almacenamiento (modo privado): la cola vive sólo en memoria.
  }
}

export function useOrderOutbox(tenantId: string, onSent: (entry: OutboxEntry, result: SubmitOrderResult) => void) {
  const key = `gastrobar:outbox:${tenantId}`;
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const entriesRef = useRef<OutboxEntry[]>([]);
  const busy = useRef(false);
  const onSentRef = useRef(onSent);
  useEffect(() => {
    onSentRef.current = onSent;
  });

  const save = useCallback(
    (next: OutboxEntry[]) => {
      entriesRef.current = next;
      setEntries(next);
      write(key, next);
    },
    [key],
  );

  // Envía lo pendiente en orden. Se detiene al primer fallo de red.
  const flush = useCallback(async () => {
    if (busy.current || !navigator.onLine) return;
    const pending = entriesRef.current.filter((e) => !e.error);
    if (!pending.length) return;
    busy.current = true;
    setFlushing(true);
    try {
      for (const entry of pending) {
        let result: Awaited<ReturnType<typeof submitOrderAction>>;
        try {
          result = await submitOrderAction(entry.input);
        } catch {
          break; // sigue sin red: se reintenta después
        }
        if (result.ok) {
          save(entriesRef.current.filter((e) => e.client_id !== entry.client_id));
          onSentRef.current(entry, result.data);
        } else {
          save(entriesRef.current.map((e) => (e.client_id === entry.client_id ? { ...e, error: result.error } : e)));
        }
      }
    } finally {
      busy.current = false;
      setFlushing(false);
    }
  }, [save]);

  useEffect(() => {
    entriesRef.current = read(key);
    setEntries(entriesRef.current);
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const timer = setInterval(() => void flush(), RETRY_MS);
    void flush();
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      clearInterval(timer);
    };
  }, [key, flush]);

  const enqueue = useCallback((entry: OutboxEntry) => save([...entriesRef.current, entry]), [save]);
  const retry = useCallback(
    (clientId: string) => {
      save(entriesRef.current.map((e) => (e.client_id === clientId ? { ...e, error: undefined } : e)));
      void flush();
    },
    [save, flush],
  );
  const discard = useCallback((clientId: string) => save(entriesRef.current.filter((e) => e.client_id !== clientId)), [save]);

  return { entries, online, flushing, enqueue, retry, discard, flush };
}
