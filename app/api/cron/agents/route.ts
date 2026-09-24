import { NextResponse } from 'next/server';
import { nextRunAt } from '@/lib/purchasing/schedule';
import { buildTenantDigest, deliver } from '@/lib/services/messenger';
import { runPurchasePlan } from '@/lib/services/purchasing';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/agents — ejecuta los agentes programados cuyo horario ya venció
 * (Comprador y Mensajero). Protegido con `Authorization: Bearer <CRON_SECRET>`.
 * Se llama cada hora desde Supabase (pg_cron + pg_net, ver README) y una vez al
 * día desde Vercel Cron como respaldo. Ninguno de los dos usa IA: costo cero.
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
  const [{ data: tenants }, { data: settings }] = tenantIds.length
    ? await Promise.all([
        admin.from('tenants').select('id, name, currency, locale, timezone').in('id', tenantIds),
        admin.from('messenger_settings').select('tenant_id, emails').in('tenant_id', tenantIds),
      ])
    : [{ data: [] }, { data: [] }];
  const tenantOf = new Map((tenants ?? []).map((t) => [t.id, t]));
  const emailsOf = new Map((settings ?? []).map((s) => [s.tenant_id, s.emails]));

  const results: Array<{ tenant_id: string; agent: string; ok: boolean; error?: string }> = [];
  for (const schedule of due ?? []) {
    const tenant = tenantOf.get(schedule.tenant_id);
    let lastError: string | null = null;
    try {
      if (!tenant) throw new Error('Gastrobar no encontrado');
      if (schedule.agent === 'purchase') {
        await runPurchasePlan(admin, schedule.tenant_id, schedule.horizon_days, 'schedule');
      } else {
        const emails = emailsOf.get(schedule.tenant_id) ?? [];
        if (emails.length === 0) throw new Error('No hay correos configurados');
        await deliver(admin, schedule.tenant_id, emails, await buildTenantDigest(admin, tenant, true), 'schedule');
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    // Se reprograma aunque falle, para no reintentar en bucle cada hora.
    const next = nextRunAt({ ...schedule, last_run_at: now.toISOString() }, now, tenant?.timezone ?? 'America/Bogota').toISOString();
    await admin
      .from('agent_schedules')
      .update({ last_run_at: now.toISOString(), next_run_at: next, last_error: lastError })
      .eq('id', schedule.id);
    results.push({ tenant_id: schedule.tenant_id, agent: schedule.agent, ok: !lastError, error: lastError ?? undefined });
  }

  return NextResponse.json({ ran: results.length, results });
}
