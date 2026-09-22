'use client';

import { BarChart3, BookOpen, ChefHat, LayoutGrid, Martini, Package, QrCode, Settings, Smartphone, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/admin', label: 'Métricas', icon: BarChart3 },
  { href: '/admin/menu', label: 'Menú', icon: BookOpen },
  { href: '/admin/inventory', label: 'Inventario', icon: Package },
  { href: '/admin/floor', label: 'Salón y mesas', icon: LayoutGrid },
  { href: '/admin/qr', label: 'Menú QR', icon: QrCode },
  { href: '/admin/staff', label: 'Personal', icon: Users },
  { href: '/admin/settings', label: 'Ajustes', icon: Settings },
  { href: '/cash', label: 'Caja', icon: Wallet },
  { href: '/waiter', label: 'Comandero', icon: Smartphone },
  { href: '/kds/kitchen', label: 'KDS Cocina', icon: ChefHat },
  { href: '/kds/bar', label: 'KDS Barra', icon: Martini },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Administración" className="scrollbar-none flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:pb-0">
      {LINKS.map(({ href, label, icon: Icon }) => {
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
