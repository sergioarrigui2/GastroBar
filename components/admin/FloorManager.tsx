'use client';

import { Pencil, Plus, Save, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { createTablesBulkAction, deleteEntityAction, saveTableAction, saveZoneAction } from '@/app/actions/catalog';
import { Button, Card, Input, Label } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/utils';
import type { Tables } from '@/types/database';
import { FlashMessage, toNumber, useAdminMutation } from './useAdminMutation';

type Zone = Tables<'zones'>;
type DiningTable = Tables<'tables'>;

const STATUS_DOT: Record<DiningTable['status'], string> = {
  free: 'bg-emerald-500',
  occupied: 'bg-brand-500',
  reserved: 'bg-sky-500',
  cleaning: 'bg-zinc-400',
};

export function FloorManager({ zones, tables }: { zones: Zone[]; tables: DiningTable[] }) {
  const { pending, flash, run } = useAdminMutation();
  const [zoneName, setZoneName] = useState('');
  const [editingTable, setEditingTable] = useState<DiningTable | null>(null);

  const createZone = () => {
    if (!zoneName.trim()) return;
    run(() => saveZoneAction({ name: zoneName, sort_order: zones.length + 1 }), 'Zona creada', () => setZoneName(''));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-2xl font-bold">Salón y mesas</h1>
        <div className="flex gap-2">
          <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Nueva zona, ej. Terraza" aria-label="Nombre de la zona" onKeyDown={(e) => e.key === 'Enter' && createZone()} />
          <Button onClick={createZone} disabled={pending || !zoneName.trim()}>
            <Plus className="size-4" /> Zona
          </Button>
        </div>
      </div>

      {zones.length === 0 && <Card className="py-10 text-center text-zinc-500">Crea una zona (Terraza, Salón, Barra…) para agregar mesas.</Card>}

      {zones.map((zone) => (
        <ZoneCard
          key={`${zone.id}-${zone.name}-${zone.sort_order}`}
          zone={zone}
          tables={tables.filter((t) => t.zone_id === zone.id)}
          pending={pending}
          run={run}
          onEditTable={setEditingTable}
        />
      ))}

      {editingTable && (
        <TableEditor key={editingTable.id} table={editingTable} zones={zones} pending={pending} run={run} onClose={() => setEditingTable(null)} />
      )}
      <FlashMessage flash={flash} />
    </div>
  );
}

function ZoneCard({
  zone,
  tables,
  pending,
  run,
  onEditTable,
}: {
  zone: Zone;
  tables: DiningTable[];
  pending: boolean;
  run: ReturnType<typeof useAdminMutation>['run'];
  onEditTable: (t: DiningTable) => void;
}) {
  const [name, setName] = useState(zone.name);
  const [sort, setSort] = useState(String(zone.sort_order));
  const suggestedPrefix = zone.name.trim().charAt(0).toUpperCase();
  const [prefix, setPrefix] = useState(suggestedPrefix);
  const [from, setFrom] = useState(String(tables.length + 1));
  const [count, setCount] = useState('4');
  const [seats, setSeats] = useState('4');
  const dirty = name !== zone.name || sort !== String(zone.sort_order);

  const bulkCreate = () =>
    run(
      () =>
        createTablesBulkAction({
          zone_id: zone.id,
          prefix,
          from: Math.max(1, Math.trunc(toNumber(from) || 1)),
          count: Math.max(1, Math.trunc(toNumber(count) || 1)),
          seats: Math.max(1, Math.trunc(toNumber(seats) || 1)),
        }),
      'Mesas creadas',
    );

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs font-semibold" aria-label="Nombre de la zona" />
        <Input value={sort} onChange={(e) => setSort(e.target.value)} className="w-20" inputMode="numeric" aria-label="Orden" title="Orden" />
        <Button size="sm" disabled={pending || !dirty || !name.trim()} onClick={() => run(() => saveZoneAction({ id: zone.id, name, sort_order: Math.trunc(toNumber(sort) || 0) }), 'Zona guardada')}>
          <Save className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Eliminar zona ${zone.name}`}
          disabled={pending}
          onClick={() =>
            confirm(tables.length ? `¿Eliminar "${zone.name}" y sus ${tables.length} mesas? Las mesas con historial de órdenes no se pueden borrar.` : `¿Eliminar "${zone.name}"?`) &&
            run(() => deleteEntityAction('zones', zone.id), 'Zona eliminada')
          }
        >
          <Trash2 className="size-4 text-red-600" />
        </Button>
        <span className="ml-auto text-sm text-zinc-500">
          {tables.length} mesas · {tables.reduce((s, t) => s + t.seats, 0)} puestos
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {tables.map((t) => (
          <button
            key={t.id}
            onClick={() => onEditTable(t)}
            className="group relative flex aspect-square flex-col items-center justify-center rounded-2xl border-2 border-zinc-200 hover:border-brand-500 dark:border-zinc-700"
          >
            <span className={cn('absolute right-2 top-2 size-2.5 rounded-full', STATUS_DOT[t.status])} title={t.status} />
            <span className="text-xl font-black">{t.label}</span>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Users className="size-3" /> {t.seats}
            </span>
            <Pencil className="absolute bottom-2 right-2 size-3 text-zinc-400 opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 items-end gap-2 rounded-2xl bg-zinc-50 p-3 sm:grid-cols-[5rem_5rem_5rem_5rem_auto] dark:bg-zinc-800/50">
        <div>
          <Label htmlFor={`prefix-${zone.id}`}>Prefijo</Label>
          <Input id={`prefix-${zone.id}`} value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 6))} />
        </div>
        <div>
          <Label htmlFor={`from-${zone.id}`}>Desde</Label>
          <Input id={`from-${zone.id}`} value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor={`count-${zone.id}`}>Cantidad</Label>
          <Input id={`count-${zone.id}`} value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor={`seats-${zone.id}`}>Puestos</Label>
          <Input id={`seats-${zone.id}`} value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" />
        </div>
        <Button variant="secondary" onClick={bulkCreate} disabled={pending} className="col-span-2 sm:col-span-1">
          <Plus className="size-4" /> Crear {prefix}
          {Math.trunc(toNumber(from) || 1)}…{prefix}
          {Math.trunc(toNumber(from) || 1) + Math.max(1, Math.trunc(toNumber(count) || 1)) - 1}
        </Button>
      </div>
    </Card>
  );
}

function TableEditor({
  table,
  zones,
  pending,
  run,
  onClose,
}: {
  table: DiningTable;
  zones: Zone[];
  pending: boolean;
  run: ReturnType<typeof useAdminMutation>['run'];
  onClose: () => void;
}) {
  const [label, setLabel] = useState(table.label);
  const [seats, setSeats] = useState(String(table.seats));
  const [zoneId, setZoneId] = useState(table.zone_id);
  const [sort, setSort] = useState(String(table.sort_order));

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Mesa ${table.label}`}
      footer={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="text-red-600"
            disabled={pending || table.status === 'occupied'}
            title={table.status === 'occupied' ? 'No se puede eliminar una mesa ocupada' : undefined}
            onClick={() => confirm(`¿Eliminar la mesa ${table.label}?`) && run(() => deleteEntityAction('tables', table.id), 'Mesa eliminada', onClose)}
          >
            <Trash2 className="size-4" /> Eliminar
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={pending || !label.trim()}
            onClick={() =>
              run(
                () =>
                  saveTableAction({
                    id: table.id,
                    zone_id: zoneId,
                    label,
                    seats: Math.max(1, Math.trunc(toNumber(seats) || 1)),
                    sort_order: Math.max(0, Math.trunc(toNumber(sort) || 0)),
                  }),
                'Mesa guardada',
                onClose,
              )
            }
          >
            Guardar
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-label">Nombre / número</Label>
          <Input id="t-label" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 12))} />
        </div>
        <div>
          <Label htmlFor="t-seats">Puestos</Label>
          <Input id="t-seats" value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor="t-zone">Zona</Label>
          <select
            id="t-zone"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="t-sort">Orden</Label>
          <Input id="t-sort" value={sort} onChange={(e) => setSort(e.target.value)} inputMode="numeric" />
        </div>
      </div>
    </Sheet>
  );
}
