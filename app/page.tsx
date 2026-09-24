import { redirect } from 'next/navigation';
import { isPlatformAdmin } from '@/lib/platform/auth';
import { getTenantContext, HOME_BY_ROLE, TenantContextError } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/** Enruta a cada usuario al módulo de su rol (o a la consola de plataforma). */
export default async function HomePage() {
  let destination: string;
  try {
    const ctx = await getTenantContext();
    destination = HOME_BY_ROLE[ctx.role];
  } catch (error) {
    if (!(error instanceof TenantContextError)) throw error;
    if (error.code === 'no_profile' && (await isPlatformAdmin())) destination = '/platform';
    else destination = { no_profile: '/login?error=no_account', inactive: '/login?error=inactive', suspended: '/login?error=suspended' }[error.code as string] ?? '/login';
  }
  redirect(destination);
}
