/**
 * El equipo de agentes, contado por ellos mismos. Es la fuente única de nombres,
 * presentación, valor para el negocio, costo y dónde aparece cada uno: la usan
 * Equipo IA, las páginas de cada agente y las insignias en los módulos.
 */
export type AgentId = 'analista' | 'vigia' | 'ingeniero' | 'comprador' | 'mensajero';

export type AgentProfile = {
  id: AgentId;
  name: string;
  /** Una línea: qué es. */
  tagline: string;
  /** Presentación en primera persona. */
  intro: string;
  does: string[];
  how: string[];
  value: string[];
  cost: { usesAi: 'no' | 'optional' | 'yes'; label: string; detail: string };
  where: Array<{ label: string; href: string }>;
  /** Clases de color del agente (fondo suave + texto). */
  tone: string;
};

export const AGENTS: Record<AgentId, AgentProfile> = {
  vigia: {
    id: 'vigia',
    name: 'Vigía',
    tagline: 'Cuida la plata que se escapa sin que nadie lo note.',
    intro:
      'Soy el Vigía. No duermo: reviso cada cierre de caja, cada conteo de inventario, cada descuento y cada comanda. Cuando algo se sale de lo normal, te aviso antes de que se vuelva costumbre.',
    does: [
      'Detecto faltantes en los cierres de caja y quién cerró.',
      'Encuentro insumos que desaparecen sin venta ni merma registrada (el ron que no cuadra).',
      'Señalo a quien da más descuentos, cortesías o anula más pagos que el resto del equipo.',
      'Aviso cuando la cocina o la barra se demoran más de lo que definiste.',
      'Te alerto de mermas altas, food cost que sube, caídas de ventas y días atípicos.',
    ],
    how: [
      'Comparo cada persona, insumo y día contra el comportamiento normal de tu propio negocio.',
      'Uso reglas estadísticas con umbrales claros, no adivino: cada alerta trae la cifra que la respalda.',
      'Una alerta no acusa a nadie: te dice dónde mirar.',
    ],
    value: [
      'Tapar fugas pequeñas que al mes suman millones.',
      'Un equipo que sabe que los números se revisan cuida más la caja y el inventario.',
      'Menos tiempo revisando reportes: te llego con lo importante.',
    ],
    cost: { usesAi: 'no', label: 'Incluido', detail: 'Trabajo todo el día, sin límite de uso.' },
    where: [
      { label: 'Resumen del día', href: '/admin' },
      { label: 'Alertas en Análisis', href: '/admin/analytics' },
      { label: 'Caja', href: '/cash' },
      { label: 'Inventario', href: '/admin/inventory' },
      { label: 'Personal', href: '/admin/staff' },
    ],
    tone: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  ingeniero: {
    id: 'ingeniero',
    name: 'Ingeniero de menú',
    tagline: 'Te dice qué productos te hacen ganar y cuáles te hacen perder.',
    intro:
      'Soy el Ingeniero de menú. Miro cada plato y cada cóctel con dos preguntas: ¿se vende? y ¿deja plata? Con eso te digo qué destacar, qué ajustar y qué sacar de la carta.',
    does: [
      'Clasifico cada producto: ⭐ Estrella, 🐴 Caballo de batalla, ❓ Enigma o 🐕 Perro.',
      'Calculo el food cost real de cada producto con sus recetas y el costo de cada insumo.',
      'Mido el margen que deja cada unidad y cuánto pesa en tus ventas.',
      'Te muestro los productos que no se vendieron en el periodo.',
    ],
    how: [
      'Uso la ingeniería de menú clásica (Kasavana y Smith): popularidad frente a margen por unidad.',
      'El costo sale de lo que realmente descontó el inventario al vender, no de una estimación.',
    ],
    value: [
      'Subir el margen sin subir las ventas: cambiar un precio o una porción rinde más que vender más.',
      'Una carta más corta y rentable, con menos inventario inmovilizado.',
      'Saber qué recomendar en la mesa.',
    ],
    cost: { usesAi: 'no', label: 'Incluido', detail: 'Reviso tu carta todos los días, sin límite de uso.' },
    where: [
      { label: 'Menú (insignia en cada producto)', href: '/admin/menu' },
      { label: 'Ingeniería de menú en Análisis', href: '/admin/analytics' },
    ],
    tone: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
  analista: {
    id: 'analista',
    name: 'Analista',
    tagline: 'Lee todos tus números y te dice qué hacer esta semana.',
    intro:
      'Soy el Analista. Tomo las cifras exactas de tu negocio —ventas, menú, equipo, caja e inventario— y te las explico como lo haría un consultor: qué va bien, qué preocupa y qué hacer, en orden de importancia.',
    does: [
      'Escribo un informe con titular, resumen, lo que va bien, hallazgos con su evidencia e impacto, y acciones concretas.',
      'Te propongo decisiones de menú y te hago preguntas cuando los datos no alcanzan a explicar algo.',
      'Guardo cada informe para que puedas releerlo o imprimirlo.',
    ],
    how: [
      'El sistema calcula las cifras; yo sólo las interpreto. Cada cifra que cito se verifica contra tus datos.',
      'Uso el nivel de análisis que cada periodo necesita: más profundo cuando hay más señales.',
      'Si tus datos no cambiaron, te muestro el informe guardado sin gastar cupo.',
    ],
    value: [
      'Criterio de consultor sin pagar un consultor.',
      'Decisiones con evidencia, no por intuición.',
      'Un análisis cuando lo necesites, sin esperar al contador de fin de mes.',
    ],
    cost: {
      usesAi: 'yes',
      label: 'Incluido en tu plan',
      detail: 'Tu plan incluye un número de informes al mes. Si tus datos no cambiaron, repetir un informe no gasta cupo.',
    },
    where: [
      { label: 'Informe en Análisis', href: '/admin/analytics' },
      { label: 'Historial de informes', href: '/admin/analytics/reports' },
      { label: 'Resumen del día', href: '/admin' },
    ],
    tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  comprador: {
    id: 'comprador',
    name: 'Comprador',
    tagline: 'Arma tu pedido de compras para que no te falte ni te sobre.',
    intro:
      'Soy el Comprador. Sé cuánto se gasta de cada insumo cada día de la semana, cuándo viene un puente y cuánto tarda cada proveedor. Con eso te dejo listo el pedido, en botellas y cajas completas, para enviarlo por WhatsApp.',
    does: [
      'Pronostico el consumo de cada insumo por día de la semana, con festivos y puentes de Colombia.',
      'Calculo cuánto pedir para cubrir la entrega del proveedor y los días que elijas, con reserva de seguridad.',
      'Agrupo el pedido por proveedor y escribo el mensaje de WhatsApp.',
      'Marco lo urgente: lo que se agota antes de que llegue el pedido.',
      'Registro la recepción en el inventario con un toque.',
    ],
    how: [
      'Uso el consumo real que descontaron tus recetas en las últimas 8 semanas.',
      'Trabajo solo a la hora que programes (diario, semanal, quincenal o mensual).',
      'Si quieres, pido a la IA una segunda mirada del pedido; nunca cambia las cantidades sola.',
    ],
    value: [
      'Menos agotados en la noche fuerte y menos plata quieta en la bodega.',
      'El pedido que tomaba una hora, listo en segundos.',
      'Comprar con datos, no a ojo.',
    ],
    cost: { usesAi: 'optional', label: 'Incluido', detail: 'Calculo tus pedidos sin límite; la revisión con IA también está incluida.' },
    where: [
      { label: 'Comprador', href: '/admin/purchasing' },
      { label: 'Inventario', href: '/admin/inventory' },
      { label: 'Resumen del día', href: '/admin' },
    ],
    tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  mensajero: {
    id: 'mensajero',
    name: 'Mensajero',
    tagline: 'Te lleva el resumen de tu negocio a tu correo y a tu WhatsApp.',
    intro:
      'Soy el Mensajero. No tienes que entrar a la app para saber cómo va tu negocio: yo te lo llevo. Junto lo más importante de la semana —ventas, alertas, hallazgos del Analista y el pedido del Comprador— y te lo envío a la hora que me digas.',
    does: [
      'Envío un resumen claro por correo a las personas que elijas (tú, tu socio, tu administrador).',
      'Te dejo el mismo resumen listo para mandarlo por WhatsApp con un toque.',
      'Trabajo solo a la hora que programes.',
    ],
    how: [
      'Armo el mensaje con lo que tus otros agentes ya encontraron: no vuelvo a gastar IA.',
      'Guardo un registro de cada envío.',
    ],
    value: [
      'Estar al tanto sin abrir la app, desde donde estés.',
      'Tus socios reciben la misma información, a tiempo.',
      'Un resumen que se puede reenviar tal cual.',
    ],
    cost: { usesAi: 'no', label: 'Incluido', detail: 'Envío tus resúmenes sin costo adicional.' },
    where: [{ label: 'Configurar el Mensajero', href: '/admin/ai/mensajero' }],
    tone: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
};

export const AGENT_ORDER: AgentId[] = ['vigia', 'ingeniero', 'analista', 'comprador', 'mensajero'];

export function isAgentId(v: string): v is AgentId {
  return v in AGENTS;
}
