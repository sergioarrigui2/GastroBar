'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/lib/actions';
import { actorOf, recordAuditEvent } from '@/lib/audit/record';
import { disconnect } from '@/lib/oauth/server';

/** Desconecta un asistente: sus tokens mueren al instante y su agente queda desactivado. */
export async function disconnectAiConnectionAction(connectionId: string) {
  return runAction(['admin'], async (ctx) => {
    const id = z.uuid().parse(connectionId);
    // RLS: el admin sólo ve conexiones de su gastrobar.
    const { data, error } = await ctx.supabase.from('ai_connections').select('id, client_name').eq('tenant_id', ctx.tenant.id).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Conexión no encontrada');
    await disconnect(ctx.tenant.id, id);
    await recordAuditEvent(ctx.tenant.id, actorOf(ctx), { action: 'ai.disconnected', category: 'seguridad', severity: 'important', entity: 'ai_connection', entityId: id, details: { client: data.client_name } });
    revalidatePath('/admin/staff');
    return true;
  });
}
