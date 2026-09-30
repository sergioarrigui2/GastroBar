import { Bot, Check, ShieldCheck, X } from 'lucide-react';
import { redirect } from 'next/navigation';
import { approveAuthorizationAction, denyAuthorizationAction } from '@/app/actions/oauth';
import { assistantLabel, normalizeScopes, SCOPES } from '@/lib/oauth/core';
import { getClient } from '@/lib/oauth/server';
import { getTenantContext } from '@/lib/tenant-context';

export const metadata = { title: 'Conectar asistente' };
export const dynamic = 'force-dynamic';

type Params = Record<string, string | undefined>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">{children}</div>
    </main>
  );
}

/** Pantalla de permisos (OAuth): el administrador decide si su asistente de IA puede leer los datos del gastrobar. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const client = p.client_id ? await getClient(p.client_id) : null;
  // Sin cliente o dirección registrados, NUNCA se redirige: se muestra el error aquí.
  if (!client || !p.redirect_uri || !client.redirect_uris.includes(p.redirect_uri)) {
    return (
      <Shell>
        <h1 className="text-xl font-bold">Solicitud de conexión inválida</h1>
        <p className="text-sm text-zinc-500">Vuelve a tu asistente y agrega GastroBar de nuevo como conector.</p>
      </Shell>
    );
  }
  const fail = (error: string, description: string) => {
    const url = new URL(p.redirect_uri!);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    if (p.state) url.searchParams.set('state', p.state);
    redirect(url.toString());
  };
  if (p.response_type !== 'code') fail('unsupported_response_type', 'Sólo se admite response_type=code');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') fail('invalid_request', 'Se requiere PKCE con S256');

  const ctx = await getTenantContext().catch(() => null);
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(p as Record<string, string>).toString()}`)}`);
  const label = assistantLabel(client.client_name, p.redirect_uri);
  const scopes = normalizeScopes(p.scope);

  if (ctx.role !== 'admin') {
    return (
      <Shell>
        <h1 className="text-xl font-bold">Sólo el administrador puede conectar asistentes</h1>
        <p className="text-sm text-zinc-500">Pide al administrador de {ctx.tenant.name} que conecte {label} con su usuario.</p>
      </Shell>
    );
  }

  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'scope', 'resource'] as const;
  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
          <Bot className="size-6" />
        </span>
        <div>
          <h1 className="text-xl font-bold leading-tight">
            {label} quiere conectarse a {ctx.tenant.name}
          </h1>
          <p className="text-sm text-zinc-500">Estás conectado como {ctx.profile.full_name} (administrador).</p>
        </div>
      </div>

      <section className="space-y-2 text-sm">
        <p className="font-semibold">Podrá:</p>
        <ul className="space-y-1.5">
          {scopes.map((s) => (
            <li key={s} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {SCOPES[s]}
            </li>
          ))}
        </ul>
        <p className="pt-2 font-semibold">No podrá:</p>
        <ul className="space-y-1.5 text-zinc-600 dark:text-zinc-300">
          {['Crear, modificar ni anular comandas, pagos o productos', 'Ver datos de tus clientes (nombres, cédulas o correos)', 'Ver proveedores, personal ni configuración', 'Ver datos de otros negocios'].map((t) => (
            <li key={t} className="flex gap-2">
              <X className="mt-0.5 size-4 shrink-0 text-red-600" /> {t}
            </li>
          ))}
        </ul>
      </section>

      <p className="flex gap-2 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        <ShieldCheck className="size-4 shrink-0" />
        Las respuestas de {label} las paga tu propia suscripción. Puedes desconectarlo cuando quieras en Personal → Conexiones de IA, y ahí verás cada consulta que haga.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <form action={denyAuthorizationAction}>
          {hidden.map((k) => (
            <input key={k} type="hidden" name={k} value={p[k] ?? ''} />
          ))}
          <button type="submit" className="h-12 w-full rounded-xl bg-zinc-100 font-semibold hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700">
            Cancelar
          </button>
        </form>
        <form action={approveAuthorizationAction}>
          {hidden.map((k) => (
            <input key={k} type="hidden" name={k} value={p[k] ?? ''} />
          ))}
          <button type="submit" className="h-12 w-full rounded-xl bg-brand-500 font-bold text-zinc-950 hover:bg-brand-400">
            Permitir
          </button>
        </form>
      </div>
      <p className="text-center text-xs text-zinc-400">Volverás a {new URL(p.redirect_uri).hostname}</p>
    </Shell>
  );
}
