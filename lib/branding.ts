import 'server-only';
import { cookies } from 'next/headers';

/** Marca del negocio para el login (que aún no sabe quién entra): la recuerda el navegador tras ingresar. Sólo datos públicos. */
const COOKIE = 'gb_brand';
export type Brand = { name: string; logo: string | null };

const validLogo = (v: unknown): v is string => typeof v === 'string' && v.length <= 500 && /^https:\/\/[^\s]+\/storage\/v1\/object\/public\//.test(v);

export async function rememberBrand(brand: Brand): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify({ n: brand.name.slice(0, 120), l: brand.logo }), {
    maxAge: 60 * 60 * 24 * 400,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function readBrand(): Promise<Brand | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { n?: unknown; l?: unknown };
    if (typeof v.n !== 'string' || !v.n) return null;
    return { name: v.n, logo: validLogo(v.l) ? v.l : null };
  } catch {
    return null;
  }
}
