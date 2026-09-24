import type { BriefingItem } from '../analytics/briefing';
import type { KpiChange } from '../analytics/types';

/**
 * Resumen del Mensajero. Se arma sólo con lo que los agentes ya calcularon
 * (cifras exactas, alertas del Vigía, informe del Analista, pedido del Comprador):
 * no llama al modelo.
 */
export type DigestInput = {
  business: string;
  appUrl: string | null;
  periodLabel: string;
  money: (n: number) => string;
  revenue: KpiChange;
  orders: KpiChange;
  avgTicket: KpiChange;
  foodCostPct: number | null;
  items: BriefingItem[];
  detected: { total: number; label: string } | null;
  reportHeadline: string | null;
  purchase: { lines: number; urgent: number; total: number } | null;
};

export type Digest = { subject: string; text: string; html: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function delta(c: KpiChange): string {
  if (c.change_pct === null) return '';
  return `${c.change_pct > 0 ? '+' : ''}${c.change_pct}% vs. semana anterior`;
}

const SOURCE = { analista: 'Analista', reglas: 'Vigía', comprador: 'Comprador' } as const;

export function buildDigest(d: DigestInput): Digest {
  const subject =
    d.items.length > 0
      ? `${d.business}: ${d.money(d.revenue.current)} en ventas y ${d.items.length} ${d.items.length === 1 ? 'punto' : 'puntos'} para revisar`
      : `${d.business}: ${d.money(d.revenue.current)} en ventas esta semana`;

  const kpiLines = [
    `Ventas: ${d.money(d.revenue.current)} ${delta(d.revenue)}`.trim(),
    `Cuentas: ${d.orders.current} ${delta(d.orders)}`.trim(),
    `Ticket promedio: ${d.money(d.avgTicket.current)} ${delta(d.avgTicket)}`.trim(),
    ...(d.foodCostPct !== null ? [`Food cost: ${d.foodCostPct}%`] : []),
  ];

  const text = [
    `*${d.business}* · ${d.periodLabel}`,
    '',
    ...kpiLines.map((l) => `• ${l}`),
    '',
    ...(d.items.length
      ? ['*Para revisar:*', ...d.items.map((i, n) => `${n + 1}. ${i.title} (${SOURCE[i.source]}): ${i.action}`), '']
      : ['Tus agentes no ven nada fuera de lo normal. 👌', '']),
    ...(d.reportHeadline ? [`*Analista:* ${d.reportHeadline}`, ''] : []),
    ...(d.purchase && d.purchase.lines > 0
      ? [`*Comprador:* pedido listo con ${d.purchase.lines} insumo(s)${d.purchase.urgent ? `, ${d.purchase.urgent} urgente(s)` : ''} por ${d.money(d.purchase.total)}.`, '']
      : []),
    ...(d.detected && d.detected.total > 0 ? [`*Plata detectada ${d.detected.label}:* ${d.money(d.detected.total)}`, ''] : []),
    ...(d.appUrl ? [`Ver más: ${d.appUrl}/admin/ai`] : []),
  ]
    .join('\n')
    .trim();

  const color = { critical: '#dc2626', warning: '#d97706', info: '#0284c7' } as const;
  const row = (label: string, value: string, note: string) =>
    `<tr><td style="padding:6px 0;color:#52525b">${esc(label)}</td><td style="padding:6px 0;text-align:right;font-weight:700">${esc(value)}</td><td style="padding:6px 0 6px 12px;color:#71717a;font-size:12px;text-align:right">${esc(note)}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#d97706;font-weight:700">Mensajero · GastroBar</p>
  <h1 style="margin:0 0 4px;font-size:22px">${esc(d.business)}</h1>
  <p style="margin:0 0 20px;color:#71717a;font-size:14px">${esc(d.periodLabel)}</p>
  <div style="background:#fff;border-radius:14px;padding:16px 20px;margin-bottom:16px">
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      ${row('Ventas', d.money(d.revenue.current), delta(d.revenue))}
      ${row('Cuentas', String(d.orders.current), delta(d.orders))}
      ${row('Ticket promedio', d.money(d.avgTicket.current), delta(d.avgTicket))}
      ${d.foodCostPct !== null ? row('Food cost', `${d.foodCostPct}%`, 'sano: 28–35%') : ''}
    </table>
  </div>
  <div style="background:#fff;border-radius:14px;padding:16px 20px;margin-bottom:16px">
    <h2 style="margin:0 0 10px;font-size:16px">${d.items.length ? 'Para revisar' : 'Todo en orden'}</h2>
    ${
      d.items.length
        ? d.items
            .map(
              (i) =>
                `<div style="border-left:4px solid ${color[i.severity]};padding:4px 0 4px 12px;margin-bottom:10px"><p style="margin:0;font-weight:700">${esc(i.title)}</p><p style="margin:2px 0 0;color:#52525b;font-size:14px">${esc(i.action)}</p><p style="margin:2px 0 0;color:#a1a1aa;font-size:12px">${SOURCE[i.source]}</p></div>`,
            )
            .join('')
        : '<p style="margin:0;color:#52525b;font-size:14px">Tus agentes no ven nada fuera de lo normal esta semana.</p>'
    }
  </div>
  ${d.reportHeadline ? `<div style="background:#fff;border-radius:14px;padding:16px 20px;margin-bottom:16px"><p style="margin:0 0 4px;font-size:12px;color:#d97706;font-weight:700">ANALISTA</p><p style="margin:0;font-size:15px">${esc(d.reportHeadline)}</p></div>` : ''}
  ${
    d.purchase && d.purchase.lines > 0
      ? `<div style="background:#fff;border-radius:14px;padding:16px 20px;margin-bottom:16px"><p style="margin:0 0 4px;font-size:12px;color:#059669;font-weight:700">COMPRADOR</p><p style="margin:0;font-size:15px">Pedido listo: ${d.purchase.lines} insumo(s)${d.purchase.urgent ? `, <b style="color:#dc2626">${d.purchase.urgent} urgente(s)</b>` : ''} por ${esc(d.money(d.purchase.total))}.</p></div>`
      : ''
  }
  ${d.detected && d.detected.total > 0 ? `<p style="margin:0 0 16px;font-size:14px;color:#52525b">Plata detectada ${esc(d.detected.label)}: <b style="color:#d97706">${esc(d.money(d.detected.total))}</b></p>` : ''}
  ${d.appUrl ? `<p style="margin:0 0 24px"><a href="${esc(d.appUrl)}/admin/ai" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;font-size:14px">Abrir mi Equipo IA</a></p>` : ''}
  <p style="margin:0;color:#a1a1aa;font-size:12px">Te escribe el Mensajero de tu Equipo IA. Cambia a quién y cuándo se envía en Equipo IA → Mensajero.</p>
</div></body></html>`;

  return { subject, text, html };
}
