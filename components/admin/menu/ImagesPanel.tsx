'use client';

import { ImageUp, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getMenuImagesAiStatusAction, setProductImageAction, suggestPhotoProductsAction } from '@/app/actions/catalog';
import { Badge, Button, Card, Input, Select } from '@/components/ui/primitives';
import type { CatalogSnapshot } from '@/lib/services/catalog';
import { matchByFilename } from '@/lib/images/match';
import { aiThumbnail, IMAGE_BUCKET, MAX_UPLOAD_BYTES, menuPhoto } from '@/lib/images/process';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { ProductImageField } from './ProductImageField';

const MAX_FILES = 300;
const AI_BATCH = 8;

type Item = {
  key: string;
  filename: string;
  source: File;
  photo: Blob;
  preview: string;
  productId: string;
  origin: 'nombre' | 'ia' | 'manual' | null;
  confidence?: 'alta' | 'media' | 'baja';
  state: 'ready' | 'uploading' | 'done' | 'error';
  error?: string;
};

type AiStatus = { enabled: boolean; reason: string | null; photosLeft: number } | null;

/** Imágenes del menú: cobertura, carga masiva (por nombre de archivo o con IA) y carga manual por producto. */
export function ImagesPanel({ catalog, tenantId }: { catalog: CatalogSnapshot; tenantId: string }) {
  const router = useRouter();
  const products = useMemo(() => catalog.products.filter((p) => p.is_active).sort((a, b) => a.name.localeCompare(b.name, 'es')), [catalog.products]);
  const withImage = products.filter((p) => p.image_url).length;
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ai, setAi] = useState<AiStatus>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getMenuImagesAiStatusAction().then((r) => setAi(r.ok ? r.data : { enabled: false, reason: r.error, photosLeft: 0 }));
  }, []);
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const assignedCount = new Map<string, number>();
  for (const i of items) if (i.productId && i.state !== 'done') assignedCount.set(i.productId, (assignedCount.get(i.productId) ?? 0) + 1);
  const pendingItems = items.filter((i) => i.state !== 'done');
  const unassigned = pendingItems.filter((i) => !i.productId);
  const toUpload = pendingItems.filter((i) => i.productId && assignedCount.get(i.productId) === 1);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setMessage(null);
    const list = [...files].filter((f) => f.type.startsWith('image/') && f.size <= MAX_UPLOAD_BYTES).slice(0, MAX_FILES - items.length);
    const skipped = files.length - list.length;
    setBusy(`Preparando 0 de ${list.length} fotos…`);
    const prepared: Item[] = [];
    for (const [n, file] of list.entries()) {
      setBusy(`Preparando ${n + 1} de ${list.length} fotos…`);
      try {
        const photo = await menuPhoto(file);
        const match = matchByFilename(file.name, products);
        prepared.push({
          key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
          filename: file.name,
          source: file,
          photo,
          preview: URL.createObjectURL(photo),
          productId: match?.id ?? '',
          origin: match ? 'nombre' : null,
          state: 'ready',
        });
      } catch {
        // imagen dañada o formato no soportado: se omite
      }
    }
    setItems((prev) => [...prev, ...prepared]);
    setBusy(null);
    const byName = prepared.filter((p) => p.origin === 'nombre').length;
    setMessage({
      ok: true,
      text: `${prepared.length} foto(s) listas; ${byName} emparejada(s) por el nombre del archivo.${skipped ? ` ${skipped} se omitieron (no son imágenes, pesan más de 15 MB o superan ${MAX_FILES}).` : ''}`,
    });
    if (input.current) input.current.value = '';
  };

  const update = (key: string, patch: Partial<Item>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const remove = (key: string) =>
    setItems((prev) => {
      const item = prev.find((i) => i.key === key);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((i) => i.key !== key);
    });

  const suggestWithAi = async () => {
    if (!ai?.enabled) return;
    const batch = unassigned.slice(0, ai.photosLeft);
    if (!batch.length) return;
    if (!confirm(`La IA revisará ${batch.length} foto(s) sin asignar. Esto usa el cupo de IA del mes (quedan ${ai.photosLeft} fotos). ¿Continuar?`)) return;
    setMessage(null);
    let suggested = 0;
    for (let i = 0; i < batch.length; i += AI_BATCH) {
      const chunk = batch.slice(i, i + AI_BATCH);
      setBusy(`La IA está revisando ${Math.min(i + AI_BATCH, batch.length)} de ${batch.length} fotos…`);
      const thumbs = await Promise.all(chunk.map((c) => aiThumbnail(c.source)));
      const result = await suggestPhotoProductsAction(thumbs);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        break;
      }
      for (const s of result.data) {
        const item = chunk[s.photo - 1];
        if (item && s.productId) {
          suggested++;
          update(item.key, { productId: s.productId, origin: 'ia', confidence: s.confidence });
        }
      }
    }
    setBusy(null);
    const status = await getMenuImagesAiStatusAction();
    if (status.ok) setAi(status.data);
    setMessage((m) => m ?? { ok: true, text: `La IA sugirió producto para ${suggested} foto(s). Revisa especialmente las de confianza media o baja.` });
  };

  const uploadAll = async () => {
    const storage = getSupabaseBrowserClient().storage.from(IMAGE_BUCKET);
    let ok = 0;
    for (const [n, item] of toUpload.entries()) {
      setBusy(`Subiendo ${n + 1} de ${toUpload.length}…`);
      update(item.key, { state: 'uploading' });
      try {
        const path = `${tenantId}/${crypto.randomUUID()}.webp`;
        const { error } = await storage.upload(path, item.photo, { contentType: 'image/webp', cacheControl: '31536000' });
        if (error) throw error;
        const saved = await setProductImageAction(item.productId, storage.getPublicUrl(path).data.publicUrl);
        if (!saved.ok) throw new Error(saved.error);
        update(item.key, { state: 'done' });
        ok++;
      } catch (e) {
        update(item.key, { state: 'error', error: e instanceof Error ? e.message : 'No se pudo subir' });
      }
    }
    setBusy(null);
    setMessage({ ok: ok === toUpload.length, text: `${ok} de ${toUpload.length} imagen(es) guardadas en el menú.` });
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <Card className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Fotos del menú</h2>
          <p className="text-sm text-zinc-500">
            <b className="text-zinc-900 dark:text-zinc-100">{withImage}</b> de {products.length} productos activos tienen foto
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full bg-brand-500" style={{ width: `${products.length ? (withImage / products.length) * 100 : 0}%` }} />
        </div>
        <p className="text-xs text-zinc-500">Se ven en el menú QR, el comandero y la lista de productos. Todas se recortan en cuadrado y se optimizan solas.</p>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <ImageUp className="mt-0.5 size-5 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Carga masiva</h3>
            <p className="text-sm text-zinc-500">
              Selecciona muchas fotos a la vez (por ejemplo, las descargadas de Facebook: descomprime el ZIP primero). Si el nombre del archivo es el del producto
              («hamburguesa-mixta.jpg»), se empareja sola y gratis.
            </p>
          </div>
        </div>
        <label
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 p-6 text-center text-sm hover:border-brand-500 dark:border-zinc-700"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="size-6 text-zinc-400" />
          <span>
            <b>Toca para elegir fotos</b> o arrástralas aquí · hasta {MAX_FILES}
          </span>
          <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void addFiles(e.target.files)} />
        </label>

        {(busy || message) && (
          <p role="status" className={cn('flex items-center gap-2 text-sm font-medium', message && !message.ok && !busy ? 'text-red-600' : 'text-zinc-700 dark:text-zinc-200')}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ?? message?.text}
          </p>
        )}

        {pendingItems.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
              <span className="flex-1">
                {pendingItems.length} foto(s) · {pendingItems.length - unassigned.length} asignada(s) · {unassigned.length} sin asignar
              </span>
              {unassigned.length > 0 && (
                <Button variant="secondary" size="sm" disabled={Boolean(busy) || !ai?.enabled} onClick={() => void suggestWithAi()} title={ai?.reason ?? undefined}>
                  <Sparkles className="size-4" /> Sugerir con IA ({Math.min(unassigned.length, ai?.photosLeft ?? 0)})
                </Button>
              )}
              <Button size="sm" disabled={Boolean(busy) || toUpload.length === 0} onClick={() => void uploadAll()}>
                Guardar {toUpload.length} en el menú
              </Button>
            </div>
            {ai && !ai.enabled && unassigned.length > 0 && <p className="text-xs text-zinc-500">{ai.reason} Puedes asignarlas a mano.</p>}
            {ai?.enabled && <p className="text-xs text-zinc-500">La IA revisa sólo las fotos sin asignar y en miniatura. Cupo restante este mes: {ai.photosLeft} fotos.</p>}

            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {pendingItems.map((item) => {
                const product = productById.get(item.productId);
                const duplicate = item.productId && (assignedCount.get(item.productId) ?? 0) > 1;
                return (
                  <li key={item.key} className={cn('relative space-y-2 rounded-xl border p-2 text-xs', duplicate ? 'border-amber-400' : 'border-zinc-200 dark:border-zinc-800')}>
                    <button type="button" onClick={() => remove(item.key)} aria-label={`Quitar ${item.filename}`} className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-white/90 text-zinc-700 shadow dark:bg-zinc-900/90 dark:text-zinc-200">
                      <X className="size-4" />
                    </button>
                    <img src={item.preview} alt={item.filename} className="aspect-square w-full rounded-lg object-cover" />
                    <p className="truncate text-zinc-500" title={item.filename}>
                      {item.filename}
                    </p>
                    <Select
                      value={item.productId}
                      onChange={(e) => update(item.key, { productId: e.target.value, origin: e.target.value ? 'manual' : null, confidence: undefined })}
                      className="h-9 text-xs"
                      aria-label={`Producto de ${item.filename}`}
                    >
                      <option value="">— Sin asignar —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <div className="flex flex-wrap gap-1">
                      {item.origin === 'nombre' && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">Por nombre</Badge>}
                      {item.origin === 'ia' && (
                        <Badge
                          className={
                            item.confidence === 'alta'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'
                          }
                        >
                          IA · {item.confidence}
                        </Badge>
                      )}
                      {product?.image_url && <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">Reemplaza la actual</Badge>}
                      {duplicate && <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Repetido: deja una</Badge>}
                      {item.state === 'error' && <span className="text-red-600">{item.error}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <ManualGrid catalog={catalog} products={products} tenantId={tenantId} />
    </div>
  );
}

/** Carga manual: una foto por producto, directo desde la cuadrícula. */
function ManualGrid({ catalog, products, tenantId }: { catalog: CatalogSnapshot; products: CatalogSnapshot['products']; tenantId: string }) {
  const router = useRouter();
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const term = search.trim().toLowerCase();
  const list = products.filter(
    (p) => (!onlyMissing || !p.image_url) && (category === 'all' || p.category_id === category) && (!term || p.name.toLowerCase().includes(term)),
  );

  const save = async (productId: string, url: string | null) => {
    setError(null);
    const r = await setProductImageAction(productId, url);
    if (!r.ok) setError(r.error);
    router.refresh();
  };

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Carga manual por producto</h3>
        <p className="text-sm text-zinc-500">Toca el recuadro de un producto para subir o cambiar su foto; se guarda al instante.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto" className="min-w-40 flex-1" type="search" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Categoría">
          <option value="all">Todas las categorías</option>
          {catalog.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-brand-500" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Sólo sin foto
        </label>
      </div>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">{onlyMissing ? 'Todos los productos de este filtro ya tienen foto.' : 'No hay productos con ese filtro.'}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.slice(0, 60).map((p) => (
            <li key={p.id} className="space-y-1 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="truncate text-sm font-semibold">{p.name}</p>
              <ProductImageField tenantId={tenantId} value={p.image_url} onChange={(url) => void save(p.id, url)} />
            </li>
          ))}
        </ul>
      )}
      {list.length > 60 && <p className="text-xs text-zinc-500">Mostrando 60 de {list.length}. Usa la búsqueda o la categoría para encontrar el resto.</p>}
    </Card>
  );
}
