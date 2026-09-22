'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/lib/actions';
import { generateApiKey } from '@/lib/api-keys';

const createKeySchema = z.object({
  profile_id: z.uuid('Elige un usuario Agente IA'),
  name: z.string().trim().min(1, 'Ponle un nombre a la clave').max(80),
});

/** Crea una clave y devuelve el valor completo UNA sola vez (sólo se guarda su hash). */
export async function createApiKeyAction(input: z.input<typeof createKeySchema>) {
  const result = await runAction(['admin'], async (ctx) => {
    const data = createKeySchema.parse(input);
    const { key, prefix, hash } = generateApiKey();
    const { error } = await ctx.supabase.from('api_keys').insert({
      profile_id: data.profile_id,
      name: data.name,
      key_prefix: prefix,
      key_hash: hash,
    });
    if (error) throw error;
    return { key };
  });
  if (result.ok) revalidatePath('/admin/staff');
  return result;
}

export async function revokeApiKeyAction(keyId: string) {
  const result = await runAction(['admin'], async (ctx) => {
    const { error } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenant.id)
      .eq('id', z.uuid().parse(keyId))
      .is('revoked_at', null);
    if (error) throw error;
  });
  if (result.ok) revalidatePath('/admin/staff');
  return result;
}
