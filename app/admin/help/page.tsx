import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Checklist, type ChecklistGroup } from '@/components/admin/help/Checklist';
import { Badge, Card } from '@/components/ui/primitives';
import { getSetupStatus, type SetupStepId } from '@/lib/services/setup';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Ayuda' };

function Table({ head, rows, numeric = [] }: { head: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-semibold ${numeric.includes(i) ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={`px-3 py-2 align-top ${numeric.includes(i) ? 'whitespace-nowrap text-right' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">{children}</code>;
}

function Step({
  n,
  title,
  href,
  cta,
  done,
  optional,
  children,
}: {
  n: number;
  title: string;
  href: string;
  cta: string;
  done?: boolean;
  optional?: string;
  children: ReactNode;
}) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {optional ? (
          <Circle className="size-6 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden />
        ) : done ? (
          <CheckCircle2 className="size-6 shrink-0 text-emerald-600" aria-label="Hecho" />
        ) : (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-600 dark:bg-brand-500/20">
            {n}
          </span>
        )}
        <h3 className="mr-auto text-lg font-semibold">{title}</h3>
        {optional ? (
          <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{optional}</Badge>
        ) : done ? (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">Hecho</Badge>
        ) : (
          <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Pendiente</Badge>
        )}
      </div>
      <div className="space-y-3 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">{children}</div>
      <Link
        href={href}
        className="inline-flex h-10 items-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {cta} →
      </Link>
    </Card>
  );
}

function Example({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/40">
      <summary className="cursor-pointer text-sm font-semibold text-brand-600">{summary}</summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

export default async function HelpPage() {
  const ctx = await requirePageRole(['admin']);
  const { tenant } = ctx;
  const setup = await getSetupStatus(ctx);
  const s = (id: SetupStepId) => setup.steps[id];
  const menuPath = `/m/${tenant.slug}`;

  const testGroups: ChecklistGroup[] = [
    {
      title: 'Abrir el turno',
      items: [{ id: 'cash-open', label: <>En <b>Caja</b>, abre con una base de efectivo (ej. $200.000).</> }],
    },
    {
      title: 'Tomar el pedido',
      items: [
        { id: 'order-table', label: <>En el <b>Comandero</b> toca una mesa e indica cuántas personas son.</> },
        { id: 'order-items', label: <>Agrega una bebida y un plato, con algún modificador (ej. "Sin hielo", "Queso extra"). Envía la ronda.</> },
        { id: 'order-busy', label: <>La mesa cambia a <b>ocupada</b>.</> },
      ],
    },
    {
      title: 'Preparar',
      items: [
        { id: 'kds-split', label: <>En <b>KDS Barra</b> aparece solo la bebida y en <b>KDS Cocina</b> solo el plato, con sus modificadores.</> },
        { id: 'kds-bump', label: <>Toca <b>Iniciar</b> en cada comanda y luego márcala como lista.</> },
        {
          id: 'kds-sla',
          label: (
            <>
              Deja una comanda esperando: se pone <b className="text-amber-600">amarilla</b> a los {tenant.kds_warning_minutes} min y{' '}
              <b className="text-red-600">roja</b> a los {tenant.kds_late_minutes} min.
            </>
          ),
        },
      ],
    },
    {
      title: 'Servir y pedir otra ronda',
      items: [
        { id: 'serve', label: <>En el comandero aparece el aviso de ítems listos: toca <b>Entregar</b>.</> },
        { id: 'round2', label: <>Agrega una segunda ronda (ej. 2 cervezas). Llega solo a barra.</> },
      ],
    },
    {
      title: 'La cuenta',
      items: [
        { id: 'prebill', label: <>Abre la cuenta de la mesa e imprime la <b>precuenta</b>.</> },
        { id: 'comp', label: <>Marca un ítem como <b>cortesía</b> (ícono de regalo): deja de cobrarse pero sí descuenta inventario.</> },
        { id: 'discount', label: <>Aplica un <b>descuento</b> del 10 % a la cuenta.</> },
      ],
    },
    {
      title: 'Cobrar dividiendo',
      items: [
        { id: 'split', label: <>Toca cobrar y elige <b>Iguales</b> entre 2: una parte con tarjeta y otra en efectivo con propina.</> },
        { id: 'paid', label: <>La orden queda <b>pagada</b>, la mesa se libera y puedes imprimir el <b>recibo</b>.</> },
        { id: 'modes', label: <>En otra mesa prueba <b>Completa</b>, <b>Por ítem</b> y <b>Montos</b>.</> },
        { id: 'void', label: <>Anula un pago (en <b>Caja</b> o en la cuenta) con un motivo: la orden se reabre con saldo pendiente. Cóbrala de nuevo.</> },
      ],
    },
    {
      title: 'Cerrar el turno',
      items: [
        { id: 'withdraw', label: <>En <b>Caja</b> registra un retiro de efectivo (ej. "compra de hielo").</> },
        { id: 'x', label: <>Imprime el <b>corte X</b> (parcial, no cierra la caja).</> },
        { id: 'z', label: <>Cierra la caja con el <b>efectivo contado</b>. El <b>corte Z</b> muestra lo esperado, lo contado y la diferencia.</> },
      ],
    },
    {
      title: 'Qué revisar después',
      items: [
        { id: 'inv', label: <><b>Inventario:</b> cada insumo bajó según la receta (2 mojitos × 60 ml = 120 ml de ron), incluidas las cortesías.</> },
        { id: 'metrics', label: <><b>Métricas:</b> ventas, ticket promedio, food cost, impuestos, descuentos y cortesías coinciden.</> },
        { id: 'soldout', label: <><b>Agotados:</b> registra una merma que deje un insumo en 0; el producto se marca agotado en el comandero y en el menú QR.</> },
        { id: 'qr', label: <><b>Menú QR:</b> abre <Code>{menuPath}</Code> en un celular sin iniciar sesión.</> },
        { id: 'roles', label: <><b>Permisos:</b> con el usuario de cocina intenta abrir el panel de administración; te devuelve a su pantalla.</> },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-10 pb-10">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">Guía de inicio</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Sigue los pasos en orden: cada uno usa datos del anterior. Se marcan como hechos solos a medida que configuras tu
          gastrobar. Los valores de ejemplo arman un menú mínimo (mojito, hamburguesa y cerveza) para probar un servicio completo.
        </p>
        <div className="flex items-center gap-3 text-sm font-medium">
          <div className="h-2.5 w-56 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-emerald-600" style={{ width: `${(setup.done / setup.total) * 100}%` }} />
          </div>
          <span className="tabular-nums text-zinc-500">
            {setup.done} de {setup.total} pasos
          </span>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">1 · Configura tu gastrobar</h2>

        <Step n={1} title="Datos del negocio e impuestos" href="/admin/settings" cta="Ir a Ajustes" done={s('settings')}>
          <p>Estos datos salen en los recibos y definen cómo se calculan impuestos y tiempos de cocina.</p>
          <Table
            head={['Campo', 'Ejemplo', 'Para qué sirve']}
            rows={[
              ['Moneda / formato', 'COP · es-CO', 'Cómo se muestran los precios'],
              ['Zona horaria', 'America/Bogota', 'Horas de tickets, cortes y métricas'],
              ['NIT, teléfono, dirección', 'Los de tu negocio', 'Encabezado del recibo'],
              ['Impuesto', 'INC · 8 %', <>Tarifa por defecto. Los precios del menú ya lo <b>incluyen</b></>],
              ['Semáforo KDS', 'Amarillo 10 · Rojo 20 min', 'Cuándo una comanda se ve demorada'],
              ['Menú público', 'Activado', <>Habilita <Code>{menuPath}</Code> para tus clientes</>],
            ]}
          />
        </Step>

        <Step n={2} title="Salón y mesas" href="/admin/floor" cta="Ir a Salón y mesas" done={s('floor')}>
          <p>
            Crea primero las zonas y luego las mesas en lote con <b>Prefijo + Desde + Cantidad</b>: prefijo <Code>T</Code>, desde{' '}
            <Code>1</Code>, cantidad <Code>6</Code> crea T1 a T6. Después, en <b>Menú QR</b> tienes un código por mesa para imprimir.
          </p>
          <Example summary="Ver zonas de ejemplo">
            <Table
              head={['Zona', 'Prefijo', 'Desde', 'Cantidad', 'Puestos']}
              numeric={[2, 3, 4]}
              rows={[
                ['Salón', 'S', 1, 8, 4],
                ['Terraza', 'T', 1, 6, 4],
                ['Barra', 'B', 1, 5, 1],
              ]}
            />
          </Example>
        </Step>

        <Step n={3} title="Insumos" href="/admin/inventory" cta="Ir a Inventario" done={s('ingredients')}>
          <p>
            Todo se descuenta por receta, así que cada insumo necesita su <b>unidad de receta</b> (g, ml o unidades). El costo se
            escribe como lo compras, por <b>kg, litro o unidad</b>, y el sistema lo convierte. Cuando llegue mercancía, usa{' '}
            <b>Registrar movimiento → Compra</b> para sumar stock y actualizar el costo.
          </p>
          <Example summary="Ver insumos de ejemplo">
            <Table
              head={['Insumo', 'Unidad', 'Stock inicial', 'Mínimo', 'Costo']}
              numeric={[2, 3, 4]}
              rows={[
                ['Ron blanco', 'ml', '3.000', '750', '$60.000 / L'],
                ['Soda', 'ml', '6.000', '1.000', '$4.000 / L'],
                ['Hierbabuena', 'g', '500', '100', '$20.000 / kg'],
                ['Azúcar', 'g', '5.000', '1.000', '$4.500 / kg'],
                ['Limón', 'Unidades', '60', '15', '$500 / u'],
                ['Carne de res', 'g', '4.000', '1.000', '$32.000 / kg'],
                ['Pan brioche', 'Unidades', '30', '10', '$1.800 / u'],
                ['Papa', 'g', '8.000', '2.000', '$3.500 / kg'],
                ['Cerveza lata', 'Unidades', '48', '12', '$3.200 / u'],
              ]}
            />
          </Example>
        </Step>

        <Step n={4} title="Menú y recetas" href="/admin/menu" cta="Ir a Menú" done={s('menu')}>
          <p>El orden importa:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <b>Categorías:</b> cada una define a qué pantalla va el pedido, <b>Cocina</b> o <b>Barra</b>.
            </li>
            <li>
              <b>Sub-recetas</b> (opcional): preparaciones por lotes que usan varios productos, como un almíbar.
            </li>
            <li>
              <b>Productos</b> con precio, impuesto, foto y su <b>ficha técnica</b> (receta). La receta descuenta inventario y
              calcula el food cost sobre el precio sin impuesto.
            </li>
            <li>
              <b>Modificadores:</b> cambian el precio y llegan escritos a cocina o barra, pero no descuentan insumos. Si un extra
              consume inventario, créalo como producto aparte.
            </li>
          </ol>
          <Example summary="Ver menú de ejemplo">
            <p className="text-sm">
              Categorías: <b>Cócteles</b> y <b>Cervezas</b> → Barra; <b>Platos fuertes</b> y <b>Entradas</b> → Cocina. Sub-receta{' '}
              <b>Almíbar simple</b>: rinde 1.000 ml con 500 g de azúcar.
            </p>
            <Table
              head={['Producto', 'Categoría', 'Precio', 'Receta']}
              numeric={[2]}
              rows={[
                ['Mojito', 'Cócteles', '$22.000', 'Ron 60 ml · Almíbar 20 ml · Limón 0,5 u · Hierbabuena 6 g · Soda 90 ml'],
                ['Hamburguesa de la casa', 'Platos fuertes', '$34.000', 'Carne 150 g · Pan 1 u · Papa 200 g'],
                ['Cerveza nacional', 'Cervezas', '$9.000', 'Cerveza lata 1 u'],
              ]}
            />
            <p className="text-sm">
              Modificadores: <b>Queso extra</b> (+$4.000), <b>Término medio</b> y <b>Bien asado</b> ($0) para la hamburguesa;{' '}
              <b>Sin hielo</b> ($0) para el mojito.
            </p>
          </Example>
        </Step>

        <Step n={5} title="Personal" href="/admin/staff" cta="Ir a Personal" done={s('staff')}>
          <p>
            Cada persona entra con su correo y ve solo su pantalla. Las cuentas que creas aquí quedan activas de inmediato con la
            contraseña que les asignes; si la olvidan, usan <b>¿Olvidaste tu contraseña?</b> en el ingreso.
          </p>
          <Table
            head={['Rol', 'Entra a', 'Puede']}
            rows={[
              [<b key="a">Administrador</b>, 'Métricas', 'Todo: configuración, reportes, caja y anulaciones'],
              [<b key="c">Caja</b>, 'Comandero', 'Tomar pedidos, cobrar, abrir y cerrar caja, anular pagos'],
              [<b key="w">Mesero</b>, 'Comandero', 'Tomar pedidos, cortesías, descuentos y cobrar'],
              [<b key="k">Cocina</b>, 'KDS Cocina', 'Ver y avanzar solo lo de cocina'],
              [<b key="b">Barra</b>, 'KDS Barra', 'Ver y avanzar solo lo de barra'],
            ]}
          />
        </Step>

        <Step
          n={6}
          title="Facturación electrónica"
          href="/admin/einvoicing"
          cta="Ir a Facturación"
          optional={tenant.einvoice_enabled ? 'Activa' : 'Opcional · apagada'}
        >
          <p>
            El POS funciona completo sin ella. Para ver el flujo sin un proveedor real, actívala con el <b>Simulador</b> en entorno
            de <b>pruebas</b>: cada venta pagada genera un documento con número, CUDE y QR marcado como sin validez fiscal. La
            facturación nunca bloquea el cobro: si el proveedor falla, el pago queda registrado y el documento se reintenta solo.
          </p>
        </Step>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-xl font-bold">2 · Prueba un servicio completo</h2>
          {s('first_sale') ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">Primera venta registrada</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Sin ventas aún</Badge>
          )}
        </div>
        <p className="text-zinc-600 dark:text-zinc-400">
          Abre en otras ventanas (o en otros dispositivos) el <Link href="/waiter" className="font-semibold text-brand-600 hover:underline">Comandero</Link>,{' '}
          <Link href="/kds/kitchen" className="font-semibold text-brand-600 hover:underline">KDS Cocina</Link> y{' '}
          <Link href="/kds/bar" className="font-semibold text-brand-600 hover:underline">KDS Barra</Link>. Los cambios aparecen en vivo
          sin recargar. Para probar con varios usuarios a la vez, usa una ventana de incógnito por persona.
        </p>
        <Card>
          <Checklist storageKey={`gastrobar-help-${tenant.id}`} groups={testGroups} />
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">3 · Si algo falla</h2>
        <Table
          head={['Síntoma', 'Qué hacer']}
          rows={[
            ['El pedido no aparece en cocina o barra', 'Revisa la estación de la categoría del producto en Menú.'],
            ['No se descuenta inventario', 'Completa la ficha técnica (receta) del producto.'],
            ['Un producto sale agotado', 'Algún insumo de su receta está en 0: registra una compra en Inventario.'],
            ['El menú QR dice que no existe', 'Activa el menú público en Ajustes.'],
            ['Un empleado no puede entrar', 'Revisa que esté activo en Personal; si olvidó la contraseña, que use "¿Olvidaste tu contraseña?".'],
            ['El recibo no trae número de factura', 'La facturación está apagada o el documento sigue en proceso; revisa Facturación.'],
          ]}
        />
      </section>
    </div>
  );
}
