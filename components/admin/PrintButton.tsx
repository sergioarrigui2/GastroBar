'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

export function PrintButton({ label = 'Imprimir' }: { label?: string }) {
  return (
    <Button onClick={() => window.print()}>
      <Printer className="size-4" /> {label}
    </Button>
  );
}
