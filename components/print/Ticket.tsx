import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Tenant } from '@/types/domain';
import { PrintToolbar } from './PrintToolbar';

/** Contenedor de ticket de 72 mm de ancho útil con cabecera del negocio. */
export function Ticket({
  tenant,
  title,
  subtitle,
  children,
  footer,
  autoPrint,
  large = false,
}: {
  tenant: Pick<Tenant, 'name' | 'tax_id' | 'address' | 'phone'>;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  autoPrint: boolean;
  large?: boolean;
}) {
  return (
    <>
      <PrintToolbar autoPrint={autoPrint} />
      <article
        className={cn(
          'mx-auto w-[72mm] bg-white p-3 font-mono leading-snug text-black shadow print:w-full print:p-0 print:shadow-none',
          large ? 'text-[14px]' : 'text-[12px]',
        )}
      >
        <header className="text-center">
          <p className="text-[15px] font-bold uppercase">{tenant.name}</p>
          {tenant.tax_id && <p>NIT {tenant.tax_id}</p>}
          {tenant.address && <p>{tenant.address}</p>}
          {tenant.phone && <p>Tel. {tenant.phone}</p>}
          <Rule />
          <p className="text-[15px] font-bold uppercase">{title}</p>
          {subtitle && <div>{subtitle}</div>}
          <Rule />
        </header>
        {children}
        {footer && (
          <footer className="text-center">
            <Rule />
            {footer}
          </footer>
        )}
      </article>
    </>
  );
}

export function Rule({ double = false }: { double?: boolean }) {
  return <p className="my-1 overflow-hidden whitespace-nowrap">{(double ? '=' : '-').repeat(48)}</p>;
}

/** Fila con etiqueta a la izquierda y valor a la derecha. */
export function Row({ label, value, bold = false }: { label: ReactNode; value: ReactNode; bold?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', bold && 'font-bold')}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 text-right">{value}</span>
    </div>
  );
}
