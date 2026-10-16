import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from '@/app/actions/auth';
import { AdminNav } from '@/components/admin/AdminNav';
import { Avatar, TenantLogo } from '@/components/ui/Avatar';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PERMISSIONS } from '@/lib/permissions';
import { isPlatformAdmin } from '@/lib/platform/auth';
import { requirePageRole } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [ctx, platform] = await Promise.all([requirePageRole(['admin', 'supervisor'], PERMISSIONS), isPlatformAdmin()]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="print:hidden sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur md:h-dvh md:overflow-y-auto md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex items-center gap-2 px-4 py-3 md:py-5">
          <TenantLogo url={ctx.tenant.logo_url} name={ctx.tenant.name} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{ctx.tenant.name}</p>
            <Link href="/perfil" className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" title="Mi perfil">
              <Avatar name={ctx.profile.full_name} url={ctx.profile.avatar_url} size="sm" className="size-5 text-[10px]" />
              <span className="truncate">{ctx.profile.full_name} · {ctx.role === 'supervisor' ? 'supervisor' : 'admin'}</span>
            </Link>
          </div>
          <ThemeToggle />
        </div>
        <AdminNav
          kitchenScreen={ctx.tenant.uses_kitchen_screen}
          barScreen={ctx.tenant.uses_bar_screen}
          access={{ role: ctx.role, permissions: ctx.profile.permissions }}
        />
        {platform && (
          <Link href="/platform" className="mx-4 mt-4 hidden rounded-xl border border-dashed border-brand-400/60 px-3 py-2 text-sm font-semibold text-brand-600 md:block">
            Consola de plataforma →
          </Link>
        )}
        <form action={signOutAction} className="hidden px-4 pt-6 md:block">
          <button type="submit" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Cerrar sesión
          </button>
        </form>
      </aside>
      <div className="min-w-0 px-4 py-5 md:px-8 md:py-8">{children}</div>
    </div>
  );
}
