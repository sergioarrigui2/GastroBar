import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from '@/app/actions/auth';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { requirePlatformAdmin } from '@/lib/platform/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Plataforma', template: '%s · Plataforma GastroBar' } };

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <ShieldCheck className="size-5 text-brand-600" aria-hidden />
          <Link href="/platform" className="mr-auto font-bold">
            GastroBar · Plataforma
          </Link>
          <ThemeToggle />
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
