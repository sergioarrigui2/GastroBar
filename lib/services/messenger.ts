import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { analyzeSnapshot } from '@/lib/analytics/analyze';
import { buildBriefing } from '@/lib/analytics/briefing';
import type { RawBusinessSnapshot } from '@/lib/analytics/types';
import { detectedValue } from '@/lib/analytics/value';
import type { AnalystReport } from '@/lib/analyst/report';
import { buildDigest, type Digest } from '@/lib/messenger/digest';
import { sendEmail } from '@/lib/messenger/resend';
import { nextRunAt } from '@/lib/purchasing/schedule';
import type { TenantContext } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';
import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;
type TenantInfo = { id: string; name: string; currency: string; locale: string; timezone: string };

/** Envíos manuales permitidos por día (el programado no cuenta). */
export const MANUAL_SENDS_PER_DAY = 5;

/**
 * Arma el resumen de los últimos 7 días. `asService` = llamado por el cron con el
 * rol de servicio (pasa el gastrobar explícito). Sin IA.
 */
export async function buildTenantDigest(supabase: Client, tenant: TenantInfo, asService: boolean): Promise<Digest> {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const money = (n: number) => formatCurrency(n, tenant.currency, tenant.locale);

  const [snap, report, purchase] = await Promise.all([
    supabase.rpc('get_business_snapshot', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      ...(asService ? { p_tenant: tenant.id } : {}),
    }),
    supabase
      .from('ai_reports')
      .select('content, created_at')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('purchase_suggestions')
      .select('created_at, status, lines, total_estimated')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (snap.error) throw snap.error;

  const analysis = analyzeSnapshot(snap.data as unknown as RawBusinessSnapshot, money);
  const latestReport = report.data ? { content: report.data.content as unknown as AnalystReport, created_at: report.data.created_at } : null;
  const draft = purchase.data?.status === 'draft' ? purchase.data : null;
  const draftLines = (draft?.lines as Array<{ urgent?: boolean }> | undefined) ?? [];
  const pending = draft
    ? { lines: draftLines.length, urgent: draftLines.filter((l) => l.urgent).length, total: Number(draft.total_estimated) }
    : null;

  const fmtDay = (d: Date) => new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, day: 'numeric', month: 'short' }).format(d);
  const fresh = latestReport && to.getTime() - new Date(latestReport.created_at).getTime() <= 8 * 86_400_000;
  const detected = detectedValue(analysis);

  return buildDigest({
    business: tenant.name,
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? null,
    periodLabel: `Últimos 7 días (${fmtDay(from)} – ${fmtDay(to)})`,
    money,
    revenue: analysis.changes.revenue,
    orders: analysis.changes.orders,
    avgTicket: analysis.changes.avg_ticket,
    foodCostPct: analysis.ratios.food_cost_pct,
    items: buildBriefing({
      report: latestReport,
      anomalies: analysis.anomalies,
      purchase: draft && pending ? { created_at: draft.created_at, lines: pending.lines, urgent: pending.urgent, total_label: money(pending.total) } : null,
    }),
    detected: { total: detected.total, label: 'esta semana' },
    reportHeadline: fresh ? latestReport!.content.headline : null,
    purchase: pending,
  });
}

export async function getMessengerOverview(ctx: TenantContext) {
  const t = ctx.tenant.id;
  const [settings, schedule, deliveries] = await Promise.all([
    ctx.supabase.from('messenger_settings').select('*').eq('tenant_id', t).maybeSingle(),
    ctx.supabase.from('agent_schedules').select('*').eq('tenant_id', t).eq('agent', 'messenger').maybeSingle(),
    ctx.supabase.from('messenger_deliveries').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(10),
  ]);
  for (const r of [settings, schedule, deliveries]) if (r.error) throw r.error;
  return { settings: settings.data, schedule: schedule.data, deliveries: deliveries.data ?? [] };
}

export const messengerSettingsSchema = z.object({
  emails: z.array(z.email('Hay un correo inválido')).max(5, 'Máximo 5 correos'),
  whatsapp_phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || (v.length >= 8 && v.length <= 15), 'El WhatsApp debe tener entre 8 y 15 dígitos, con indicativo')
    .nullable(),
  is_active: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  weekday: z.coerce.number().int().min(1).max(7),
  day_of_month: z.coerce.number().int().min(1).max(28),
  hour: z.coerce.number().int().min(0).max(23),
});

export async function saveMessengerSettings(ctx: TenantContext, input: z.input<typeof messengerSettingsSchema>) {
  const data = messengerSettingsSchema.parse(input);
  if (data.is_active && data.emails.length === 0) throw new Error('Agrega al menos un correo para activar el envío automático.');

  const { error: settingsError } = await ctx.supabase.from('messenger_settings').upsert(
    { tenant_id: ctx.tenant.id, emails: data.emails, whatsapp_phone: data.whatsapp_phone || null, updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id' },
  );
  if (settingsError) throw settingsError;

  const { data: current } = await ctx.supabase
    .from('agent_schedules')
    .select('last_run_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('agent', 'messenger')
    .maybeSingle();
  const schedule = { frequency: data.frequency, weekday: data.weekday, day_of_month: data.day_of_month, hour: data.hour };
  const next = data.is_active ? nextRunAt({ ...schedule, last_run_at: current?.last_run_at }, new Date(), ctx.tenant.timezone).toISOString() : null;
  const { error } = await ctx.supabase.from('agent_schedules').upsert(
    {
      tenant_id: ctx.tenant.id,
      agent: 'messenger',
      is_active: data.is_active,
      ...schedule,
      horizon_days: 7,
      next_run_at: next,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,agent' },
  );
  if (error) throw error;
}

/** Envío manual ("Enviar ahora") a los correos configurados. */
export async function sendDigestNow(ctx: TenantContext): Promise<number> {
  const { data: settings, error } = await ctx.supabase.from('messenger_settings').select('emails').eq('tenant_id', ctx.tenant.id).maybeSingle();
  if (error) throw error;
  const emails = settings?.emails ?? [];
  if (emails.length === 0) throw new Error('Primero guarda al menos un correo.');

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await ctx.supabase
    .from('messenger_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenant.id)
    .eq('trigger', 'manual')
    .gte('created_at', since);
  if ((count ?? 0) >= MANUAL_SENDS_PER_DAY) throw new Error(`Ya enviaste ${MANUAL_SENDS_PER_DAY} resúmenes manuales hoy. Intenta mañana.`);

  const digest = await buildTenantDigest(ctx.supabase, ctx.tenant, false);
  return deliver(ctx.supabase, ctx.tenant.id, emails, digest, 'manual');
}

/** Envía y deja registro (también si falla). Devuelve cuántos destinatarios. */
export async function deliver(supabase: Client, tenantId: string, emails: string[], digest: Digest, trigger: 'manual' | 'schedule') {
  let providerId: string | null = null;
  let failure: string | null = null;
  try {
    providerId = (await sendEmail({ to: emails, subject: digest.subject, html: digest.html, text: digest.text })).id;
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  await supabase.from('messenger_deliveries').insert({
    tenant_id: tenantId,
    channel: 'email',
    trigger,
    recipients: emails,
    subject: digest.subject,
    status: failure ? 'error' : 'sent',
    provider_id: providerId,
    error: failure,
  });
  if (failure) throw new Error(failure);
  return emails.length;
}
