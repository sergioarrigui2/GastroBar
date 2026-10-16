import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Foto de la persona; si no tiene, la inicial de su nombre. */
export function Avatar({
  name,
  url,
  size = 'md',
  agent = false,
  className,
}: {
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  agent?: boolean;
  className?: string;
}) {
  const box = { sm: 'size-8 text-sm', md: 'size-10', lg: 'size-14 text-2xl', xl: 'size-24 text-4xl' }[size];
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-100 font-bold dark:bg-zinc-800', box, className)}>
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : agent ? (
        <Bot className="size-1/2" />
      ) : (
        name.trim().slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/** Logo del negocio junto a su nombre (no se muestra nada si no hay logo). */
export function TenantLogo({ url, name, className }: { url?: string | null; name: string; className?: string }) {
  if (!url) return null;
  return <img src={url} alt={`Logo de ${name}`} className={cn('size-9 shrink-0 rounded-lg bg-white object-contain p-0.5', className)} />;
}
