'use client';

import { AlertTriangle, CheckCircle2, FileText, PlugZap, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  enqueueMissingEInvoicesAction,
  processEInvoiceQueueNowAction,
  retryEInvoiceDocumentAction,
  saveEInvoiceCredentialsAction,
  saveEInvoiceSettingsAction,
  testEInvoiceConnectionAction,
} from '@/app/actions/einvoice';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { useRealtimeRefresh } from '@/components/ui/useRealtimeRefresh';
import type { EInvoiceProviderInfo } from '@/lib/einvoice/providers';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type { EInvoiceDocType, EInvoiceStatus } from '@/types/database';
import { FlashMessage, useAdminMutation } from './useAdminMutation';

type DocRow = {
  id: string;
  orderNumber: number | null;
  docType: EInvoiceDocType;
  status: EInvoiceStatus;
  provider: string;
  environment: string;
  customerName: string | null;
  total: number;
  attempts: number;
  lastError: string | null;
  number: string | null;
  cufe: string | null;
  pdfUrl: string | null;
  issuedAt: string | null;
  createdAt: string;
  isCreditNoteFor: string | null;
};

const STATUS: Record<EInvoiceStatus, { label: string; className: string }> = {
  pending: { label: 'En cola', className: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  processing: { label: 'Enviando', className: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200' },
  accepted: { label: 'Aceptado', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' },
  rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  error: { label: 'Con error', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' },
  cancelled: { label: 'Cancelado', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500' },
};
const DOC_TYPE: Record<EInvoiceDocType, string> = { pos: 'Doc. POS', invoice: 'Factura', credit_note: 'Nota crédito' };

export function EInvoicingManager({
  tenant,
  credentials,
  encryptionKeyConfigured,
  providers,
  documents,
}: {
  tenant: {
    id: string;
    currency: string;
    locale: string;
    timezone: string;
    taxId: string | null;
    enabled: boolean;
    provider: string;
    environment: 'test' | 'production';
    defaultDoc: 'pos' | 'invoice';
  };
  credentials: { provider: string; config_hint: string | null; updated_at: string } | null;
  encryptionKeyConfigured: boolean;
  providers: EInvoiceProviderInfo[];
  documents: DocRow[];
}) {
  const router = useRouter();
  const money = (n: number) => formatCurrency(n, tenant.currency, tenant.locale);
  const fmt = (iso: string) => formatDateTime(iso, tenant.locale, tenant.timezone);
  const { pending, flash, run } = useAdminMutation();
  const [testing, startTest] = useTransition();

  const [enabled, setEnabled] = useState(tenant.enabled);
  const [provider, setProvider] = useState(tenant.provider);
  const [environment, setEnvironment] = useState(tenant.environment);
  const [defaultDoc, setDefaultDoc] = useState(tenant.defaultDoc);
  const [values, setValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<EInvoiceStatus | 'all'>('all');

  useRealtimeRefresh({
    channel: `einvoice:${tenant.id}`,
    subscriptions: [{ table: 'einvoice_documents', filter: `tenant_id=eq.${tenant.id}` }],
    onRefresh: () => router.refresh(),
    debounceMs: 800,
  });

  const selected = providers.find((p) => p.id === provider) ?? null;
  const credsForSelected = credentials?.provider === provider ? credentials : null;
  const counts = documents.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.status]: (acc[d.status] ?? 0) + 1 }), {});
  const visible = statusFilter === 'all' ? documents : documents.filter((d) => d.status === statusFilter);
  const dirty =
    enabled !== tenant.enabled || provider !== tenant.provider || environment !== tenant.environment || defaultDoc !== tenant.defaultDoc;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Facturación electrónica</h1>
        <Badge
          className={cn(
            'px-3 py-1 text-sm',
            tenant.enabled
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
              : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
          )}
        >
          {tenant.enabled ? `Activa · ${providers.find((p) => p.id === tenant.provider)?.label ?? tenant.provider} · ${tenant.environment === 'test' ? 'Pruebas' : 'Producción'}` : 'Desactivada'}
        </Badge>
      </div>

      <p className="max-w-3xl text-sm text-zinc-500">
        Cuando está activa, cada cuenta pagada genera su documento electrónico <b>en segundo plano</b>: el cobro nunca espera
        al proveedor ni falla por él. Si el proveedor o la DIAN no responden, el documento queda en cola y se reintenta.
        Desactivada, el POS funciona igual que siempre.
      </p>

      {!encryptionKeyConfigured && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Falta la variable <code>EINVOICE_ENCRYPTION_KEY</code> en el servidor: no se pueden guardar credenciales de proveedores
          (el Simulador sí funciona sin ella).
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Configuración */}
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4" /> Configuración
          </h2>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 accent-emerald-600" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <b>Manejar facturación electrónica</b>
              <span className="block text-zinc-500">Genera un documento por cada cuenta pagada y notas crédito al anular pagos facturados.</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="ei-provider">Proveedor</Label>
              <Select id="ei-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="none">Sin proveedor</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.implemented ? '' : ' (pendiente)'}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ei-env">Entorno</Label>
              <Select id="ei-env" value={environment} onChange={(e) => setEnvironment(e.target.value as 'test' | 'production')}>
                <option value="test">Pruebas / habilitación</option>
                <option value="production" disabled={selected ? !selected.environments.includes('production') : false}>
                  Producción
                </option>
              </Select>
            </div>
            <div>
              <Label htmlFor="ei-doc">Sin datos del cliente</Label>
              <Select id="ei-doc" value={defaultDoc} onChange={(e) => setDefaultDoc(e.target.value as 'pos' | 'invoice')}>
                <option value="pos">Documento POS electrónico</option>
                <option value="invoice">Factura (consumidor final)</option>
              </Select>
            </div>
          </div>
          {selected && (
            <p className="text-sm text-zinc-500">
              {selected.description}
              {!selected.implemented && (
                <span className="mt-1 block font-medium text-amber-700 dark:text-amber-300">
                  Conector pendiente: si lo activas, los documentos quedan en cola (sin enviarse) hasta conectarlo. El POS no se afecta.
                </span>
              )}
            </p>
          )}
          {!tenant.taxId && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Falta el NIT del gastrobar en <b>Ajustes → Datos para recibos</b>; los proveedores reales lo exigen.
            </p>
          )}
          <Button
            disabled={pending || !dirty}
            onClick={() =>
              run(
                () => saveEInvoiceSettingsAction({ enabled, provider: provider as 'none', environment, default_doc: defaultDoc }),
                'Configuración guardada',
              )
            }
          >
            Guardar configuración
          </Button>
        </Card>

        {/* Credenciales */}
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <PlugZap className="size-4" /> Conexión con {selected?.label ?? 'el proveedor'}
          </h2>
          {!selected ? (
            <p className="text-sm text-zinc-500">Elige un proveedor para configurar su conexión.</p>
          ) : (
            <>
              {credsForSelected ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-4" /> Credenciales guardadas ({credsForSelected.config_hint}) · {fmt(credsForSelected.updated_at)}
                </p>
              ) : (
                <p className="text-sm text-zinc-500">
                  {selected.id === 'simulator' ? 'El simulador no necesita credenciales.' : 'Aún no hay credenciales guardadas.'}
                </p>
              )}
              {selected.credentialFields.map((field) => (
                <div key={field.key}>
                  <Label htmlFor={`cred-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`cred-${field.key}`}
                    type={field.type}
                    autoComplete="off"
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={credsForSelected && field.type === 'password' ? '•••••••• (guardada)' : ''}
                  />
                  {field.help && <p className="mt-1 text-xs text-zinc-500">{field.help}</p>}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={pending || !encryptionKeyConfigured}
                  onClick={() =>
                    run(() => saveEInvoiceCredentialsAction(selected.id, values), 'Credenciales guardadas (cifradas)', () => setValues({}))
                  }
                >
                  Guardar credenciales
                </Button>
                <Button
                  variant="ghost"
                  disabled={testing}
                  onClick={() =>
                    startTest(async () => {
                      const result = await testEInvoiceConnectionAction();
                      setTestResult(result.ok ? result.data : { ok: false, message: result.error });
                    })
                  }
                >
                  {testing ? 'Probando…' : 'Probar conexión'}
                </Button>
              </div>
              {testResult && (
                <p className={cn('text-sm font-medium', testResult.ok ? 'text-emerald-600' : 'text-red-600')}>{testResult.message}</p>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Cola de documentos */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 p-4 dark:border-zinc-800">
          <h2 className="mr-auto flex items-center gap-2 font-semibold">
            <FileText className="size-4" /> Documentos
          </h2>
          <Button variant="secondary" size="sm" disabled={pending || !tenant.enabled} onClick={() => run(() => processEInvoiceQueueNowAction(), 'Cola procesada')}>
            <RefreshCw className="size-4" /> Procesar ahora
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !tenant.enabled}
            onClick={() => run(() => enqueueMissingEInvoicesAction(24), 'Cuentas de las últimas 24 h revisadas')}
            title="Genera documentos para cuentas pagadas que no lo tienen (p. ej. si activaste la facturación a mitad del día)"
          >
            Generar faltantes (24 h)
          </Button>
        </div>
        <div className="scrollbar-none flex gap-1 overflow-x-auto px-4 pt-3">
          {(['all', 'pending', 'processing', 'accepted', 'error', 'rejected', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={cn(
                'h-8 shrink-0 rounded-full px-3 text-xs font-semibold',
                statusFilter === s ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800',
              )}
            >
              {s === 'all' ? `Todos (${documents.length})` : `${STATUS[s].label} (${counts[s] ?? 0})`}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[46rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Documento</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="px-4 py-2.5 text-zinc-500">{fmt(d.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">
                      {DOC_TYPE[d.docType]} {d.number ?? ''}
                    </span>
                    <span className="text-xs text-zinc-500">
                      Orden #{d.orderNumber ?? '—'} · {d.environment === 'test' ? 'pruebas' : 'producción'}
                    </span>
                    {d.cufe && <span className="block max-w-56 truncate font-mono text-[11px] text-zinc-400" title={d.cufe}>{d.cufe}</span>}
                  </td>
                  <td className="px-4 py-2.5">{d.customerName ?? <span className="text-zinc-400">Consumidor final</span>}</td>
                  <td className="px-4 py-2.5 text-right">{money(d.total)}</td>
                  <td className="px-4 py-2.5">
                    <Badge className={STATUS[d.status].className}>{STATUS[d.status].label}</Badge>
                    {d.lastError && d.status !== 'accepted' && (
                      <span className="mt-1 block max-w-72 text-xs text-zinc-500" title={d.lastError}>
                        {d.lastError}
                      </span>
                    )}
                    {d.attempts > 1 && <span className="block text-[11px] text-zinc-400">{d.attempts} intentos</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    {(d.status === 'error' || d.status === 'rejected') && (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => retryEInvoiceDocumentAction(d.id), 'Documento reenviado a la cola')}>
                        <RotateCcw className="size-4" /> Reintentar
                      </Button>
                    )}
                    {d.pdfUrl && (
                      <a href={d.pdfUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-400">
                        PDF
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                    {tenant.enabled ? 'Sin documentos para este filtro.' : 'Activa la facturación electrónica para empezar a generar documentos.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <FlashMessage flash={flash} />
    </div>
  );
}
