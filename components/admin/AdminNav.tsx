'use client';

import { BarChart3, ChevronDown, BookOpen, ChefHat, ClipboardCheck, FileCheck2, LayoutGrid, LifeBuoy, LineChart, Martini, Package, Printer, QrCode, Settings, ShoppingCart, Smartphone, Sparkles, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { canAny, type Permission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** `perms`: permisos que habilitan el acceso a un supervisor (sin `perms`, la pantalla es sólo del administrador). */
type NavLink = { href: string; label: string; icon: typeof BarChart3; perms?: Permission[] };
/** Orden lógico: primero cómo va el negocio, luego la operación del día, lo que se vende y se compra, la sala, el equipo y, al final, la configuración. */
const GROUPS: { title: string; links: NavLink[] }[] = [
  {
    title: 'Resumen',
    links: [
      { href: '/admin', label: 'Métricas', icon: BarChart3 },
      { href: '/admin/analytics', label: 'Análisis', icon: LineChart },
      { href: '/admin/ai', label: 'Equipo IA', icon: Sparkles },
    ],
  },
  {
    title: 'Operación del día',
    links: [
      { href: '/waiter', label: 'Comandero', icon: Smartphone, perms: ['orders.take'] },
      { href: '/cash', label: 'Caja', icon: Wallet },
      { href: '/kds/kitchen', label: 'KDS Cocina', icon: ChefHat },
      { href: '/kds/bar', label: 'KDS Barra', icon: Martini },
    ],
  },
  {
    title: 'Carta e inventario',
    links: [
      { href: '/admin/menu', label: 'Menú', icon: BookOpen },
      { href: '/admin/inventory', label: 'Inventario', icon: Package, perms: ['inventory.view'] },
      { href: '/admin/purchasing', label: 'Comprador', icon: ShoppingCart, perms: ['purchasing.use', 'suppliers.manage'] },
    ],
  },
  {
    title: 'Sala',
    links: [
      { href: '/admin/floor', label: 'Salón y mesas', icon: LayoutGrid },
      { href: '/admin/qr', label: 'Menú QR', icon: QrCode },
    ],
  },
  {
    title: 'Equipo y control',
    links: [
      { href: '/admin/staff', label: 'Personal', icon: Users },
      { href: '/admin/audit', label: 'Auditoría', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Configuración',
    links: [
      { href: '/admin/settings', label: 'Ajustes', icon: Settings },
      { href: '/admin/printing', label: 'Impresión', icon: Printer },
      { href: '/admin/einvoicing', label: 'Facturación', icon: FileCheck2 },
      { href: '/admin/help', label: 'Ayuda', icon: LifeBuoy },
    ],
  },
];

export function AdminNav({
  kitchenScreen = true,
  barScreen = true,
  access = { role: 'admin' },
}: {
  kitchenScreen?: boolean;
  barScreen?: boolean;
  access?: { role: string; permissions?: string[] };
}) {
  const pathname = usePathname();
  // Un negocio sin pantalla de cocina o de barra no ve esos accesos.
  const visible = (l: NavLink) =>
    (l.href !== '/kds/kitchen' || kitchenScreen) &&
    (l.href !== '/kds/bar' || barScreen) &&
    // Un supervisor sólo ve lo que sus permisos habilitan; el administrador, todo.
    (access.role === 'admin' || Boolean(l.perms && canAny(access, ...l.perms)));
  const groups = GROUPS.map((g) => ({ ...g, links: g.links.filter(visible) })).filter((g) => g.links.length > 0);
  const isActive = (href: string) => (href === '/admin' ? pathname === href : pathname.startsWith(href));
  // Cada sección se abre y se cierra; arranca abierta la que contiene la página actual y la primera.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (g: (typeof groups)[number], i: number) => open[g.title] ?? (i === 0 || g.links.some((l) => isActive(l.href)));
  return (
    <nav aria-label="Administración" className="scrollbar-none flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
      {groups.map((g, i) => {
        const expanded = isOpen(g, i);
        return (
          <div key={g.title} className="flex shrink-0 gap-1 md:flex-col md:gap-0">
            <button
              type="button"
              onClick={() => setOpen((cur) => ({ ...cur, [g.title]: !expanded }))}
              aria-expanded={expanded}
              className="hidden items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold text-zinc-800 hover:bg-zinc-100 md:flex dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {g.title}
              <ChevronDown className={cn('size-4 text-zinc-400 transition-transform', !expanded && '-rotate-90')} />
            </button>
            <div className={cn('flex gap-1 md:flex-col md:gap-0 md:border-l md:border-zinc-200 md:ml-4 md:pl-1 dark:md:border-zinc-800', !expanded && 'md:hidden')}>
              {g.links.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium',
                      active ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
