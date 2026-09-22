'use client';

import {
  Bell,
  Check,
  ChefHat,
  ChevronLeft,
  Clock,
  LogOut,
  Printer,
  Wallet,
  Martini,
  Plus,
  Receipt,
  Search,
  Send,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
  Users,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  cancelOrderAction,
  getOpenBillAction,
  setTableStatusAction,
  submitOrderAction,
  updateItemsStatusAction,
} from '@/app/actions/orders';
import { signOutAction } from '@/app/actions/auth';
import { SplitBillModal } from '@/components/billing/SplitBillModal';
import { Badge, Button, Stepper } from '@/components/ui/primitives';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useRealtimeRefresh } from '@/components/ui/useRealtimeRefresh';
import { cn, formatCurrency, minutesSince } from '@/lib/utils';
import type { MenuSnapshot } from '@/lib/services/menu';
import type { TableStatusEntry, TableStatusSnapshot } from '@/lib/services/tables';
import type { AppRole, ItemStatus, MenuProduct, Modifier, TableBill, TableStatus } from '@/types/domain';
import { ModifierSheet, type ModifierSelection } from './ModifierSheet';

type CartLine = {
  key: string;
  product: MenuProduct;
  quantity: number;
  modifiers: Modifier[];
  notes: string;
};

type Tab = 'menu' | 'cart' | 'bill';
type ReadyAlert = { id: string; tableId: string | null; text: string };

const TABLE_STYLES: Record<TableStatus, string> = {
  free: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-500/10 dark:text-emerald-100',
  occupied: 'border-brand-400 bg-brand-50 text-zinc-900 dark:border-brand-600/70 dark:bg-brand-500/15 dark:text-brand-50',
  reserved: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700/60 dark:bg-sky-500/10 dark:text-sky-100',
  cleaning: 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};
const TABLE_LABELS: Record<TableStatus, string> = {
  free: 'Libre',
  occupied: 'Ocupada',
  reserved: 'Reservada',
  cleaning: 'Limpieza',
};
const ITEM_STATUS: Record<Exclude<ItemStatus, 'cancelled'>, { label: string; className: string }> = {
  pending: { label: 'En cola', className: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  in_preparation: { label: 'Preparando', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' },
  ready: { label: 'Listo', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' },
  delivered: { label: 'Entregado', className: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200' },
};

const lineKey = (productId: string, modifierIds: string[], notes: string) =>
  `${productId}|${[...modifierIds].sort().join(',')}|${notes.trim().toLowerCase()}`;

export function ComanderoMobile({
  tenant,
  user,
  snapshot,
  menu,
}: {
  tenant: { id: string; name: string; currency: string; locale: string };
  user: { name: string; role: AppRole };
  snapshot: TableStatusSnapshot;
  menu: MenuSnapshot;
}) {
  const router = useRouter();
  const money = useCallback((n: number) => formatCurrency(n, tenant.currency, tenant.locale), [tenant.currency, tenant.locale]);

  const [zoneId, setZoneId] = useState<string>('all');
  const [tableId, setTableId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('menu');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [carts, setCarts] = useState<Record<string, CartLine[]>>({});
  const [orderNotes, setOrderNotes] = useState('');
  const [guests, setGuests] = useState(2);
  const [sheet, setSheet] = useState<{ product: MenuProduct; editKey?: string } | null>(null);
  const [bill, setBill] = useState<TableBill | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [alerts, setAlerts] = useState<ReadyAlert[]>([]);
  const [pending, startTransition] = useTransition();

  const table = snapshot.tables.find((t) => t.id === tableId) ?? null;
  const cart = useMemo(() => (tableId ? (carts[tableId] ?? []) : []), [carts, tableId]);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const cartTotal = cart.reduce(
    (s, l) => s + l.quantity * (l.product.price + l.modifiers.reduce((m, x) => m + x.price_delta, 0)),
    0,
  );
  const readyByTable = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of snapshot.tables) if (t.open_order) map.set(t.id, t.open_order.items_by_status.ready);
    return map;
  }, [snapshot.tables]);

  const notify = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => setToast({ text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const loadBill = useCallback(async (id: string) => {
    setBillLoading(true);
    const result = await getOpenBillAction(id);
    setBillLoading(false);
    if (result.ok) setBill(result.data);
    else notify(result.error, 'error');
  }, [notify]);

  // ── Realtime: mesas, ítems (alertas "listo") y stock (disponibilidad del menú) ──
  const orderToTable = useMemo(() => {
    const map = new Map<string, TableStatusEntry>();
    for (const t of snapshot.tables) if (t.open_order) map.set(t.open_order.id, t);
    return map;
  }, [snapshot.tables]);

  const realtime = useRealtimeRefresh({
    channel: `floor:${tenant.id}`,
    subscriptions: [
      { table: 'tables', event: 'UPDATE', filter: `tenant_id=eq.${tenant.id}` },
      {
        table: 'order_items',
        filter: `tenant_id=eq.${tenant.id}`,
        onChange: (payload) => {
          if (payload.eventType !== 'UPDATE') return;
          const { new: item, old } = payload;
          if (item.status === 'ready' && old.status !== 'ready') {
            const t = orderToTable.get(item.order_id);
            setAlerts((prev) =>
              [
                {
                  id: `${item.id}-${Date.now()}`,
                  tableId: t?.id ?? null,
                  text: `${t ? `Mesa ${t.label}` : 'Barra'}: ${item.quantity}× ${item.product_name} listo`,
                },
                ...prev,
              ].slice(0, 4),
            );
            navigator.vibrate?.(120);
          }
        },
      },
      { table: 'ingredients', event: 'UPDATE', filter: `tenant_id=eq.${tenant.id}` },
    ],
    onRefresh: () => {
      router.refresh();
      if (tableId && tab === 'bill') void loadBill(tableId);
    },
    debounceMs: 400,
  });

  // ── Navegación ──
  const openTable = (entry: TableStatusEntry) => {
    setTableId(entry.id);
    setBill(null);
    setSearch('');
    const hasDraft = (carts[entry.id]?.length ?? 0) > 0;
    const nextTab: Tab = hasDraft ? 'cart' : entry.open_order && entry.open_order.items_by_status.ready > 0 ? 'bill' : 'menu';
    setTab(nextTab);
    if (nextTab === 'bill') void loadBill(entry.id);
    setGuests(entry.open_order?.guests ?? Math.min(entry.seats, 2));
  };
  const goTab = (next: Tab) => {
    setTab(next);
    if (next === 'bill' && tableId) void loadBill(tableId);
  };

  // ── Carrito ──
  const upsertLine = (product: MenuProduct, selection: ModifierSelection, replaceKey?: string) => {
    if (!tableId) return;
    const key = lineKey(product.product_id, selection.modifiers.map((m) => m.id), selection.notes);
    setCarts((prev) => {
      const lines = (prev[tableId] ?? []).filter((l) => l.key !== replaceKey);
      const existing = lines.find((l) => l.key === key);
      const next = existing
        ? lines.map((l) =>
            l.key === key
              ? { ...l, quantity: replaceKey ? selection.quantity : Math.min(99, l.quantity + selection.quantity) }
              : l,
          )
        : [...lines, { key, product, quantity: selection.quantity, modifiers: selection.modifiers, notes: selection.notes }];
      return { ...prev, [tableId]: next };
    });
  };
  const setLineQty = (key: string, quantity: number) =>
    tableId &&
    setCarts((prev) => ({
      ...prev,
      [tableId]: (prev[tableId] ?? []).map((l) => (l.key === key ? { ...l, quantity } : l)),
    }));
  const removeLine = (key: string) =>
    tableId && setCarts((prev) => ({ ...prev, [tableId]: (prev[tableId] ?? []).filter((l) => l.key !== key) }));

  const modifiersFor = useCallback(
    (p: MenuProduct) =>
      menu.modifiers.filter(
        (m) => m.product_id === p.product_id || m.category_id === p.category_id || (m.product_id === null && m.category_id === null),
      ),
    [menu.modifiers],
  );

  const quickAdd = (p: MenuProduct) => {
    upsertLine(p, { quantity: 1, modifiers: [], notes: '' });
    notify(`+1 ${p.name}`);
  };

  const sendOrder = () => {
    if (!tableId || cart.length === 0) return;
    startTransition(async () => {
      const result = await submitOrderAction({
        table_id: tableId,
        items: cart.map((l) => ({
          product_id: l.product.product_id,
          quantity: l.quantity,
          modifier_ids: l.modifiers.map((m) => m.id),
          notes: l.notes || undefined,
        })),
        notes: orderNotes.trim() || undefined,
        guests: table?.open_order ? undefined : guests,
      });
      if (!result.ok) {
        notify(result.error, 'error');
        return;
      }
      setCarts((prev) => ({ ...prev, [tableId]: [] }));
      setOrderNotes('');
      notify(result.data.round > 1 ? `Ronda ${result.data.round} enviada` : `Orden #${result.data.order_number} enviada`);
      router.refresh();
      goTab('bill');
    });
  };

  const deliver = (itemIds: string[]) => {
    if (itemIds.length === 0 || !tableId) return;
    startTransition(async () => {
      const result = await updateItemsStatusAction({ item_ids: itemIds, status: 'delivered' });
      if (!result.ok) notify(result.error, 'error');
      else {
        notify(`${result.data} ítem(s) entregados`);
        setAlerts((prev) => prev.filter((a) => a.tableId !== tableId));
        await loadBill(tableId);
      }
    });
  };

  const changeTableStatus = (status: TableStatus) => {
    if (!tableId) return;
    startTransition(async () => {
      const result = await setTableStatusAction(tableId, status);
      if (!result.ok) notify(result.error, 'error');
      else router.refresh();
    });
  };

  const cancelOrder = () => {
    if (!bill || !tableId || !confirm('¿Anular la orden completa? Se devolverá el stock.')) return;
    startTransition(async () => {
      const result = await cancelOrderAction(bill.order.id);
      if (!result.ok) notify(result.error, 'error');
      else {
        notify('Orden anulada');
        setBill(null);
        router.refresh();
      }
    });
  };

  // ── Filtros de menú ──
  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return menu.products.filter(
      (p) =>
        (categoryId === 'all' || p.category_id === categoryId) &&
        (!term || p.name.toLowerCase().includes(term) || p.category_name.toLowerCase().includes(term)),
    );
  }, [menu.products, categoryId, search]);

  const visibleTables = snapshot.tables.filter((t) => zoneId === 'all' || t.zone_id === zoneId);

  // ═════════════════════════════════ Render ═════════════════════════════════
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      {/* Alertas de "listo para servir" */}
      {alerts.length > 0 && (
        <div className="fixed inset-x-0 top-0 z-40 mx-auto max-w-2xl space-y-1 p-2">
          {alerts.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setAlerts((prev) => prev.filter((x) => x.id !== a.id));
                const t = snapshot.tables.find((x) => x.id === a.tableId);
                if (t) {
                  setTableId(t.id);
                  goTab('bill');
                }
              }}
              className="flex w-full animate-pop items-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3 text-left font-semibold text-white shadow-lg"
            >
              <Bell className="size-5 shrink-0" />
              <span className="flex-1">{a.text}</span>
              <span className="text-xs opacity-80">Ver</span>
            </button>
          ))}
        </div>
      )}

      {/* ───────────── Vista: mapa de mesas ───────────── */}
      {!table && (
        <>
          <header className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/90 px-4 pb-2 pt-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-bold">{tenant.name}</h1>
                <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                  {user.name} ·{' '}
                  {realtime === 'live' ? (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <span className="size-2 rounded-full bg-emerald-500" /> En vivo
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600">
                      <WifiOff className="size-3" /> Reconectando
                    </span>
                  )}
                </p>
              </div>
              {(user.role === 'admin' || user.role === 'cashier') && (
                <Link href="/cash" aria-label="Caja" className="grid size-10 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <Wallet className="size-5" />
                </Link>
              )}
              <ThemeToggle />
              <form action={signOutAction}>
                <button type="submit" aria-label="Cerrar sesión" className="grid size-10 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <LogOut className="size-5" />
                </button>
              </form>
            </div>
            <nav aria-label="Zonas" className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
              {[{ id: 'all', name: 'Todas' }, ...snapshot.zones].map((z) => (
                <button
                  key={z.id}
                  onClick={() => setZoneId(z.id)}
                  aria-pressed={zoneId === z.id}
                  className={cn(
                    'h-10 shrink-0 rounded-full px-4 text-sm font-semibold',
                    zoneId === z.id ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-200/70 dark:bg-zinc-800',
                  )}
                >
                  {z.name}
                </button>
              ))}
            </nav>
          </header>

          <div className="flex gap-3 px-4 py-3 text-xs text-zinc-500">
            <span>Libres {snapshot.summary.free}</span>
            <span>Ocupadas {snapshot.summary.occupied}</span>
            <span>Reservadas {snapshot.summary.reserved}</span>
          </div>

          <main className="grid grid-cols-3 gap-3 px-4 pb-8 sm:grid-cols-4">
            {visibleTables.map((t) => {
              const ready = readyByTable.get(t.id) ?? 0;
              const draft = carts[t.id]?.length ?? 0;
              return (
                <button
                  key={t.id}
                  onClick={() => openTable(t)}
                  className={cn(
                    'relative flex aspect-square flex-col items-start justify-between rounded-2xl border-2 p-3 text-left transition-transform active:scale-95',
                    TABLE_STYLES[t.status],
                  )}
                >
                  {ready > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 grid size-7 animate-bounce place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow">
                      {ready}
                    </span>
                  )}
                  <span className="text-2xl font-black leading-none">{t.label}</span>
                  <span className="w-full">
                    {t.open_order ? (
                      <>
                        <span className="tabular block truncate text-sm font-bold">{money(t.open_order.remaining)}</span>
                        <span suppressHydrationWarning className="flex items-center gap-1 text-xs opacity-75">
                          <Clock className="size-3" /> {minutesSince(t.open_order.opened_at)} min
                        </span>
                      </>
                    ) : (
                      <span className="flex items-center gap-1 text-xs opacity-75">
                        <Users className="size-3" /> {t.seats} · {TABLE_LABELS[t.status]}
                      </span>
                    )}
                    {draft > 0 && <span className="mt-0.5 block text-[11px] font-semibold text-brand-700 dark:text-brand-400">Borrador</span>}
                  </span>
                </button>
              );
            })}
            {visibleTables.length === 0 && (
              <p className="col-span-full py-12 text-center text-sm text-zinc-500">No hay mesas configuradas en esta zona.</p>
            )}
          </main>
        </>
      )}

      {/* ───────────── Vista: mesa seleccionada ───────────── */}
      {table && (
        <>
          <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-zinc-200 bg-zinc-50/90 px-2 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
            <button
              onClick={() => setTableId(null)}
              aria-label="Volver a mesas"
              className="grid size-11 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="size-6" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold">Mesa {table.label}</h1>
              <p className="truncate text-xs text-zinc-500">
                {table.zone_name}
                {table.open_order && ` · Orden #${table.open_order.order_number} · ${money(table.open_order.total)}`}
              </p>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 pb-44">
            {/* ── Tab Menú ── */}
            {tab === 'menu' && (
              <>
                <div className="sticky top-[61px] z-10 space-y-2 bg-zinc-50 px-4 pb-2 pt-3 dark:bg-zinc-950">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar producto…"
                      aria-label="Buscar producto"
                      className="h-12 w-full rounded-2xl border border-zinc-200 bg-white pl-10 pr-3 text-base dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </label>
                  <nav aria-label="Categorías" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
                    {[{ id: 'all', name: 'Todo', station: null as null | 'bar' | 'kitchen' }, ...menu.categories].map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setCategoryId(c.id)}
                        aria-pressed={categoryId === c.id}
                        className={cn(
                          'flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold',
                          categoryId === c.id ? 'bg-brand-500 text-zinc-950' : 'bg-zinc-200/70 dark:bg-zinc-800',
                        )}
                      >
                        {c.station === 'bar' && <Martini className="size-4" />}
                        {c.station === 'kitchen' && <ChefHat className="size-4" />}
                        {c.name}
                      </button>
                    ))}
                  </nav>
                </div>
                <ul className="divide-y divide-zinc-200 px-4 dark:divide-zinc-800">
                  {products.map((p) => {
                    const soldOut = !p.is_available;
                    return (
                      <li key={p.product_id} className="flex items-center gap-2 py-1">
                        <button
                          disabled={soldOut}
                          onClick={() => setSheet({ product: p })}
                          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left disabled:opacity-40"
                        >
                          {p.image_url && <img src={p.image_url} alt="" loading="lazy" className="size-12 shrink-0 rounded-xl object-cover" />}
                          <span className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold">{p.name}</span>
                          <span className="flex items-center gap-2 text-sm text-zinc-500">
                            <span className="tabular">{money(p.price)}</span>
                            {soldOut && <Badge className="bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">Agotado</Badge>}
                            {!soldOut && p.available_portions !== null && p.available_portions <= 5 && (
                              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                                Quedan {p.available_portions}
                              </Badge>
                            )}
                          </span>
                          </span>
                        </button>
                        <button
                          disabled={soldOut}
                          onClick={() => quickAdd(p)}
                          aria-label={`Agregar ${p.name}`}
                          className="grid size-14 shrink-0 place-items-center rounded-2xl bg-zinc-900 text-white active:scale-95 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
                        >
                          <Plus className="size-6" />
                        </button>
                      </li>
                    );
                  })}
                  {products.length === 0 && <li className="py-12 text-center text-sm text-zinc-500">Sin resultados</li>}
                </ul>
              </>
            )}

            {/* ── Tab Comanda (carrito) ── */}
            {tab === 'cart' && (
              <div className="space-y-4 px-4 pt-4">
                {cart.length === 0 ? (
                  <div className="py-16 text-center text-zinc-500">
                    <ShoppingBag className="mx-auto mb-3 size-10 opacity-50" />
                    <p>La comanda está vacía</p>
                    <Button variant="secondary" className="mt-4" onClick={() => setTab('menu')}>
                      Ir al menú
                    </Button>
                  </div>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {cart.map((l) => (
                        <li key={l.key} className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                          <div className="flex items-start gap-2">
                            <button className="min-w-0 flex-1 text-left" onClick={() => setSheet({ product: l.product, editKey: l.key })}>
                              <p className="font-semibold">
                                {l.product.station === 'bar' ? '🍸' : '🍽️'} {l.product.name}
                              </p>
                              {l.modifiers.length > 0 && (
                                <p className="text-sm text-brand-700 dark:text-brand-400">{l.modifiers.map((m) => m.name).join(' · ')}</p>
                              )}
                              {l.notes && <p className="text-sm italic text-zinc-500">“{l.notes}”</p>}
                            </button>
                            <button
                              onClick={() => removeLine(l.key)}
                              aria-label={`Quitar ${l.product.name}`}
                              className="grid size-10 place-items-center rounded-full text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="size-5" />
                            </button>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <Stepper value={l.quantity} onChange={(q) => setLineQty(l.key, q)} />
                            <span className="tabular font-bold">
                              {money(l.quantity * (l.product.price + l.modifiers.reduce((s, m) => s + m.price_delta, 0)))}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {!table.open_order && (
                      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                        <span className="flex items-center gap-2 font-medium">
                          <Users className="size-5" /> Comensales
                        </span>
                        <Stepper value={guests} onChange={setGuests} max={50} />
                      </div>
                    )}
                    <textarea
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value.slice(0, 500))}
                      rows={2}
                      placeholder="Nota general (ej. cumpleaños, alérgicos en la mesa)…"
                      className="w-full rounded-2xl border border-zinc-200 bg-white p-3 text-base dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </>
                )}
              </div>
            )}

            {/* ── Tab Cuenta ── */}
            {tab === 'bill' && (
              <div className="px-4 pt-4">
                {billLoading && !bill && <p className="py-12 text-center text-zinc-500">Cargando cuenta…</p>}
                {!billLoading && !bill && (
                  <div className="space-y-4 py-10 text-center text-zinc-500">
                    <Receipt className="mx-auto size-10 opacity-50" />
                    <p>Esta mesa no tiene una orden abierta.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {(['free', 'reserved', 'cleaning'] as const)
                        .filter((s) => s !== table.status)
                        .map((s) => (
                          <Button key={s} variant="secondary" size="sm" disabled={pending} onClick={() => changeTableStatus(s)}>
                            Marcar {TABLE_LABELS[s].toLowerCase()}
                          </Button>
                        ))}
                    </div>
                  </div>
                )}
                {bill && (
                  <BillView
                    bill={bill}
                    money={money}
                    pending={pending}
                    canCancel={user.role === 'admin' || user.role === 'cashier'}
                    onDeliver={deliver}
                    onCancel={cancelOrder}
                    onCharge={() => setSplitOpen(true)}
                  />
                )}
              </div>
            )}
          </main>

          {/* Barra inferior: acción principal + pestañas (zona del pulgar) */}
          <div className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto max-w-2xl border-t border-zinc-200 bg-white/95 px-3 pt-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
            {cartCount > 0 && tab !== 'bill' && (
              <Button size="xl" className="mb-2 w-full" onClick={tab === 'cart' ? sendOrder : () => setTab('cart')} disabled={pending}>
                {tab === 'cart' ? <Send className="size-5" /> : <ShoppingBag className="size-5" />}
                {tab === 'cart' ? (pending ? 'Enviando…' : `Enviar comanda · ${money(cartTotal)}`) : `Ver comanda (${cartCount}) · ${money(cartTotal)}`}
              </Button>
            )}
            <nav aria-label="Secciones de la mesa" className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'menu', label: 'Menú', icon: UtensilsCrossed, badge: 0 },
                  { id: 'cart', label: 'Comanda', icon: ShoppingBag, badge: cartCount },
                  { id: 'bill', label: 'Cuenta', icon: Receipt, badge: readyByTable.get(table.id) ?? 0 },
                ] as const
              ).map(({ id, label, icon: Icon, badge }) => (
                <button
                  key={id}
                  onClick={() => goTab(id)}
                  aria-current={tab === id ? 'page' : undefined}
                  className={cn(
                    'relative flex h-14 flex-col items-center justify-center rounded-xl text-xs font-semibold',
                    tab === id ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white' : 'text-zinc-500',
                  )}
                >
                  <Icon className="size-6" />
                  {label}
                  {badge > 0 && (
                    <span
                      className={cn(
                        'absolute right-[calc(50%-1.5rem)] top-1 grid min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-white',
                        id === 'bill' ? 'bg-emerald-600' : 'bg-brand-600',
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {sheet && (
            <ModifierSheet
              key={sheet.editKey ?? sheet.product.product_id}
              product={sheet.product}
              modifiers={modifiersFor(sheet.product)}
              initial={sheet.editKey ? cart.find((l) => l.key === sheet.editKey) : undefined}
              currency={tenant.currency}
              locale={tenant.locale}
              onClose={() => setSheet(null)}
              onConfirm={(selection) => {
                upsertLine(sheet.product, selection, sheet.editKey);
                if (!sheet.editKey) notify(`+${selection.quantity} ${sheet.product.name}`);
                setSheet(null);
              }}
            />
          )}

          {bill && splitOpen && (
            <SplitBillModal
              open
              onClose={() => setSplitOpen(false)}
              bill={bill}
              currency={tenant.currency}
              locale={tenant.locale}
              title={`Mesa ${table.label}`}
              onRegistered={(result) => {
                notify(result.status === 'paid' ? 'Cuenta pagada · mesa liberada' : `Pago registrado · saldo ${money(result.remaining)}`);
                router.refresh();
                if (result.status === 'paid') {
                  setSplitOpen(false);
                  setBill(null);
                  setTableId(null);
                } else {
                  void loadBill(table.id);
                }
              }}
            />
          )}
        </>
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            'fixed inset-x-4 bottom-40 z-50 mx-auto max-w-sm animate-pop rounded-2xl px-4 py-3 text-center text-sm font-semibold shadow-lg',
            toast.tone === 'ok' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-red-600 text-white',
          )}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function BillView({
  bill,
  money,
  pending,
  canCancel,
  onDeliver,
  onCancel,
  onCharge,
}: {
  bill: TableBill;
  money: (n: number) => string;
  pending: boolean;
  canCancel: boolean;
  onDeliver: (ids: string[]) => void;
  onCancel: () => void;
  onCharge: () => void;
}) {
  const rounds = useMemo(() => {
    const map = new Map<number, TableBill['items']>();
    for (const item of bill.items) map.set(item.round, [...(map.get(item.round) ?? []), item]);
    return [...map.entries()];
  }, [bill.items]);
  const readyIds = bill.items.filter((i) => i.status === 'ready').map((i) => i.id);
  const remaining = Math.max(0, bill.order.total - bill.order.paid_amount);

  return (
    <div className="space-y-4">
      {readyIds.length > 0 && (
        <Button variant="success" size="lg" className="w-full" disabled={pending} onClick={() => onDeliver(readyIds)}>
          <Bell className="size-5" /> Entregar {readyIds.length} ítem(s) listos
        </Button>
      )}

      {rounds.map(([round, items]) => (
        <section key={round}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Ronda {round}</h3>
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {items.map((item) => {
              const status = item.status === 'cancelled' ? null : ITEM_STATUS[item.status];
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {item.quantity}× {item.product_name}
                    </p>
                    {item.modifiers.length > 0 && (
                      <p className="truncate text-xs text-zinc-500">{item.modifiers.map((m) => m.name).join(' · ')}</p>
                    )}
                    {status && <Badge className={cn('mt-1', status.className)}>{status.label}</Badge>}
                  </div>
                  <span className="tabular text-sm font-semibold">{money(item.line_total)}</span>
                  {item.status === 'ready' && (
                    <button
                      onClick={() => onDeliver([item.id])}
                      disabled={pending}
                      aria-label={`Entregar ${item.product_name}`}
                      className="grid size-10 place-items-center rounded-full bg-emerald-600 text-white"
                    >
                      <Check className="size-5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <dl className="tabular space-y-1 rounded-2xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
        <div className="flex justify-between">
          <dt>Total</dt>
          <dd className="font-semibold">{money(bill.order.total)}</dd>
        </div>
        {bill.order.paid_amount > 0 && (
          <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
            <dt>Pagado ({bill.payments.length})</dt>
            <dd>−{money(bill.order.paid_amount)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-zinc-300 pt-2 text-lg font-bold dark:border-zinc-700">
          <dt>Saldo</dt>
          <dd>{money(remaining)}</dd>
        </div>
      </dl>

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => window.open(`/print/bill/${bill.order.id}?auto=1`, '_blank', 'width=420,height=720')}
      >
        <Printer className="size-4" /> Imprimir precuenta
      </Button>
      <Button size="xl" className="w-full" onClick={onCharge} disabled={remaining <= 0 || pending}>
        <Receipt className="size-5" /> Cobrar / Dividir cuenta
      </Button>
      {canCancel && bill.order.paid_amount === 0 && (
        <Button variant="ghost" className="w-full text-red-600" onClick={onCancel} disabled={pending}>
          Anular orden
        </Button>
      )}
    </div>
  );
}
