'use client';

import { BarChart3, BookOpen, ChefHat, ClipboardCheck, FileCheck2, LayoutGrid, LifeBuoy, LineChart, Martini, Package, Printer, QrCode, Settings, ShoppingCart, Smartphone, Sparkles, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canAny, type Permission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** `perms`: permisos que habilitan el acceso a un supervisor (sin `perms`, la pantalla es sólo del administrador). */
type NavLink = { href: string; label: string; icon: typeof BarChart3; perms?: Permission[] };
const LINKS: NavLink[] = [
  { href: '/admin', label: 'Métricas', icon: BarChart3 },
  { href: '/admin/ai', label: 'Equipo IA', icon: Sparkles },
  { href: '/admin/analytics', label: 'Análisis', icon: LineChart },
  { href: '/admin/menu', label: 'Menú', icon: BookOpen },
  { href: '/admin/inventory', label: 'Inventario', icon: Package, perms: ['inventory.view'] },
  { href: '/admin/purchasing', label: 'Comprador', icon: ShoppingCart, perms: ['purchasing.use', 'suppliers.manage'] },
  { href: '/admin/floor', label: 'Salón y mesas', icon: LayoutGrid },
  { href: '/admin/qr', label: 'Menú QR', icon: QrCode },
  { href: '/admin/staff', label: 'Personal', icon: Users },
  { href: '/admin/audit', label: 'Auditoría', icon: ClipboardCheck },
  { href: '/admin/einvoicing', label: 'Facturación', icon: FileCheck2 },
  { href: '/admin/printing', label: 'Impresión', icon: Printer },
  { href: '/admin/settings', label: 'Ajustes', icon: Settings },
  { href: '/admin/help', label: 'Ayuda', icon: LifeBuoy },
  { href: '/cash', label: 'Caja', icon: Wallet },
  { href: '/waiter', label: 'Comandero', icon: Smartphone, perms: ['orders.take'] },
  { href: '/kds/kitchen', label: 'KDS Cocina', icon: ChefHat },
  { href: '/kds/bar', label: 'KDS Barra', icon: Martini },
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
  const links = LINKS.filter(
    (l) =>
      (l.href !== '/kds/kitchen' || kitchenScreen) &&
      (l.href !== '/kds/bar' || barScreen) &&
      // Un supervisor sólo ve lo que sus permisos habilitan; el administrador, todo.
      (access.role === 'admin' || Boolean(l.perms && canAny(access, ...l.perms))),
  );
  return (
    <nav aria-label="Administración" className="scrollbar-none flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:pb-0">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold',
              active ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
