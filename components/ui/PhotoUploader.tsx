'use client';

import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { MAX_UPLOAD_BYTES } from '@/lib/images/process';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/**
 * Sube una imagen (ya procesada en el navegador) a Supabase Storage y devuelve su dirección pública.
 * `folder` es la carpeta dentro del bucket (siempre empieza por el id del negocio: así lo exigen las políticas).
 */
export function PhotoUploader({
  bucket,
  folder,
  value,
  process,
  round = false,
  hint,
  onChange,
}: {
  bucket: string;
  folder: string;
  value: string | null;
  process: (file: File) => Promise<Blob>;
  round?: boolean;
  hint: string;
  onChange: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) return setError('El archivo debe ser una imagen');
    if (file.size > MAX_UPLOAD_BYTES) return setError('La imagen supera 15 MB');
    setUploading(true);
    try {
      const blob = await process(file);
      const path = `${folder}/${crypto.randomUUID()}.webp`;
      const storage = getSupabaseBrowserClient().storage.from(bucket);
      const { error: uploadError } = await storage.upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000' });
      if (uploadError) throw uploadError;
      onChange(storage.getPublicUrl(path).data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir la imagen');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn(
          'grid size-24 shrink-0 place-items-center overflow-hidden border-2 border-dashed border-zinc-300 bg-zinc-50 hover:border-brand-500 dark:border-zinc-700 dark:bg-zinc-800',
          round ? 'rounded-full' : 'rounded-2xl',
        )}
        aria-label={value ? 'Cambiar imagen' : 'Subir imagen'}
      >
        {uploading ? (
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        ) : value ? (
          <img src={value} alt="" className={cn('size-full', round ? 'object-cover' : 'object-contain p-1')} />
        ) : (
          <ImagePlus className="size-6 text-zinc-400" />
        )}
      </button>
      <div className="space-y-1 text-sm">
        <p className="text-zinc-500">{hint}</p>
        {value && (
          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onChange(null)}>
            <Trash2 className="size-4" /> Quitar
          </Button>
        )}
        {error && <p className="font-medium text-red-600">{error}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
