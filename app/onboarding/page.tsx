import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { OnboardingForm } from './OnboardingForm';

export const metadata = { title: 'Crear gastrobar' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (userId) {
    const { data: profile } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (profile) redirect('/');
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold">Crea tu gastrobar</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500">
          Quedarás como administrador. Luego podrás dar de alta meseros, cocina, barra y agentes de IA.
        </p>
        <OnboardingForm needsCredentials={!userId} />
      </div>
    </main>
  );
}
