import { Card } from '@/components/ui/primitives';
import { MODEL_PRICING } from '@/lib/ai/pricing';
import { requirePageRole } from '@/lib/tenant-context';
import { cn, formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Consumo de IA' };

const FEATURE: Record<string, string> = {
  analyst_report: 'Informe del Analista',
  purchase_agent: 'Agente de compras',
  analyst_chat: 'Chat con el analista',
};

const usd = (n: number, digits = 2) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: 4 }).format(n);

export default async function AiUsagePage() {
  const ctx = await requirePageRole(['admin']);
  const { locale, timezone } = ctx.tenant;

  // Mes calendario actual en la zona horaria del negocio.
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const ym = `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
  const since = new Date(now.getTime() - 92 * 86_400_000).toISOString();

  const { data: rows, error } = await ctx.supabase
    .from('ai_usage')
    .select('id, feature, model, status, input_tokens, output_tokens, reasoning_tokens, cost_usd, duration_ms, created_at')
    .eq('tenant_id', ctx.tenant.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  const monthOf = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7);
  const thisMonth = rows.filter((r) => monthOf(r.created_at) === ym);
  const sum = (list: typeof rows) => list.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

  const months = new Map<string, { cost: number; calls: number }>();
  for (const r of rows) {
    const m = monthOf(r.created_at);
    const cur = months.get(m) ?? { cost: 0, calls: 0 };
    cur.cost += Number(r.cost_usd ?? 0);
    cur.calls += 1;
    months.set(m, cur);
  }
  const byFeature = new Map<string, { cost: number; calls: number; input: number; output: number }>();
  for (const r of thisMonth) {
    const cur = byFeature.get(r.feature) ?? { cost: 0, calls: 0, input: 0, output: 0 };
    cur.cost += Number(r.cost_usd ?? 0);
    cur.calls += 1;
    cur.input += r.input_tokens;
    cur.output += r.output_tokens;
    byFeature.set(r.feature, cur);
  }
  const monthCost = sum(thisMonth);
  const okCalls = thisMonth.filter((r) => r.status === 'ok');
  const errors = thisMonth.length - okCalls.length;
  const unpriced = rows.filter((r) => r.cost_usd === null).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Consumo de IA</h1>
        <p className="text-sm text-zinc-500">
          Cada llamada a un modelo queda registrada con sus tokens y su costo en dólares, calculado con los precios oficiales de Anthropic.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Este mes</p>
          <p className="text-2xl font-bold tabular-nums">{usd(monthCost)}</p>
          <p className="text-xs text-zinc-500">{thisMonth.length} llamada(s) al modelo</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Costo promedio por llamada</p>
          <p className="text-2xl font-bold tabular-nums">{thisMonth.length ? usd(monthCost / thisMonth.length, 3) : '—'}</p>
          <p className="text-xs text-zinc-500">Incluye reintentos y errores</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tokens este mes</p>
          <p className="text-2xl font-bold tabular-nums">
            {new Intl.NumberFormat(locale).format(thisMonth.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0))}
          </p>
          <p className="text-xs text-zinc-500">
            {new Intl.NumberFormat(locale).format(thisMonth.reduce((s, r) => s + r.reasoning_tokens, 0))} de razonamiento
          </p>
        </Card>
        <Card className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Llamadas con error</p>
          <p className={cn('text-2xl font-bold tabular-nums', errors > 0 && 'text-amber-600')}>{errors}</p>
          <p className="text-xs text-zinc-500">También se cobran los tokens usados</p>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Este mes por función</h2>
          {byFeature.size === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">Todavía no hay consumo este mes.</p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-3 font-semibold">Función</th>
                  <th className="py-2 pr-3 text-right font-semibold">Llamadas</th>
                  <th className="py-2 pr-3 text-right font-semibold">Tokens (entrada / salida)</th>
                  <th className="py-2 text-right font-semibold">Costo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {[...byFeature.entries()].map(([feature, v]) => (
                  <tr key={feature}>
                    <td className="py-2 pr-3 font-medium">{FEATURE[feature] ?? feature}</td>
                    <td className="py-2 pr-3 text-right">{v.calls}</td>
                    <td className="py-2 pr-3 text-right">
                      {new Intl.NumberFormat(locale).format(v.input)} / {new Intl.NumberFormat(locale).format(v.output)}
                    </td>
                    <td className="py-2 text-right font-semibold">{usd(v.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Últimos meses</h2>
          {months.size === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">Sin consumo registrado.</p>
          ) : (
            <ul className="space-y-1.5 text-sm tabular-nums">
              {[...months.entries()].map(([m, v]) => (
                <li key={m} className="flex justify-between gap-3">
                  <span>{m}</span>
                  <span>
                    {v.calls} llamada(s) · <b>{usd(v.cost)}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-2 mt-5 text-sm font-semibold">Precios por millón de tokens (USD)</h3>
          <ul className="space-y-1 text-xs text-zinc-500 tabular-nums">
            {Object.entries(MODEL_PRICING).map(([model, p]) => (
              <li key={model} className="flex justify-between gap-3">
                <span>{model}</span>
                <span>
                  entrada {usd(p.input)} · salida {usd(p.output)}
                </span>
              </li>
            ))}
          </ul>
          {unpriced > 0 && (
            <p className="mt-2 text-xs text-amber-600">{unpriced} llamada(s) usaron un modelo sin precio registrado; su costo no se sumó.</p>
          )}
        </Card>
      </section>

      <Card>
        <h2 className="mb-3 font-semibold">Registro de llamadas</h2>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Aún no se ha usado ninguna función de IA.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-3 font-semibold">Fecha</th>
                  <th className="py-2 pr-3 font-semibold">Función</th>
                  <th className="py-2 pr-3 font-semibold">Modelo</th>
                  <th className="py-2 pr-3 text-right font-semibold">Entrada</th>
                  <th className="py-2 pr-3 text-right font-semibold">Salida</th>
                  <th className="py-2 pr-3 text-right font-semibold">Duración</th>
                  <th className="py-2 text-right font-semibold">Costo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.slice(0, 100).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap py-2 pr-3">{formatDateTime(r.created_at, locale, timezone)}</td>
                    <td className="py-2 pr-3">
                      {FEATURE[r.feature] ?? r.feature}
                      {r.status === 'error' && <span className="ml-1 text-xs font-semibold text-amber-600">error</span>}
                    </td>
                    <td className="py-2 pr-3 text-zinc-500">{r.model}</td>
                    <td className="py-2 pr-3 text-right">{new Intl.NumberFormat(locale).format(r.input_tokens)}</td>
                    <td className="py-2 pr-3 text-right">
                      {new Intl.NumberFormat(locale).format(r.output_tokens)}
                      {r.reasoning_tokens > 0 && (
                        <span className="block text-xs text-zinc-500">{new Intl.NumberFormat(locale).format(r.reasoning_tokens)} razon.</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">{r.duration_ms ? `${Math.round(r.duration_ms / 1000)} s` : '—'}</td>
                    <td className="py-2 text-right font-medium">{r.cost_usd === null ? 's/p' : usd(Number(r.cost_usd), 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
