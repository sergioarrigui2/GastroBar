import { MessageCircle } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Solicitar GastroBar' };

/**
 * El registro abierto está cerrado (migración 011): los gastrobares los crea el
 * equipo de GastroBar desde la consola de plataforma.
 */
export default function OnboardingPage() {
  const phone = (process.env.NEXT_PUBLIC_SALES_WHATSAPP ?? '').replace(/\D/g, '');
  const text = encodeURIComponent('Hola, quiero conocer GastroBar POS para mi negocio.');
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-5 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-zinc-900 text-2xl dark:bg-zinc-800">🍸</div>
        <h1 className="text-2xl font-bold">GastroBar POS se activa con tu asesor</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Creamos tu gastrobar, cargamos tu menú contigo y activamos los agentes de IA que necesitas. Escríbenos y te mostramos una demo.
        </p>
        {phone.length >= 8 ? (
          <a
            href={`https://wa.me/${phone}?text=${text}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="size-5" /> Pedir una demo por WhatsApp
          </a>
        ) : (
          <p className="text-sm text-zinc-500">Pídele a tu asesor de GastroBar que cree tu cuenta.</p>
        )}
        <p className="text-sm text-zinc-500">
          ¿Ya eres cliente?{' '}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Ingresa aquí
          </Link>
        </p>
      </div>
    </main>
  );
}
