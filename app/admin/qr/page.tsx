import Link from 'next/link';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { PrintButton } from '@/components/admin/PrintButton';
import { Card } from '@/components/ui/primitives';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Menú QR' };

async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const toSvg = (url: string) => QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

export default async function QrPage() {
  const ctx = await requirePageRole(['admin']);
  const origin = await appOrigin();
  const menuUrl = `${origin}/m/${ctx.tenant.slug}`;

  const { data: tables, error } = await ctx.supabase
    .from('tables')
    .select('id, label, zone_id')
    .eq('tenant_id', ctx.tenant.id)
    .order('sort_order')
    .order('label');
  if (error) throw error;

  const [menuSvg, tableSvgs] = await Promise.all([
    toSvg(menuUrl),
    Promise.all(tables.map(async (t) => ({ ...t, url: `${menuUrl}?mesa=${encodeURIComponent(t.label)}`, svg: await toSvg(`${menuUrl}?mesa=${encodeURIComponent(t.label)}`) }))),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="mr-auto text-2xl font-bold">Menú QR</h1>
        <PrintButton label="Imprimir códigos" />
      </div>

      {!ctx.tenant.public_menu_enabled && (
        <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 print:hidden dark:bg-amber-500/15 dark:text-amber-200">
          El menú público está desactivado. Actívalo en{' '}
          <Link href="/admin/settings" className="font-semibold underline">
            Ajustes
          </Link>{' '}
          para que los códigos funcionen.
        </p>
      )}

      <Card className="flex flex-wrap items-center gap-5 print:hidden">
        <div className="size-40 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: menuSvg }} />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-semibold">Menú general</h2>
          <p className="text-sm text-zinc-500">Para redes sociales, la entrada o la barra.</p>
          <a href={menuUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400">
            {menuUrl}
          </a>
          {!process.env.NEXT_PUBLIC_APP_URL && (
            <p className="text-xs text-zinc-500">
              Consejo: define <code>NEXT_PUBLIC_APP_URL</code> con tu dominio de producción para que los QR no apunten a localhost.
            </p>
          )}
        </div>
      </Card>

      <section>
        <h2 className="mb-3 font-semibold print:hidden">Un código por mesa (muestra el número de mesa al cliente)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-6">
          {tableSvgs.map((t) => (
            <div
              key={t.id}
              className="flex break-inside-avoid flex-col items-center rounded-2xl border border-zinc-200 bg-white p-4 text-center text-zinc-900 dark:border-zinc-800"
            >
              <p className="text-xs font-semibold uppercase tracking-wide">{ctx.tenant.name}</p>
              <div className="my-2 w-full max-w-40" dangerouslySetInnerHTML={{ __html: t.svg }} />
              <p className="text-2xl font-black">Mesa {t.label}</p>
              <p className="text-xs text-zinc-500">Escanea para ver la carta</p>
            </div>
          ))}
          {tableSvgs.length === 0 && <p className="col-span-full text-sm text-zinc-500">Crea mesas en Salón y mesas.</p>}
        </div>
      </section>
    </div>
  );
}
