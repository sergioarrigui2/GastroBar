'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { runAction } from '@/lib/actions';
import { assertAgent } from '@/lib/ai/entitlements';
import { messengerSettingsSchema, saveMessengerSettings, sendDigestNow } from '@/lib/services/messenger';

const PATH = '/admin/ai/mensajero';

export async function saveMessengerSettingsAction(input: z.input<typeof messengerSettingsSchema>) {
  const result = await runAction(['admin'], async (ctx) => {
    await assertAgent(ctx, 'mensajero');
    return saveMessengerSettings(ctx, input);
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function sendDigestNowAction() {
  const result = await runAction(['admin'], async (ctx) => {
    await assertAgent(ctx, 'mensajero');
    return sendDigestNow(ctx);
  });
  revalidatePath(PATH);
  return result;
}
