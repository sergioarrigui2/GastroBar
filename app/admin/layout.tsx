import type { ReactNode } from 'react';
import { signOutAction } from '@/app/actions/auth';
import { AdminNav } from '@/components/admin/AdminNav';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { requirePageRole } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePageRole(['admin']);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="print:hidden sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur md:h-dvh md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex items-center gap-2 px-4 py-3 md:py-5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{ctx.tenant.name}</p>
            <p className="truncate text-xs text-zinc-500">{ctx.profile.full_name} · admin</p>
          </div>
          <ThemeToggle />
        </div>
        <AdminNav />
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
