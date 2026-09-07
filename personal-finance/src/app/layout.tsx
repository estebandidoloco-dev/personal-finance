import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SupabaseProvider } from '@/components/providers/supabase-provider';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';
import { ThemeSync } from '@/components/theme/ThemeControl';

export const metadata: Metadata = {
  title: 'Personal Finance',
  description: 'Gestión financiera personal',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F7F5' },
    { media: '(prefers-color-scheme: dark)', color: '#1A1D1B' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="bg-background text-text min-h-screen">
        <ThemeSync />
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
