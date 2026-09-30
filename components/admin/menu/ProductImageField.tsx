'use client';

import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { IMAGE_BUCKET, MAX_UPLOAD_BYTES, menuPhoto } from '@/lib/images/process';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function ProductImageField({
  tenantId,
  value,
  onChange,
}: {
  tenantId: string;
  value: string | null;
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
      const blob = await menuPhoto(file);
      const path = `${tenantId}/${crypto.randomUUID()}.webp`;
      const storage = getSupabaseBrowserClient().storage.from(IMAGE_BUCKET);
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
        className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 hover:border-brand-500 dark:border-zinc-700 dark:bg-zinc-800"
        aria-label={value ? 'Cambiar imagen' : 'Subir imagen'}
      >
        {uploading ? (
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        ) : value ? (
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-6 text-zinc-400" />
        )}
      </button>
      <div className="space-y-1 text-sm">
        <p className="text-zinc-500">JPG, PNG o WebP. Se recorta en cuadrado y se optimiza automáticamente.</p>
        {value && (
          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onChange(null)}>
            <Trash2 className="size-4" /> Quitar imagen
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
