import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { TenantContext } from '@/lib/tenant-context';
import type { AuditCategory, AuditSeverity, Json } from '@/types/database';

/**
 * Eventos que NO pasan por una tabla con disparador de auditoría porque los hace el servidor con el
 * rol de servicio (alta de personal, PIN, conexiones de IA…). Todo lo demás lo registra la base de
 * datos sola (migración 027). Registrar nunca debe romper la operación: si falla, queda en el log del servidor.
 */
export type AuditEvent = {
  action: string;
  category: AuditCategory;
  severity?: AuditSeverity;
  entity?: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
};
export type AuditActor = { id: string | null; name: string | null; role: string | null };

export const actorOf = (ctx: Pick<TenantContext, 'userId' | 'role' | 'profile'>): AuditActor => ({
  id: ctx.userId,
  name: ctx.profile.full_name,
  role: ctx.role,
});

export async function recordAuditEvent(tenantId: string, actor: AuditActor | null, event: AuditEvent): Promise<void> {
  try {
    const { error } = await createSupabaseAdminClient()
      .from('audit_log')
      .insert({
        tenant_id: tenantId,
        actor_id: actor?.id ?? null,
        actor_name: actor?.name ?? null,
        actor_role: actor?.role ?? null,
        action: event.action,
        category: event.category,
        severity: event.severity ?? 'important',
        entity: event.entity ?? null,
        entity_id: event.entityId ?? null,
        details: (event.details ?? {}) as Json,
      });
    if (error) console.error('[audit]', event.action, error.message);
  } catch (error) {
    console.error('[audit]', event.action, error);
  }
}
