'use client';

import { Copy, Download, History, MonitorSmartphone, Pencil, Plus, Printer, Receipt, Route, Tags, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  createPairingCodeAction,
  deletePrinterAction,
  reprintJobAction,
  revokeStationAction,
  savePrinterAction,
  savePrintSettingsAction,
  testPrinterAction,
} from '@/app/actions/printing';
import { FlashMessage, useAdminMutation } from '@/components/admin/useAdminMutation';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { PRINT_DOCUMENT_LABELS, PRINT_DOCUMENTS, PRINTER_PROFILES, type PrintSettings } from '@/lib/printing/types';
import { cn, formatDateTime } from '@/lib/utils';
import type { Tables } from '@/types/database';

type Station = Pick<Tables<'print_stations'>, 'id' | 'name' | 'paired_at' | 'last_seen_at' | 'agent_version' | 'discovered' | 'pairing_expires_at' | 'created_at'>;
type PrinterRow = Tables<'printers'>;
type Job = Pick<Tables<'print_jobs'>, 'id' | 'printer_id' | 'document' | 'title' | 'status' | 'attempts' | 'error' | 'created_at' | 'printed_at'>;
type Category = { id: string; name: string; station: 'kitchen' | 'bar' };

const ONLINE_MS = 45_000;
const JOB_STATUS: Record<Job['status'], { label: string; cls: string }> = {
  pending: { label: 'En espera', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200' },
  printing: { label: 'Imprimiendo', cls: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200' },
  printed: { label: 'Impreso', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' },
  failed: { label: 'Falló', cls: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200' },
};

export function PrintingManager({
  appUrl,
  stations,
  printers,
  settings,
  categories,
  jobs,
  locale,
  timezone,
}: {
  appUrl: string;
  stations: Station[];
  printers: PrinterRow[];
  settings: PrintSettings;
  categories: Category[];
  jobs: Job[];
  locale: string;
  timezone: string;
}) {
  const router = useRouter();
  const { pending, flash, run } = useAdminMutation();
  const [now, setNow] = useState(() => Date.now());
  // Estado vivo de estaciones, impresoras y cola.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 10_000);
    return () => clearInterval(t);
  }, [router]);

  const fmt = (iso: string) => formatDateTime(iso, locale, timezone, { timeStyle: 'short', dateStyle: 'short' });
  const printerName = useMemo(() => new Map(printers.map((p) => [p.id, p.name])), [printers]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Impresión</h1>
        <p className="text-sm text-zinc-500">
          Comandas, precuentas, recibos y cierres en tus impresoras térmicas, sin diálogos. Funciona con cualquier marca compatible con ESC/POS.
        </p>
      </div>
      <StationsCard stations={stations} appUrl={appUrl} now={now} fmt={fmt} pending={pending} run={run} />
      <PrintersCard printers={printers} stations={stations} pending={pending} run={run} />
      {printers.length > 0 && <SettingsCard key={JSON.stringify(settings)} settings={settings} printers={printers} categories={categories} pending={pending} run={run} />}
      <JobsCard jobs={jobs} printerName={printerName} fmt={fmt} pending={pending} run={run} />
      <FlashMessage flash={flash} />
    </div>
  );
}

type Run = ReturnType<typeof useAdminMutation>['run'];

function Section({ icon: Icon, title, hint, children }: { icon: typeof Printer; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-zinc-500" />
        <div>
          <h2 className="font-semibold">{title}</h2>
          {hint && <p className="text-sm text-zinc-500">{hint}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function StationsCard({ stations, appUrl, now, fmt, pending, run }: { stations: Station[]; appUrl: string; now: number; fmt: (s: string) => string; pending: boolean; run: Run }) {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const command = pairing ? `node gastrobar-print.mjs vincular ${pairing.code} --app ${appUrl}` : '';
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  return (
    <Section icon={MonitorSmartphone} title="Estación de impresión" hint="El PC del local donde están conectadas las impresoras, con el programa GastroBar Print abierto.">
      {stations.length === 0 && !pairing && <p className="mb-3 text-sm text-zinc-500">Aún no hay estaciones vinculadas.</p>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {stations.map((s) => {
          const online = s.last_seen_at && now - new Date(s.last_seen_at).getTime() < ONLINE_MS;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.name}</span>
                <span className="block text-xs text-zinc-500">
                  {s.paired_at
                    ? `${s.last_seen_at ? `Último contacto ${fmt(s.last_seen_at)}` : 'Sin contacto aún'}${s.agent_version ? ` · v${s.agent_version}` : ''}`
                    : 'Esperando vinculación'}
                </span>
              </span>
              <Badge
                className={
                  online
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }
              >
                {online ? 'Conectada' : s.paired_at ? 'Desconectada' : 'Sin vincular'}
              </Badge>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => createPairingCodeAction({ stationId: s.id }), 'Código nuevo generado', setPairing)}>
                Nuevo código
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600"
                disabled={pending}
                onClick={() => confirm(`¿Desvincular "${s.name}"? Dejará de imprimir hasta vincularla de nuevo.`) && run(() => revokeStationAction(s.id), 'Estación desvinculada')}
              >
                Desvincular
              </Button>
            </li>
          );
        })}
      </ul>

      {pairing ? (
        <div className="mt-3 space-y-3 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
          <p className="font-semibold">Vincula el PC en 3 pasos (el código vence a las {new Date(pairing.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}):</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              En el PC, instala <a className="font-semibold text-brand-600 underline" href="https://nodejs.org/es/download" target="_blank" rel="noreferrer">Node.js (LTS)</a> si no lo tiene.
            </li>
            <li>
              Descarga{' '}
              <a className="font-semibold text-brand-600 underline" href="/descargas/gastrobar-print.mjs" download>
                gastrobar-print.mjs
              </a>{' '}
              y{' '}
              <a className="font-semibold text-brand-600 underline" href="/descargas/GastroBar Print.bat" download>
                GastroBar Print.bat
              </a>{' '}
              en una misma carpeta (por ejemplo, Documentos\GastroBar).
            </li>
            <li>
              Abre una terminal en esa carpeta y ejecuta:
              <div className="mt-1 flex items-center gap-2 rounded-lg bg-zinc-900 p-2 font-mono text-xs text-zinc-100">
                <code className="min-w-0 flex-1 break-all">{command}</code>
                <button type="button" onClick={() => copy(command)} aria-label="Copiar comando" className="shrink-0 rounded p-1 hover:bg-zinc-700">
                  <Copy className="size-4" />
                </button>
              </div>
            </li>
          </ol>
          <p className="text-zinc-500">
            Luego abre <b>GastroBar Print.bat</b> y déjalo abierto. Para que arranque solo con Windows: Win + R → <code>shell:startup</code> → pega ahí un acceso directo al .bat.
          </p>
          <p className="text-2xl font-black tracking-widest">{pairing.code}</p>
        </div>
      ) : (
        <Button className="mt-3" variant="secondary" disabled={pending} onClick={() => run(() => createPairingCodeAction({ name: 'PC de caja' }), 'Código de vinculación generado', setPairing)}>
          <Plus className="size-4" /> Vincular un PC
        </Button>
      )}
      <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
        <Download className="size-3.5" /> Descargas: <a href="/descargas/gastrobar-print.mjs" download className="underline">programa</a> ·{' '}
        <a href="/descargas/GastroBar Print.bat" download className="underline">lanzador para Windows</a>
      </p>
    </Section>
  );
}

const EMPTY_PRINTER = {
  id: undefined as string | undefined,
  station_id: '',
  name: '',
  connection: 'windows' as 'windows' | 'network',
  target: '',
  paper_width: 80 as 58 | 80,
  profile: 'generic',
  codepage: 'cp850' as 'cp850' | 'cp1252' | 'ascii',
  mode: 'escpos' as 'escpos' | 'text',
  cut: true,
  is_active: true,
};

function PrintersCard({ printers, stations, pending, run }: { printers: PrinterRow[]; stations: Station[]; pending: boolean; run: Run }) {
  const paired = stations.filter((s) => s.paired_at);
  const [form, setForm] = useState<typeof EMPTY_PRINTER | null>(null);
  const set = <K extends keyof typeof EMPTY_PRINTER>(k: K, v: (typeof EMPTY_PRINTER)[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const discovered = (stationId: string) => {
    const list = paired.find((s) => s.id === stationId)?.discovered;
    return Array.isArray(list) ? (list as Array<{ name: string; port?: string }>) : [];
  };

  return (
    <Section icon={Printer} title="Impresoras" hint="Las térmicas conectadas al PC (USB o compartidas) o a la red. Usa «Probar» para verificar tildes y corte.">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {printers.map((p) => (
          <li key={p.id} className={cn('flex flex-wrap items-center gap-3 py-2.5', !p.is_active && 'opacity-50')}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{p.name}</span>
              <span className="block text-xs text-zinc-500">
                {p.connection === 'network' ? `Red ${p.target}` : `Windows: ${p.target}`} · {p.paper_width} mm ·{' '}
                {PRINTER_PROFILES.find((x) => x.id === p.profile)?.label ?? p.profile}
                {p.mode === 'text' && ' · modo universal'}
              </span>
              {p.status === 'error' && p.status_message && <span className="block text-xs font-medium text-red-600">{p.status_message}</span>}
            </span>
            <Badge
              className={
                p.status === 'ok'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                  : p.status === 'error'
                    ? 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }
            >
              {p.status === 'ok' ? 'Lista' : p.status === 'error' ? 'Con error' : 'Sin probar'}
            </Badge>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => testPrinterAction(p.id), `Prueba enviada a ${p.name}`)}>
              Probar
            </Button>
            <button type="button" aria-label={`Editar ${p.name}`} onClick={() => setForm({ ...EMPTY_PRINTER, ...p })} className="grid size-9 place-items-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Eliminar ${p.name}`}
              disabled={pending}
              onClick={() => confirm(`¿Eliminar la impresora "${p.name}"?`) && run(() => deletePrinterAction(p.id), 'Impresora eliminada')}
              className="grid size-9 place-items-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      {!form && (
        <Button className="mt-3" variant="secondary" disabled={!paired.length} onClick={() => setForm({ ...EMPTY_PRINTER, station_id: paired[0]?.id ?? '' })}>
          <Plus className="size-4" /> Agregar impresora
        </Button>
      )}
      {!paired.length && <p className="mt-2 text-xs text-zinc-500">Primero vincula el PC donde están conectadas.</p>}

      {form && (
        <div className="mt-3 grid gap-3 rounded-xl bg-zinc-50 p-4 sm:grid-cols-2 dark:bg-zinc-900">
          <div>
            <Label htmlFor="p-name">Nombre</Label>
            <Input id="p-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Caja, Cocina, Barra…" />
          </div>
          <div>
            <Label htmlFor="p-station">Conectada al PC</Label>
            <Select id="p-station" value={form.station_id} onChange={(e) => set('station_id', e.target.value)}>
              {paired.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-conn">Conexión</Label>
            <Select id="p-conn" value={form.connection} onChange={(e) => (set('connection', e.target.value as 'windows' | 'network'), set('target', ''))}>
              <option value="windows">USB o compartida (instalada en Windows)</option>
              <option value="network">Red (cable o wifi, por IP)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="p-target">{form.connection === 'network' ? 'IP de la impresora' : 'Impresora en Windows'}</Label>
            {form.connection === 'windows' && discovered(form.station_id).length > 0 ? (
              <Select id="p-target" value={form.target} onChange={(e) => set('target', e.target.value)}>
                <option value="">Elige…</option>
                {discovered(form.station_id).map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                    {d.port ? ` (${d.port})` : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id="p-target" value={form.target} onChange={(e) => set('target', e.target.value)} placeholder={form.connection === 'network' ? '192.168.1.50' : 'Nombre exacto en Windows'} />
            )}
          </div>
          <div>
            <Label htmlFor="p-width">Ancho del papel</Label>
            <Select id="p-width" value={form.paper_width} onChange={(e) => set('paper_width', Number(e.target.value) as 58 | 80)}>
              <option value={80}>80 mm (48 letras por línea)</option>
              <option value={58}>58 mm (32 letras por línea)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="p-profile">Marca</Label>
            <Select
              id="p-profile"
              value={form.profile}
              onChange={(e) => {
                const profile = PRINTER_PROFILES.find((p) => p.id === e.target.value)!;
                set('profile', profile.id);
                set('codepage', profile.codepage);
              }}
            >
              {PRINTER_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-cp">Tabla de caracteres (si las tildes salen raras)</Label>
            <Select id="p-cp" value={form.codepage} onChange={(e) => set('codepage', e.target.value as typeof form.codepage)}>
              <option value="cp850">PC850 · la más común</option>
              <option value="cp1252">Windows-1252</option>
              <option value="ascii">Sin tildes (seguro)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="p-mode">Modo</Label>
            <Select id="p-mode" value={form.mode} onChange={(e) => set('mode', e.target.value as 'escpos' | 'text')}>
              <option value="escpos">Térmica ESC/POS (recomendado)</option>
              <option value="text">Universal (cualquier impresora, sin corte ni cajón)</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-brand-500" checked={form.cut} onChange={(e) => set('cut', e.target.checked)} /> Cortar el papel al final
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-brand-500" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Activa
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button disabled={pending} onClick={() => run(() => savePrinterAction(form), form.id ? 'Impresora actualizada' : 'Impresora agregada', () => setForm(null))}>
              Guardar
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function SettingsCard({ settings, printers, categories, pending, run }: { settings: PrintSettings; printers: PrinterRow[]; categories: Category[]; pending: boolean; run: Run }) {
  const [draft, setDraft] = useState(settings);
  const setRoute = (doc: (typeof PRINT_DOCUMENTS)[number], value: string) => setDraft((d) => ({ ...d, routes: { ...d.routes, [doc]: value || null } }));
  const setOverride = (categoryId: string, value: string) =>
    setDraft((d) => {
      const next = { ...d.category_overrides };
      if (value) next[categoryId] = value;
      else delete next[categoryId];
      return { ...d, category_overrides: next };
    });
  const setOption = <K extends keyof PrintSettings['options']>(k: K, v: PrintSettings['options'][K]) => setDraft((d) => ({ ...d, options: { ...d.options, [k]: v } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const printerOptions = printers.filter((p) => p.is_active);
  const stationDefault = (station: 'kitchen' | 'bar') => {
    const id = draft.routes[station === 'bar' ? 'bar_order' : 'kitchen_order'];
    return id ? (printers.find((p) => p.id === id)?.name ?? 'No imprimir') : 'No imprimir';
  };

  return (
    <>
      <Section icon={Route} title="Qué se imprime y dónde" hint="Cada documento sale en su impresora sin importar desde qué equipo se pida.">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {PRINT_DOCUMENTS.map((doc) => (
            <li key={doc} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{PRINT_DOCUMENT_LABELS[doc].label}</span>
                <span className="block text-xs text-zinc-500">{PRINT_DOCUMENT_LABELS[doc].when}</span>
              </span>
              <Select value={draft.routes[doc] ?? ''} onChange={(e) => setRoute(doc, e.target.value)} className="w-56" aria-label={PRINT_DOCUMENT_LABELS[doc].label}>
                <option value="">No imprimir automáticamente</option>
                {printerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Tags} title="Excepciones por categoría" hint="Por defecto, cada categoría imprime según su estación (cocina o barra). Aquí puedes cambiarlo.">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 font-medium">{c.name}</span>
              <Select value={draft.category_overrides[c.id] ?? ''} onChange={(e) => setOverride(c.id, e.target.value)} className="w-56" aria-label={`Impresión de ${c.name}`}>
                <option value="">Por defecto ({stationDefault(c.station)})</option>
                <option value="none">No imprimir comanda</option>
                {printerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    Imprimir en {p.name}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Receipt} title="Formato y automatismos">
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-3">
            <span className="flex-1">Copias de cada comanda</span>
            <Select value={draft.options.order_copies} onChange={(e) => setOption('order_copies', Number(e.target.value))} className="w-24">
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          {(
            [
              ['large_notes', 'Productos y notas en letra grande en la comanda (más fácil de leer en cocina)'],
              ['prices_on_order', 'Mostrar precios en la comanda'],
              ['receipt_on_payment', 'Imprimir el recibo al cobrar la cuenta completa'],
              ['open_drawer_on_cash', 'Abrir el cajón de dinero cuando se cobra en efectivo'],
              ['cash_report_on_close', 'Imprimir el cierre (Z) al cerrar la caja'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3">
              <input type="checkbox" className="size-5 accent-brand-500" checked={draft.options[key]} onChange={(e) => setOption(key, e.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button size="lg" disabled={!dirty || pending} onClick={() => run(() => savePrintSettingsAction(draft), 'Configuración de impresión guardada')}>
          {dirty ? 'Guardar cambios' : 'Sin cambios'}
        </Button>
      </div>
    </>
  );
}

function JobsCard({ jobs, printerName, fmt, pending, run }: { jobs: Job[]; printerName: Map<string, string>; fmt: (s: string) => string; pending: boolean; run: Run }) {
  return (
    <Section icon={History} title="Cola de impresión" hint="Los últimos 40 trabajos. Si una impresora estuvo apagada o sin papel, sus trabajos esperan y salen al volver.">
      {jobs.length === 0 ? (
        <p className="text-sm text-zinc-500">Todavía no se ha impreso nada.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{j.title}</span>
                <span className="block text-xs text-zinc-500">
                  {printerName.get(j.printer_id) ?? 'Impresora eliminada'} · {fmt(j.created_at)}
                  {j.attempts > 1 && ` · ${j.attempts} intentos`}
                </span>
                {j.error && j.status !== 'printed' && <span className="block text-xs text-red-600">{j.error}</span>}
              </span>
              <Badge className={JOB_STATUS[j.status].cls}>{JOB_STATUS[j.status].label}</Badge>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => reprintJobAction(j.id), 'Enviado de nuevo a la cola')}>
                Reimprimir
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
