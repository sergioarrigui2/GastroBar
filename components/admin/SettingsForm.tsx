'use client';

import { useState } from 'react';
import { updateTenantSettingsAction } from '@/app/actions/catalog';
import { Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import type { Tenant } from '@/types/domain';
import { FlashMessage, toNumber, useAdminMutation } from './useAdminMutation';

const CURRENCIES = [
  ['COP', 'Peso colombiano'],
  ['MXN', 'Peso mexicano'],
  ['USD', 'Dólar estadounidense'],
  ['EUR', 'Euro'],
  ['PEN', 'Sol peruano'],
  ['CLP', 'Peso chileno'],
  ['ARS', 'Peso argentino'],
] as const;

const LOCALES = [
  ['es-CO', 'Español (Colombia)'],
  ['es-MX', 'Español (México)'],
  ['es-ES', 'Español (España)'],
  ['es-PE', 'Español (Perú)'],
  ['es-CL', 'Español (Chile)'],
  ['es-AR', 'Español (Argentina)'],
  ['en-US', 'English (US)'],
] as const;

const TIMEZONES = [
  'America/Bogota',
  'America/Mexico_City',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'Europe/Madrid',
];

export function SettingsForm({ tenant }: { tenant: Tenant }) {
  const { pending, flash, run } = useAdminMutation();
  const [name, setName] = useState(tenant.name);
  const [currency, setCurrency] = useState(tenant.currency);
  const [locale, setLocale] = useState(tenant.locale);
  const [timezone, setTimezone] = useState(tenant.timezone);
  const [warning, setWarning] = useState(String(tenant.kds_warning_minutes));
  const [late, setLate] = useState(String(tenant.kds_late_minutes));
  const [allowNegative, setAllowNegative] = useState(tenant.allow_negative_stock);
  const [publicMenu, setPublicMenu] = useState(tenant.public_menu_enabled);
  const [taxId, setTaxId] = useState(tenant.tax_id ?? '');
  const [address, setAddress] = useState(tenant.address ?? '');
  const [phone, setPhone] = useState(tenant.phone ?? '');
  const [footer, setFooter] = useState(tenant.receipt_footer ?? '');

  const save = () =>
    run(
      () =>
        updateTenantSettingsAction({
          name,
          currency,
          locale,
          timezone,
          kds_warning_minutes: Math.trunc(toNumber(warning)),
          kds_late_minutes: Math.trunc(toNumber(late)),
          allow_negative_stock: allowNegative,
          public_menu_enabled: publicMenu,
          tax_id: taxId.trim() || null,
          address: address.trim() || null,
          phone: phone.trim() || null,
          receipt_footer: footer.trim() || null,
        }),
      'Ajustes guardados',
    );

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">Ajustes del gastrobar</h1>

      <Card className="space-y-4">
        <h2 className="font-semibold">General</h2>
        <div>
          <Label htmlFor="s-name">Nombre</Label>
          <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1 text-xs text-zinc-500">Identificador: {tenant.slug}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="s-currency">Moneda</Label>
            <Select id="s-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="s-locale">Formato</Label>
            <Select id="s-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
              {LOCALES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="s-tz">Zona horaria</Label>
            <Select id="s-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {[...new Set([timezone, ...TIMEZONES])].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Datos para recibos y menú público</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-tax">NIT / identificación tributaria</Label>
            <Input id="s-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="900.123.456-7" />
          </div>
          <div>
            <Label htmlFor="s-phone">Teléfono</Label>
            <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="s-address">Dirección</Label>
            <Input id="s-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="s-footer">Pie del recibo</Label>
            <Input id="s-footer" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="¡Gracias por tu visita! Propina voluntaria." />
          </div>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 accent-emerald-600" checked={publicMenu} onChange={(e) => setPublicMenu(e.target.checked)} />
          <span>
            <b>Menú QR público activo</b>
            <span className="block text-zinc-500">
              Los clientes pueden ver el menú en <code>/m/{tenant.slug}</code> escaneando el código QR de la mesa.
            </span>
          </span>
        </label>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Tiempos del KDS</h2>
        <p className="text-sm text-zinc-500">
          Las comandas se ven en verde hasta el primer límite, en amarillo hasta el segundo y en rojo después.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-warn">Amarillo (al límite) desde, minutos</Label>
            <Input id="s-warn" value={warning} onChange={(e) => setWarning(e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <Label htmlFor="s-late">Rojo (retrasado) desde, minutos</Label>
            <Input id="s-late" value={late} onChange={(e) => setLate(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">Inventario</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 accent-emerald-600" checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />
          <span>
            <b>Permitir vender sin stock suficiente</b>
            <span className="block text-zinc-500">
              Si está apagado, una comanda falla cuando algún insumo de la receta no alcanza. Enciéndelo mientras cargas el
              inventario inicial.
            </span>
          </span>
        </label>
      </Card>

      <Button size="lg" onClick={save} disabled={pending || name.trim().length < 2}>
        {pending ? 'Guardando…' : 'Guardar ajustes'}
      </Button>
      <FlashMessage flash={flash} />
    </div>
  );
}
