import { z } from 'zod';
import type { PurchaseLine } from './forecast.ts';

/** Revisión opcional del pedido con IA (Haiku): señala, nunca modifica cantidades. */
export const purchaseReviewSchema = z.object({
  summary: z.string().min(10).max(500).describe('Dos o tres frases sobre el pedido en conjunto.'),
  flags: z
    .array(
      z.object({
        ingredient: z.string().max(80).describe('Nombre exacto del insumo, como aparece en la lista.'),
        suggestion: z.enum(['subir', 'bajar', 'revisar']),
        note: z.string().max(240).describe('Por qué, en una frase y sin inventar cifras.'),
      }),
    )
    .max(6)
    .describe('Sólo los insumos que merecen atención; si todo se ve bien, lista vacía.'),
});
export type PurchaseReview = z.infer<typeof purchaseReviewSchema>;

export const PURCHASE_REVIEW_SYSTEM = `Eres el comprador de un gastrobar en Colombia. El sistema ya calculó el pedido con un pronóstico por día de la semana, festivos, merma y stock de seguridad. Tu trabajo es una segunda mirada de sentido común:
- Señala sólo lo que un comprador experimentado cuestionaría: cantidades que parecen desproporcionadas frente al consumo diario, insumos urgentes, pronósticos de baja confianza, insumos perecederos pedidos en exceso, o festivos/puentes que podrían mover la demanda.
- No recalcules cantidades ni inventes cifras. Usa los nombres exactos de la lista.
- Sé breve y concreto. Si el pedido se ve razonable, dilo y deja la lista de señales vacía.`;

export function purchaseReviewPrompt(input: {
  business: string;
  coverage: string;
  notes: string[];
  lines: PurchaseLine[];
}): string {
  const rows = input.lines.map(
    (l) =>
      `- ${l.name} (${l.unit}): stock ${l.stock}, consumo diario prom. ${l.avg_daily}, esperado ${l.demand}, pedir ${l.order_qty}${l.pack_label ? ` (${l.packs} × ${l.pack_label})` : ''}, confianza ${l.confidence}${l.urgent ? ', URGENTE' : ''}`,
  );
  return `Gastrobar: ${input.business}\nPeriodo a cubrir: ${input.coverage}\nAvisos del sistema:\n${input.notes.map((n) => `- ${n}`).join('\n') || '- ninguno'}\n\nPedido calculado:\n${rows.join('\n')}`;
}
