import { createClient } from '@supabase/supabase-js';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicMenu, type PublicMenuData } from '@/components/public/PublicMenu';
import { getPublicEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/** Se regenera cada minuto: refleja precios y agotados sin consultar la base en cada visita. */
export const revalidate = 60;

async function loadMenu(slug: string): Promise<PublicMenuData | null> {
  const env = getPublicEnv();
  // Cliente anónimo sin cookies: sólo puede ejecutar get_public_menu (security definer).
  const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.rpc('get_public_menu', { p_slug: slug });
  if (error) throw error;
  return (data as unknown as PublicMenuData | null) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const menu = await loadMenu((await params).slug);
  return menu ? { title: `Menú · ${menu.tenant.name}`, description: `Carta de ${menu.tenant.name}` } : { title: 'Menú' };
}

export default async function PublicMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) notFound();
  const menu = await loadMenu(slug);
  if (!menu) notFound();
  return <PublicMenu menu={menu} />;
}
