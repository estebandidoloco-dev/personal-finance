import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SupabaseProvider } from '@/components/providers/supabase-provider';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Personal Finance',
  description: 'Gestión financiera personal',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} antialiased`}>
      <body className="bg-background text-foreground min-h-screen">
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
