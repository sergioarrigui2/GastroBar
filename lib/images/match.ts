/**
 * Emparejamiento GRATIS (sin IA) de fotos con productos por el nombre del archivo:
 * "hamburguesa-mixta-patacon.jpg" → "Hamburguesa Mixta con Patacón".
 * Sólo se aceptan coincidencias claras; lo demás queda para revisión o para la IA.
 */
const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'con', 'sin', 'en', 'a', 'al', 'x', 'img', 'image', 'foto', 'photo', 'jpg', 'jpeg', 'png', 'webp', 'copia', 'copy']);

export function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

export type MatchCandidate = { id: string; name: string };

/**
 * Mejor producto para un nombre de archivo, o null si no hay uno claro.
 * Puntaje = palabras del producto presentes en el archivo / palabras del producto,
 * exigiendo al menos 2 palabras (o 1 si el producto tiene una sola) y ventaja sobre el segundo.
 */
export function matchByFilename(filename: string, products: MatchCandidate[]): { id: string; score: number } | null {
  const fileWords = new Set(words(filename));
  if (!fileWords.size) return null;
  const scored = products
    .map((p) => {
      const pw = [...new Set(words(p.name))];
      const hits = pw.filter((w) => fileWords.has(w)).length;
      // Palabras del archivo que no están en el producto restan (evita "limonada" → cualquier limonada).
      const extra = [...fileWords].filter((w) => !pw.includes(w)).length;
      return { id: p.id, hits, score: pw.length ? hits / pw.length - extra * 0.05 : 0, size: pw.length };
    })
    .filter((s) => s.hits >= Math.min(2, s.size) && s.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.hits - a.hits);
  const [best, second] = scored;
  if (!best) return null;
  if (second && second.score >= best.score - 0.1 && second.hits === best.hits) return null; // empate: que decida una persona
  return { id: best.id, score: Math.round(best.score * 100) / 100 };
}
