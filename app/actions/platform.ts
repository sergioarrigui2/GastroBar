'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { toUserMessage } from '@/lib/errors';
import { assertPlatformAdmin } from '@/lib/platform/auth';
import {
  type agentEntriesSchema,
  createTenant,
  type createTenantSchema,
  setTenantAgents,
  setTenantNotes,
  setTenantPlan,
  setTenantStatus,
  type tenantPlanSchema,
} from '@/lib/platform/service';
import type { ActionResult } from '@/types/domain';

/** Toda acción de plataforma verifica primero que quien llama es superusuario. */
async function platformAction<T>(fn: () => Promise<T>, tenantId?: string): Promise<ActionResult<T>> {
  try {
    await assertPlatformAdmin();
    const data = await fn();
    revalidatePath('/platform');
    if (tenantId) revalidatePath(`/platform/tenants/${tenantId}`);
    return { ok: true, data };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('[platform]', error);
    return { ok: false, error: error instanceof Error && !('code' in error) ? error.message : toUserMessage(error) };
  }
}

export async function createTenantAction(input: z.input<typeof createTenantSchema>) {
  return platformAction(() => createTenant(input));
}

export async function setTenantStatusAction(tenantId: string, status: 'active' | 'suspended', reason: string | null) {
  return platformAction(() => setTenantStatus(tenantId, status, reason), tenantId);
}

export async function setTenantAgentsAction(tenantId: string, entries: z.input<typeof agentEntriesSchema>) {
  return platformAction(() => setTenantAgents(tenantId, entries), tenantId);
}

export async function setTenantPlanAction(tenantId: string, input: z.input<typeof tenantPlanSchema>) {
  return platformAction(() => setTenantPlan(tenantId, input), tenantId);
}

export async function setTenantNotesAction(tenantId: string, notes: string) {
  return platformAction(() => setTenantNotes(tenantId, notes), tenantId);
}
