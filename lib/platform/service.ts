import 'server-only';
import { z } from 'zod';
import { resolveAgentAccess } from '@/lib/ai/access';
import { AGENT_ORDER, type AgentId } from '@/lib/ai/agents';
import { AI_PLANS, resolvePlan } from '@/lib/ai/plans';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Operaciones de la consola de plataforma. Usan el rol de servicio (ignoran RLS):
 * llamar SÓLO después de assertPlatformAdmin()/requirePlatformAdmin().
 */

const monthStartUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

export async function listTenants() {
  const admin = createSupabaseAdminClient();
  const since = monthStartUtc();
  const [tenants, profiles, agents, plans, usage] = await Promise.all([
    admin.from('tenants').select('id, name, slug, status, status_reason, created_at').order('created_at', { ascending: false }),
    admin.from('profiles').select('tenant_id, role, is_active'),
    admin.from('tenant_agents').select('tenant_id, agent, enabled, trial_until'),
    admin.from('tenant_ai_plans').select('tenant_id, plan, reports_per_month, monthly_budget_usd, model_tier'),
    admin.from('ai_usage').select('tenant_id, cost_usd').gte('created_at', since),
  ]);
  for (const r of [tenants, profiles, agents, plans, usage]) if (r.error) throw r.error;

  const last30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const orders = await Promise.all(
    (tenants.data ?? []).map((t) =>
      admin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', t.id)
        .eq('status', 'paid')
        .gte('closed_at', last30)
        .then((r) => r.count ?? 0),
    ),
  );

  return (tenants.data ?? []).map((t, i) => {
    const access = resolveAgentAccess((agents.data ?? []).filter((a) => a.tenant_id === t.id));
    const planRow = (plans.data ?? []).find((p) => p.tenant_id === t.id) ?? null;
    return {
      ...t,
      users: (profiles.data ?? []).filter((p) => p.tenant_id === t.id && p.is_active).length,
      activeAgents: AGENT_ORDER.filter((a) => access[a].active),
      trialAgents: AGENT_ORDER.filter((a) => access[a].status === 'trial'),
      plan: resolvePlan(planRow),
      aiCostMonth: (usage.data ?? []).filter((u) => u.tenant_id === t.id).reduce((s, u) => s + Number(u.cost_usd ?? 0), 0),
      paidOrders30d: orders[i] ?? 0,
    };
  });
}

export type PlatformTenant = Awaited<ReturnType<typeof listTenants>>[number];

export const createTenantSchema = z.object({
  business_name: z.string().trim().min(2, 'Escribe el nombre del negocio').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'El identificador sólo admite minúsculas, números y guiones')
    .min(3)
    .max(48),
  owner_name: z.string().trim().min(2, 'Escribe el nombre del dueño').max(80),
  owner_email: z.email('Correo inválido'),
  owner_password: z.string().min(10, 'La contraseña inicial debe tener al menos 10 caracteres').max(72),
  agents: z.array(z.enum(['vigia', 'ingeniero', 'analista', 'comprador', 'mensajero'])),
  trial_days: z.coerce.number().int().min(0).max(90),
  plan: z.enum(['sin_ia', 'prueba', 'basico', 'pro', 'premium']),
});

/**
 * Crea el gastrobar y su dueño (administrador) con contraseña inicial, que el
 * superusuario entrega personalmente. Si algo falla, deshace lo creado.
 */
export async function createTenant(input: z.input<typeof createTenantSchema>) {
  const data = createTenantSchema.parse(input);
  const admin = createSupabaseAdminClient();

  const { data: taken } = await admin.from('tenants').select('id').eq('slug', data.slug).maybeSingle();
  if (taken) throw new Error('Ese identificador ya está en uso');

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: data.owner_email,
    password: data.owner_password,
    email_confirm: true,
    user_metadata: { full_name: data.owner_name },
  });
  if (userError || !created.user) {
    throw new Error(
      userError?.code === 'email_exists' || /already/i.test(userError?.message ?? '')
        ? 'Ya existe un usuario con ese correo'
        : `No se pudo crear el usuario: ${userError?.message ?? 'error desconocido'}`,
    );
  }
  const userId = created.user.id;
  let tenantId: string | null = null;

  try {
    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .insert({ name: data.business_name, slug: data.slug })
      .select('id')
      .single();
    if (tenantError) throw tenantError;
    tenantId = tenant.id;

    const { error: profileError } = await admin
      .from('profiles')
      .insert({ id: userId, tenant_id: tenant.id, role: 'admin', full_name: data.owner_name });
    if (profileError) throw profileError;

    const trialUntil = data.trial_days ? new Date(Date.now() + data.trial_days * 86_400_000).toISOString() : null;
    await setTenantAgents(
      tenant.id,
      AGENT_ORDER.map((agent) => ({ agent, enabled: data.agents.includes(agent), trial_until: trialUntil })),
    );
    await setTenantPlan(tenant.id, { plan: data.plan, reports_per_month: null, monthly_budget_usd: null, model_tier: null });
    return tenant.id;
  } catch (error) {
    if (tenantId) await admin.from('tenants').delete().eq('id', tenantId);
    await admin.auth.admin.deleteUser(userId);
    throw error;
  }
}

export async function setTenantStatus(tenantId: string, status: 'active' | 'suspended', reason: string | null) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('tenants')
    .update({ status, status_reason: status === 'suspended' ? reason || 'Suspendido por la plataforma' : null })
    .eq('id', z.uuid().parse(tenantId));
  if (error) throw error;
}

export async function setTenantNotes(tenantId: string, notes: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('tenants').update({ platform_notes: notes.trim() || null }).eq('id', z.uuid().parse(tenantId));
  if (error) throw error;
}

export const agentEntriesSchema = z.array(
  z.object({
    agent: z.enum(['vigia', 'ingeniero', 'analista', 'comprador', 'mensajero']),
    enabled: z.boolean(),
    /** null = contratado sin vencimiento; fecha = en prueba hasta ese día. */
    trial_until: z.iso.datetime({ offset: true }).nullable(),
  }),
);

export async function setTenantAgents(tenantId: string, entries: Array<{ agent: AgentId; enabled: boolean; trial_until: string | null }>) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('tenant_agents').upsert(
    agentEntriesSchema.parse(entries).map((e) => ({
      tenant_id: z.uuid().parse(tenantId),
      agent: e.agent,
      enabled: e.enabled,
      trial_until: e.enabled ? e.trial_until : null,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'tenant_id,agent' },
  );
  if (error) throw error;
}

export const tenantPlanSchema = z.object({
  plan: z.enum(['sin_ia', 'prueba', 'basico', 'pro', 'premium']),
  reports_per_month: z.coerce.number().int().min(0).max(500).nullable(),
  monthly_budget_usd: z.coerce.number().min(0).max(1000).nullable(),
  model_tier: z.enum(['economy', 'balanced', 'premium']).nullable(),
});

export async function setTenantPlan(tenantId: string, input: z.input<typeof tenantPlanSchema>) {
  const data = tenantPlanSchema.parse(input);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('tenant_ai_plans')
    .upsert({ tenant_id: tenantId, ...data, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

export async function getTenantDetail(tenantId: string) {
  const admin = createSupabaseAdminClient();
  const id = z.uuid().parse(tenantId);
  const since = monthStartUtc();
  const [tenant, profiles, agents, plan, usage, reports, monthCost] = await Promise.all([
    admin.from('tenants').select('*').eq('id', id).maybeSingle(),
    admin.from('profiles').select('id, full_name, role, is_active').eq('tenant_id', id).order('role'),
    admin.from('tenant_agents').select('agent, enabled, trial_until').eq('tenant_id', id),
    admin.from('tenant_ai_plans').select('plan, reports_per_month, monthly_budget_usd, model_tier').eq('tenant_id', id).maybeSingle(),
    admin
      .from('ai_usage')
      .select('id, feature, model, status, input_tokens, output_tokens, cost_usd, created_at')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('ai_reports').select('id', { count: 'exact', head: true }).eq('tenant_id', id).eq('status', 'completed').gte('created_at', since),
    admin.from('ai_usage').select('cost_usd').eq('tenant_id', id).gte('created_at', since),
  ]);
  if (tenant.error) throw tenant.error;
  if (!tenant.data) return null;

  const owners = (profiles.data ?? []).filter((p) => p.role === 'admin');
  const emails = await Promise.all(owners.map((o) => admin.auth.admin.getUserById(o.id).then((r) => r.data.user?.email ?? null)));

  return {
    tenant: tenant.data,
    profiles: profiles.data ?? [],
    owners: owners.map((o, i) => ({ ...o, email: emails[i] })),
    agentRows: agents.data ?? [],
    access: resolveAgentAccess(agents.data ?? []),
    planRow: plan.data,
    plan: resolvePlan(plan.data),
    usage: usage.data ?? [],
    aiCostMonth: (monthCost.data ?? []).reduce((s, u) => s + Number(u.cost_usd ?? 0), 0),
    reportsMonth: reports.count ?? 0,
  };
}

export const PLAN_OPTIONS = Object.values(AI_PLANS);
