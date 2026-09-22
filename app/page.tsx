import { redirect } from 'next/navigation';
import { getTenantContext, HOME_BY_ROLE, TenantContextError } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/** Enruta a cada usuario al módulo de su rol. */
export default async function HomePage() {
  let destination: string;
  try {
    const ctx = await getTenantContext();
    destination = HOME_BY_ROLE[ctx.role];
  } catch (error) {
    if (!(error instanceof TenantContextError)) throw error;
    destination = error.code === 'no_profile' ? '/onboarding' : '/login';
  }
  redirect(destination);
}
