import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SupabaseProvider } from '@/components/providers/supabase-provider';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';
import { ThemeSync } from '@/components/theme/ThemeControl';
import { ThemeProvider } from '@/lib/theme/theme-provider';
import { ThemeEditorPanel } from '@/components/theme/ThemeEditorPanel';
import { googleFontsHrefs } from '@/lib/theme/theme-fonts';
import { Toaster } from 'sonner';

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

const fontLinks = googleFontsHrefs();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {fontLinks.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body className="bg-background text-text min-h-screen">
        <ThemeProvider>
          <ThemeSync />
          <SupabaseProvider>{children}</SupabaseProvider>
          <ThemeEditorPanel />
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
