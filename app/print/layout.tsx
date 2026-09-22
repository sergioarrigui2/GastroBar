import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/**
 * Tickets para impresoras térmicas de 80 mm (también se ven bien en PDF / A4).
 * Siempre en claro, sin el chrome de la app.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <div className="print-root min-h-dvh bg-zinc-200 py-6 text-black print:bg-white print:py-0">
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        @media print {
          html, body { background: #fff !important; color: #000 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
      {children}
    </div>
  );
}
