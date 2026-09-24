import { NextResponse } from 'next/server';
import { nextRunAt } from '@/lib/purchasing/schedule';
import { runPurchasePlan } from '@/lib/services/purchasing';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/agents — ejecuta los agentes programados cuyo horario ya venció.
 * Protegido con `Authorization: Bearer <CRON_SECRET>`. Se llama cada hora desde
 * Supabase (pg_cron + pg_net, ver README) y una vez al día desde Vercel Cron como
 * respaldo. El Comprador programado no usa IA: su costo es cero.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const { data: due, error } = await admin
    .from('agent_schedules')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at')
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tenantIds = [...new Set((due ?? []).map((s) => s.tenant_id))];
  const { data: tenants } = tenantIds.length
    ? await admin.from('tenants').select('id, timezone').in('id', tenantIds)
    : { data: [] as Array<{ id: string; timezone: string }> };
  const tzOf = new Map((tenants ?? []).map((t) => [t.id, t.timezone]));

  const results: Array<{ tenant_id: string; ok: boolean; suggestion_id?: string; error?: string }> = [];
  for (const schedule of due ?? []) {
    const timezone = tzOf.get(schedule.tenant_id) ?? 'America/Bogota';
    let lastError: string | null = null;
    let suggestionId: string | undefined;
    try {
      suggestionId = await runPurchasePlan(admin, schedule.tenant_id, schedule.horizon_days, 'schedule');
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    // Se reprograma aunque falle, para no reintentar en bucle cada hora.
    const next = nextRunAt({ ...schedule, last_run_at: now.toISOString() }, now, timezone).toISOString();
    await admin
      .from('agent_schedules')
      .update({ last_run_at: now.toISOString(), next_run_at: next, last_error: lastError })
      .eq('id', schedule.id);
    results.push({ tenant_id: schedule.tenant_id, ok: !lastError, suggestion_id: suggestionId, error: lastError ?? undefined });
  }

  return NextResponse.json({ ran: results.length, results });
}
