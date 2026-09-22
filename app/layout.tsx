import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'GastroBar POS', template: '%s · GastroBar POS' },
  description: 'POS multi-tenant para gastrobares: comandero móvil, KDS en tiempo real y split-bill.',
  applicationName: 'GastroBar POS',
  appleWebApp: { capable: true, title: 'GastroBar', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

/**
 * Aplica el tema antes del primer pintado (sin parpadeo). Preferencia guardada >
 * KDS oscuro por defecto (pantallas de cocina/barra) > preferencia del sistema.
 */
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':(location.pathname.indexOf('/kds')===0||matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
