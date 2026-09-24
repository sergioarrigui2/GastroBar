# GastroBar POS — SaaS multi-tenant

POS para gastrobares: **comandero móvil** para meseros, **KDS en tiempo real** para cocina y barra, **split-bill**, **inventario por receta** (g / ml / unidad) y una **capa de herramientas para agentes de IA** (MCP + Vercel AI SDK + REST).

**Stack:** Next.js 16 (App Router, Server Actions, `proxy.ts`) · Supabase (PostgreSQL, RLS, Realtime, Auth) · Tailwind CSS 4 · Zod 4 · TypeScript estricto · Vercel.

---

## Estructura

```
app/
  actions/              Server Actions (orders, payments, admin, auth)
  admin/                Métricas, menú, inventario, salón, personal y ajustes
  api/v1/ai-tools/      REST: GET catálogo · POST /:tool ejecutar
  api/v1/mcp/           Servidor MCP (Streamable HTTP, stateless)
  cash/                 Caja: apertura, movimientos, arqueo y reporte Z
  kds/[station]/        KDS de cocina (/kds/kitchen) y barra (/kds/bar)
  m/[slug]/             Menú QR público para clientes
  print/                Tickets 80 mm: comanda, precuenta/recibo, reporte X/Z
  waiter/               Comandero móvil
  login/ onboarding/    Auth y alta del gastrobar
components/
  waiter/ComanderoMobile.tsx   Mapa de mesas, menú, comanda, cuenta (una mano)
  waiter/ModifierSheet.tsx     Modal rápido de modificadores y notas
  billing/SplitBillModal.tsx   Completa · partes iguales · por ítem · montos
  kds/KDSDisplay.tsx           Grid adaptativo + SLA por colores + Realtime
  admin/                       Dashboard, inventario, salón, personal, ajustes
  admin/menu/                  Productos + ficha técnica, categorías, modificadores, sub-recetas
  ui/                          Primitivas, Sheet, ThemeToggle, useRealtimeRefresh
lib/
  ai-tools/             Definiciones de herramientas (Zod) + registro + adaptadores
  services/             Lógica de dominio compartida por UI, actions y agentes
  billing/split-bill.ts Motor puro de división (sin pérdidas por redondeo)
  supabase/             Clientes browser / server / token (Bearer) / admin + proxy
  tenant-context.ts     Resolución de tenant y rol (cookies o Bearer)
  validations/          Esquemas Zod
supabase/
  schema.sql            Tablas, enums, RLS, triggers, RPCs, vista, Realtime
  migrations/           Cambios para bases ya creadas (002 catálogo · 003 caja, claves API, QR,
                        imágenes · 004 impuestos, cortesías, descuentos, anulaciones ·
                        005 facturación electrónica · 006 análisis · 007 informes y costos IA ·
                        008 planes de IA)
  seed.sql              Menú, mesas, insumos y recetas demo
tests/                  Motor de split-bill + integración SQL (PGlite)
types/                  Tipos de base de datos y dominio
```

## Puesta en marcha

1. **Supabase:** crea un proyecto y ejecuta `supabase/schema.sql` completo en el SQL Editor.
2. **Variables:** copia `.env.example` a `.env.local` y completa `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (sólo servidor, se usa para dar de alta personal).
3. **Instala y arranca:**
   ```bash
   npm install
   ```
   ```bash
   npm run dev
   ```
4. Abre `/onboarding`, crea tu usuario y tu gastrobar (quedas como `admin`).
5. **Datos demo (opcional):** cambia `v_slug` en `supabase/seed.sql` por tu identificador y ejecútalo en el SQL Editor.
6. Configura tu operación desde el panel admin:
   - **Menú** (`/admin/menu`): categorías con su estación, productos con ficha técnica (costo por porción, food cost, margen y precio sugerido), modificadores y sub-recetas.
   - **Inventario** (`/admin/inventory`): alta y edición de insumos; compras, mermas y ajustes.
   - **Salón y mesas** (`/admin/floor`): zonas y mesas, con creación en lote (T1…T8).
   - **Ajustes** (`/admin/settings`): nombre, moneda, zona horaria, tiempos del KDS y venta sin stock.
   - **Ayuda** (`/admin/help`): guía de inicio que marca sola los pasos configurados (ajustes, salón, insumos, menú, personal) y una lista para probar un servicio completo. Las cuentas nuevas llegan aquí al terminar el registro.
7. En **Admin → Personal** crea meseros, caja, cocina, barra y usuarios `ai_agent`.

**Actualizar una base existente:** ejecuta en orden los archivos de `supabase/migrations/` que aún no hayas aplicado. Para instalaciones nuevas no hace falta: `schema.sql` ya los incluye.

**Deploy en Vercel:** importa el repo y define las mismas tres variables de entorno. No requiere configuración adicional.

## Roles y módulos

| Rol | Entra a | Puede |
|---|---|---|
| `admin` | `/admin` | Todo: catálogo, inventario, personal, métricas, anular órdenes |
| `cashier` | `/waiter`, `/cash` | Comandar, cobrar, anular, abrir/cerrar caja, registrar mermas, ver métricas |
| `waiter` | `/waiter` | Comandar, entregar, cobrar/dividir |
| `kitchen` | `/kds/kitchen` | Avanzar ítems de cocina, registrar mermas |
| `bar` | `/kds/bar` | Avanzar ítems de barra, registrar mermas |
| `ai_agent` | sólo API | Herramientas de IA según su rol |

## Operación diaria

- **Caja (`/cash`)**
  - **Apertura:** con base de efectivo. Solo puede haber una caja abierta por gastrobar.
  - **Durante el turno:** entradas y retiros con motivo, y un **corte parcial (X)**.
  - **Cierre con arqueo:** calcula el efectivo esperado (base + ventas y propinas en efectivo + entradas − retiros) y la diferencia con lo contado. Genera el **reporte Z** y guarda el historial de cierres.
- **Impresión (80 mm)**
  - **Comanda por estación y ronda:** botón 🖨 en cada tarjeta del KDS.
  - **Precuenta:** botón en *Cuenta* del comandero.
  - **Recibo:** desde *Caja → Cuentas pagadas*.
  - **Reportes X/Z.**
  - **Cómo imprime:** usa el diálogo de impresión del navegador, así que funciona con cualquier impresora térmica instalada en el sistema. Para imprimir sin diálogo, en Chrome usa el modo kiosco (`--kiosk-printing`).
- **Menú QR (`/m/<identificador>`)**
  - **Carta pública:** sin sesión, con fotos, precios, extras y agotados. Se regenera cada minuto.
  - **Códigos QR:** en *Admin → Menú QR* hay uno general y uno por mesa, imprimibles.
  - **Configuración:** se activa o desactiva en *Ajustes*. Define `NEXT_PUBLIC_APP_URL` para que los QR apunten a tu dominio.
- **Imágenes de productos**
  - **Subida:** desde el editor de producto. Se redimensionan a WebP en el navegador.
  - **Almacenamiento:** Supabase Storage (bucket `product-images`), en una carpeta por gastrobar; solo el admin del tenant puede escribir en ella.

## Impuestos, descuentos y anulaciones

- **Impuestos**
  - **Por gastrobar:** nombre y tarifa, por defecto **INC 8% incluido en el precio**. Se configuran en *Ajustes*.
  - **Por producto:** tarifa propia (IVA 19%, 5% o exento) desde el editor del menú.
  - **Cálculo:** se hace al comandar y queda guardado en cada ítem.
  - **Recibos:** muestran la base gravable y el impuesto.
  - **Food cost y margen:** se miden sobre el precio **sin** impuesto.
- **Cortesías:** admin o caja marcan un ítem con motivo obligatorio. Vale $0, pero el stock sí se descuenta. No se puede aplicar a un ítem ya pagado.
- **Descuento de cuenta:** porcentaje o monto fijo, con motivo, solo admin o caja. El impuesto se prorratea sobre el total con descuento.
- **Anulación de pagos:** solo el admin, con motivo. La cuenta se reabre con el saldo pendiente y la mesa vuelve a ocupada. Se hace desde *Cuenta* en el comandero o desde *Caja → Cuentas pagadas*. Se bloquea si el pago pertenece a una caja ya cerrada, para no alterar un reporte Z.
- **Reportes:** métricas, cortes X y reportes Z incluyen descuentos, cortesías, impuestos y pagos anulados. Los pagos anulados no cuentan como venta.

## Facturación electrónica

Viene **desactivada**; se activa por gastrobar en *Admin → Facturación*. Apagada, el POS funciona exactamente igual.

- **No bloqueante:** cuando una cuenta queda pagada, un trigger **encola** el documento con un snapshot congelado (ítems, impuestos por tarifa, descuentos y pagos). El envío al proveedor ocurre **después de responder al usuario** (`after()` de Next.js). Si el proveedor o la DIAN fallan, el documento se reintenta con backoff y nunca bloquea el cobro. Además, `/api/cron/einvoice` reprocesa la cola (Vercel Cron, ver `vercel.json`).
- **Tipo de documento:** si al cobrar se capturan los datos del cliente (NIT o cédula, nombre, correo), se emite **factura electrónica**; si no, **documento equivalente POS** (configurable).
- **Anulaciones:** anular un pago de una cuenta ya aceptada genera una **nota crédito**. Si el documento aún no se había enviado, se cancela.
- **Proveedores:**
  - **Simulador:** funcional, solo para pruebas. Genera número, CUDE (SHA-384) y QR marcados como simulados.
  - **Alegra y Siigo:** registrados con sus campos de credenciales, **pendientes de conectar**. Sus documentos quedan en cola con un mensaje explicativo.
- **Credenciales:** se guardan cifradas con AES-256-GCM (`EINVOICE_ENCRYPTION_KEY`), solo las ve el admin y nunca llegan al navegador.
- **Seguimiento:** panel con el estado de cada documento, reintento manual, "Generar faltantes" (para cuentas pagadas antes de activar la facturación) y actualización en tiempo real.

### Conectar un proveedor real

1. Implementar `issue()` y `testConnection()` en `lib/einvoice/providers/<proveedor>.ts`. Opcionalmente, `checkStatus()` si el proveedor responde de forma asíncrona. La entrada es un `EInvoiceRequest`, con el payload ya calculado, y la salida un `EInvoiceResult`.
2. Cambiar `implemented: true`.
3. Probarlo en el entorno de **pruebas / habilitación** del proveedor y luego pasar a producción desde el panel.

Todo lo demás (cola, reintentos, notas crédito, recibos con CUFE/CUDE y QR, panel) ya funciona con cualquier conector.

## Modelo de seguridad multi-tenant

- **RLS en todas las tablas** con `tenant_id = private.current_tenant_id()`, resuelto desde `profiles` para `auth.uid()`.
- **FKs compuestas `(tenant_id, id)`:** una orden no puede apuntar a una mesa, un producto o un modificador de otro tenant, aunque se adivine el UUID.
- **Funciones internas en el esquema `private`** (no expuesto por PostgREST): los triggers `security definer` de stock/totales no son invocables vía RPC.
- **El servidor decide precio, estación y modificadores** en un trigger (`before_order_item_insert`); las columnas monetarias son inmutables desde el cliente.
- **Máquina de estados:** el estado de la orden se deriva de sus ítems y pagos; cocina/barra sólo actualizan ítems **de su estación** (política RLS) y no pueden cancelar.
- **Pagos inmutables:** sin UPDATE/DELETE; se bloquean sobrepagos y sobre-asignación por ítem.
- **Realtime respeta RLS:** cada pantalla sólo recibe eventos de su tenant.

## Stock en tiempo real

- `recipes` asocia cada producto con insumos directos (`ingredients`) o porciones de `sub_recipes` (jarabe, sour mix…), que se expanden proporcionalmente a su rendimiento.
- **Al crear un ítem** se descuenta el stock; **al cancelarlo** (o anular la orden) se devuelve. Cada movimiento queda en `inventory_movements` con su costo unitario.
- Si un insumo quedaría negativo, la venta falla con `insufficient_stock` (configurable con `tenants.allow_negative_stock`).
- La vista `product_availability` calcula las porciones posibles de cada producto; el comandero marca "Agotado" / "Quedan N".
- Las mermas, compras (con costo promedio ponderado) y ajustes se registran con `record_inventory_movement`.

## Análisis del negocio y Agente Analista

**Admin → Análisis** (`/admin/analytics`) compara el periodo elegido (7, 30 o 90 días) con el anterior de igual duración.

- **Cálculo exacto, sin IA** (`get_business_snapshot`, migración 006): KPIs, ventas por día, día de la semana y hora, rentabilidad por producto con el costo real de los movimientos de inventario, desempeño por mesero, tiempos de cocina y barra, cierres de caja y consumo de insumos por causa (ventas, mermas, faltantes).
- **Interpretación determinista** (`lib/analytics/analyze.ts`, probada en `tests/analytics.test.ts`): ingeniería de menú (estrella, caballo de batalla, enigma, perro) y alertas por reglas con umbrales ajustables (`THRESHOLDS`): caída de ventas, food cost, faltantes de inventario, mermas, diferencias de caja, descuentos o anulaciones fuera de lo normal por persona, demoras y días atípicos.
- **Informe del Analista IA** (`lib/analyst`): el resumen se convierte en una lista de hechos con id citable. Una sola llamada al modelo (por defecto `claude-sonnet-5`) devuelve un informe con esquema Zod: titular, estado, resumen, lo que va bien, hallazgos con evidencia, impacto y acción, decisiones de menú y preguntas.
  - **Verificación:** cada cifra de la evidencia debe aparecer en los hechos y cada id citado debe existir. Si no, se pide una corrección (una vez); lo que siga sin verificar se marca en pantalla.
  - **Costo controlado:** si los hechos no cambiaron, se reutiliza el informe guardado (`facts_hash`); máximo 10 informes por gastrobar cada 24 horas. Esfuerzo de razonamiento `medium` por defecto (`ANALYST_EFFORT`): medido con datos reales, ~33 s y ~USD 0,036 por informe, frente a ~72 s y ~USD 0,085 con el valor por defecto del modelo.
  - **Registro de costos** (**Admin → Consumo IA**, tabla `ai_usage`, migración 007): una fila por cada llamada al modelo, incluidas las fallidas, con tokens de entrada, salida, razonamiento y caché, duración y costo en USD calculado con los precios oficiales (`lib/ai/pricing.ts`). El costo queda congelado en la fila; el registro no se puede editar ni borrar.
  - **Privacidad:** al modelo sólo le llegan cifras agregadas y nombres de productos y personal; nunca datos de clientes.
  - Requiere `ANTHROPIC_API_KEY` en el servidor; sin ella el tablero funciona y el informe queda desactivado.

## Equipo IA, planes y control de costos

**Admin → Equipo IA** (`/admin/ai`) presenta los agentes como parte del equipo, cada uno con su estado y su costo:

| Agente | Qué hace | Usa IA |
|---|---|---|
| Analista | Informe con hallazgos y acciones | Sí, cuenta del cupo |
| Vigía | Alertas de caja, inventario, descuentos, anulaciones y demoras | No (reglas) |
| Ingeniero de menú | Estrella, caballo de batalla, enigma, perro | No (cálculo) |
| Comprador, Mensajero | Próximamente | — |

- **Plata detectada** (`lib/analytics/value.ts`): faltantes de caja, faltantes de inventario, mermas, sobrecosto de productos con food cost alto (vs. objetivo 35 %) y descuentos por encima del promedio del equipo. Sólo cifras exactas, nunca estimaciones del modelo. Se muestra junto al gasto de IA del mes.
- **Resumen del día** en la portada del admin (`lib/analytics/briefing.ts`): hasta 3 puntos del último informe (si tiene 8 días o menos) completados con alertas del Vigía. **No llama al modelo.**

### Cuándo se llama al modelo
Sólo al pedir un informe, y sólo si: hay al menos 15 cuentas cerradas en el periodo, los datos cambiaron desde el último informe (si no, se reutiliza sin costo), queda cupo en el plan y no se superó el tope de gasto del mes.

### Enrutamiento de modelos (`lib/ai/plans.ts`)
Medido con datos reales: Haiku 4.5 ≈ USD 0,018 y Sonnet 5 (esfuerzo medio) ≈ USD 0,036 por informe.
- `economy`: siempre Haiku. `premium`: siempre Sonnet.
- `balanced`: Haiku para periodos simples; Sonnet si hay alertas críticas, 3 o más alertas, más de 31 días o muchos datos.
- La corrección de cifras (segundo intento) siempre usa Haiku.

### Planes vendibles
| Plan | Informes/mes | Tope USD/mes | Modelos |
|---|---|---|---|
| Sin IA | 0 | 0 | — |
| Prueba (por defecto) | 3 | 0,50 | economy |
| Básico | 4 | 1 | economy |
| Pro | 10 | 3 | balanced |
| Premium | 30 | 10 | premium |

El plan de cada gastrobar está en `tenant_ai_plans` (migración 008). Sólo el dueño de la plataforma lo cambia desde el SQL Editor; el administrador del gastrobar lo ve pero no puede modificarlo:

```sql
insert into public.tenant_ai_plans (tenant_id, plan, reports_per_month, monthly_budget_usd)
values ((select id from public.tenants where slug = 'mi-gastrobar'), 'pro', null, null)
on conflict (tenant_id) do update set plan = excluded.plan, reports_per_month = excluded.reports_per_month,
  monthly_budget_usd = excluded.monthly_budget_usd, updated_at = now();
```
`reports_per_month`, `monthly_budget_usd` y `model_tier` son opcionales para armar paquetes a la medida.

## Capa de herramientas para agentes de IA

| Herramienta | Qué hace |
|---|---|
| `get_table_status` | Mapa de mesas, ocupación y orden activa con saldo e ítems por estado |
| `get_menu_availability` | Menú en vivo con porciones disponibles y modificadores |
| `create_order_tool` | Crea la comanda o agrega una ronda; dispara Realtime a cocina/barra |
| `process_split_payment_tool` | Calcula (`calculate`) o registra (`register`) la división |
| `get_bar_metrics_tool` | Ventas, ticket promedio, costo de insumos, mermas, márgenes, top productos |
| `get_business_analysis_tool` | Análisis de un periodo vs. el anterior: ingeniería de menú, equipo, horarios, inventario y alertas |

Cada herramienta tiene esquema Zod, lista de roles permitidos y se ejecuta con el cliente de Supabase **del usuario agente**, así que RLS la limita a su tenant.

### Autenticación del agente

**Recomendado: clave API de larga duración.**

1. Crea un usuario con rol **Agente IA** en *Admin → Personal*.
2. En la misma pantalla, sección **Claves API**, genera una clave `gbk_…`. Se muestra una sola vez; en la base sólo queda su hash SHA-256.
3. Envía `Authorization: Bearer gbk_…` en cada llamada. La clave no caduca y se puede **revocar** en cualquier momento; la revocación se aplica en la siguiente petición.

Internamente, el servidor valida la clave y abre una sesión de Supabase del usuario agente. Así, RLS sigue aplicando con su identidad y su rol. Esto requiere `SUPABASE_SERVICE_ROLE_KEY`.

**Alternativa:** el access token de Supabase del usuario agente, obtenido con `signInWithPassword`. Expira en 1 h.

### MCP

Endpoint: `POST https://<tu-app>/api/v1/mcp` (Streamable HTTP en modo stateless). Configuración típica de un cliente MCP:

```json
{
  "mcpServers": {
    "gastrobar": {
      "type": "http",
      "url": "https://<tu-app>/api/v1/mcp",
      "headers": { "Authorization": "Bearer <access_token>" }
    }
  }
}
```

### REST

```bash
curl -X POST https://<tu-app>/api/v1/ai-tools/create_order_tool -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"table_id":"<uuid>","items":[{"product_id":"<uuid>","quantity":2,"modifier_ids":[],"notes":"poco hielo"}]}'
```

`GET /api/v1/ai-tools` devuelve el catálogo (JSON Schema) disponible para el rol del token.

### Vercel AI SDK (dentro de la app)

```ts
import { streamText } from 'ai';
import { createVercelAiTools } from '@/lib/ai-tools';
import { getTenantContext } from '@/lib/tenant-context';

const ctx = await getTenantContext();
const result = streamText({ model, tools: createVercelAiTools(ctx), prompt });
```

## Pruebas

```bash
npm test
```

Incluye pruebas del motor de división y **pruebas de integración del esquema SQL** sobre PostgreSQL embebido (PGlite): aislamiento entre tenants, precios del servidor, descuento y devolución de stock (con sub-recetas), permisos por estación, pagos divididos, liberación de mesas, mermas y métricas.

```bash
npm run typecheck
```

## Pendiente / siguientes pasos

- **Conectores de Alegra y Siigo:** la base de facturación electrónica está completa; falta implementar el envío de cada proveedor con sus credenciales de sandbox.
- **Pedidos del cliente desde el QR:** el menú público es de solo lectura. Aceptar pedidos anónimos exige un token por mesa y la confirmación del mesero.
