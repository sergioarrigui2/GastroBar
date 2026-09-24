'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { generateAnalystReport } from '@/lib/analyst/generate';
import { runAction } from '@/lib/actions';
import { assertAgent } from '@/lib/ai/entitlements';

const inputSchema = z.object({ range: z.enum(['7d', '30d', '90d']) });

export async function generateAnalystReportAction(input: z.input<typeof inputSchema>) {
  const result = await runAction(['admin'], async (ctx) => {
    await assertAgent(ctx, 'analista');
    return generateAnalystReport(ctx, inputSchema.parse(input).range);
  });
  if (result.ok) revalidatePath('/admin/analytics');
  return result;
}
