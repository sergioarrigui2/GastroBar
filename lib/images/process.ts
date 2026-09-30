'use client';

/**
 * Procesamiento de fotos en el navegador (nada pesado viaja al servidor):
 * recorte cuadrado centrado, WebP de hasta 1024 px para el menú y miniatura
 * JPEG de 320 px (~20 KB) cuando se pide ayuda a la IA.
 */
async function drawSquare(file: Blob, side: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const crop = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, crop);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, size, size);
  bitmap.close();
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), type, quality));

/** Foto para el menú: cuadrada, máx. 1024 px, WebP (~100 KB). */
export async function menuPhoto(file: Blob): Promise<Blob> {
  return toBlob(await drawSquare(file, 1024), 'image/webp', 0.85);
}

/** Miniatura para la IA: 320 px, JPEG, como data URL. */
export async function aiThumbnail(file: Blob): Promise<string> {
  const blob = await toBlob(await drawSquare(file, 320), 'image/jpeg', 0.7);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(blob);
  });
}

export const IMAGE_BUCKET = 'product-images';
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
