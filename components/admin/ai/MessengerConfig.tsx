'use client';

import { Loader2, Mail, MessageCircle, Plus, Send, Share2, X } from 'lucide-react';
import { useState } from 'react';
import { saveMessengerSettingsAction, sendDigestNowAction } from '@/app/actions/messenger';
import { FlashMessage, useAdminMutation } from '@/components/admin/useAdminMutation';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { FREQUENCY_LABEL } from '@/lib/purchasing/schedule';
import { cn, formatDateTime } from '@/lib/utils';
import type { Tables } from '@/types/database';

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function MessengerConfig({
  settings,
  schedule,
  deliveries,
  preview,
  emailConfigured,
  sandboxSender,
  locale,
  timezone,
}: {
  settings: Tables<'messenger_settings'> | null;
  schedule: Tables<'agent_schedules'> | null;
  deliveries: Tables<'messenger_deliveries'>[];
  preview: { subject: string; html: string; text: string } | null;
  emailConfigured: boolean;
  sandboxSender: boolean;
  locale: string;
  timezone: string;
}) {
  const { pending, flash, run } = useAdminMutation();
  const [emails, setEmails] = useState<string[]>(settings?.emails ?? []);
  const [draft, setDraft] = useState('');
  const [phone, setPhone] = useState(settings?.whatsapp_phone ?? '');
  const [form, setForm] = useState({
    is_active: schedule?.is_active ?? false,
    frequency: schedule?.frequency ?? 'weekly',
    weekday: schedule?.weekday ?? 1,
    day_of_month: schedule?.day_of_month ?? 1,
    hour: schedule?.hour ?? 7,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const when = (iso: string) => formatDateTime(iso, locale, timezone);

  const addEmail = () => {
    const e = draft.trim().toLowerCase();
    if (!e || emails.includes(e) || emails.length >= 5) return;
    setEmails([...emails, e]);
    setDraft('');
  };

  const digits = phone.replace(/\D/g, '');
  const waText = preview?.text ?? '';
  const waToMe = digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(waText)}` : null;
  const waShare = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Mail className="size-5 text-zinc-400" aria-hidden /> ¿A quién le escribo?
          </h2>
          <div>
            <Label htmlFor="m-email">Correos (hasta 5)</Label>
            <div className="flex gap-2">
              <Input
                id="m-email"
                type="email"
                value={draft}
                placeholder="tu@correo.com"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addEmail();
                  }
                }}
              />
              <Button variant="secondary" onClick={addEmail} disabled={!draft.trim() || emails.length >= 5} aria-label="Agregar correo">
                <Plus className="size-4" />
              </Button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {emails.map((e) => (
                <li key={e} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pl-3 pr-1 text-sm dark:bg-zinc-800">
                  {e}
                  <button
                    type="button"
                    onClick={() => setEmails(emails.filter((x) => x !== e))}
                    className="grid size-6 place-items-center rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    aria-label={`Quitar ${e}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Label htmlFor="m-phone">Tu WhatsApp (con indicativo, para el botón)</Label>
            <Input id="m-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="573001234567" />
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Send className="size-5 text-zinc-400" aria-hidden /> ¿Cuándo te escribo?
          </h2>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="size-5 accent-brand-600" />
            <span className="font-medium">Enviar el resumen automáticamente por correo</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="m-freq">Frecuencia</Label>
              <Select id="m-freq" value={form.frequency} onChange={(e) => set('frequency', e.target.value as typeof form.frequency)}>
                {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
            {(form.frequency === 'weekly' || form.frequency === 'biweekly') && (
              <div>
                <Label htmlFor="m-day">Día</Label>
                <Select id="m-day" value={form.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {form.frequency === 'monthly' && (
              <div>
                <Label htmlFor="m-dom">Día del mes</Label>
                <Select id="m-dom" value={form.day_of_month} onChange={(e) => set('day_of_month', Number(e.target.value))}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="m-hour">Hora</Label>
              <Select id="m-hour" value={form.hour} onChange={(e) => set('hour', Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {schedule?.is_active && schedule.next_run_at && <p className="text-sm text-zinc-500">Próximo envío: {when(schedule.next_run_at)}</p>}
          {schedule?.last_error && <p className="text-sm text-red-600">Último error: {schedule.last_error}</p>}
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => saveMessengerSettingsAction({ emails, whatsapp_phone: phone || null, ...form }),
                'Mensajero configurado',
              )
            }
          >
            Guardar
          </Button>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Así se ve tu resumen de hoy</h2>
          {waToMe && (
            <a
              href={waToMe}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <MessageCircle className="size-4" /> Enviar a mi WhatsApp
            </a>
          )}
          <a
            href={waShare}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
          >
            <Share2 className="size-4" /> Compartir por WhatsApp
          </a>
          <Button
            disabled={pending || !emailConfigured || (settings?.emails ?? []).length === 0}
            onClick={() => run(() => sendDigestNowAction(), 'Resumen enviado por correo')}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Enviar ahora por correo
          </Button>
        </div>
        {!emailConfigured && (
          <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            El correo no está configurado en el servidor (RESEND_API_KEY). El botón de WhatsApp sí funciona.
          </p>
        )}
        {emailConfigured && sandboxSender && (
          <p className="rounded-xl bg-sky-100 p-3 text-sm text-sky-900 dark:bg-sky-500/15 dark:text-sky-200">
            Modo de prueba de Resend: por ahora el correo sólo llega a la dirección con la que se creó la cuenta de Resend. Para enviar a
            cualquier correo, el administrador de la plataforma debe verificar un dominio en Resend.
          </p>
        )}
        {preview ? (
          <>
            <p className="text-sm">
              <span className="text-zinc-500">Asunto:</span> <b>{preview.subject}</b>
            </p>
            <iframe
              title="Vista previa del correo"
              srcDoc={preview.html}
              // Sin scripts; allow-same-origin sólo para que todos los navegadores pinten el HTML del correo.
              sandbox="allow-same-origin"
              className="h-[560px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
            />
          </>
        ) : (
          <p className="text-sm text-zinc-500">No se pudo armar la vista previa todavía.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Envíos</h2>
        {deliveries.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">Aún no he enviado ningún resumen.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Badge
                  className={cn(
                    d.status === 'sent'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                      : 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200',
                  )}
                >
                  {d.status === 'sent' ? 'Enviado' : 'Error'}
                </Badge>
                <span>{when(d.created_at)}</span>
                <span className="text-zinc-500">{d.trigger === 'schedule' ? 'Programado' : 'Manual'}</span>
                <span className="min-w-0 truncate text-zinc-500">{d.recipients.join(', ')}</span>
                {d.error && <span className="w-full text-xs text-red-600">{d.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FlashMessage flash={flash} />
    </div>
  );
}
