'use client';

import { useState, Suspense } from 'react';
import { useSupabase } from '@/components/providers/supabase-provider';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const { supabase } = useSupabase();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRedirect = searchParams.get('redirect');
  const redirectTo =
    requestedRedirect?.startsWith('/dashboard') && !requestedRedirect.startsWith('//')
      ? requestedRedirect
      : '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) {
        setError(loginError.message);
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servicio de autenticación.');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');

    try {
      const { error: magicLinkError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}${redirectTo}` },
      });
      if (magicLinkError) {
        setError(magicLinkError.message);
      } else {
        setNotice('Revisa tu email para el enlace mágico');
      }
    } catch {
      setError('No se pudo conectar con el servicio de autenticación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border bg-surface p-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-bold">Iniciar sesión</h1>

        {error && <div role="alert" className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger">{error}</div>}
        {notice && (
          <div className="mb-4 rounded-xl border border-success bg-success-soft p-3 text-sm text-success">{notice}</div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-surface px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-surface px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="min-h-11 w-full rounded-xl bg-primary py-2 text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar con contraseña'}
          </button>
        </form>

        <div className="mt-4 border-t pt-4">
          <form onSubmit={handleMagicLink} className="space-y-2">
            <p className="text-center text-sm text-text-muted">
              O entra sin contraseña:
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Tu email"
                required
                className="flex-1 bg-surface px-3 py-2"
              />
              <button
                type="submit"
                disabled={loading || !email}
                className="min-h-11 rounded-xl border bg-surface px-4 py-2 text-text hover:bg-surface-subtle disabled:opacity-50"
              >
                Enviar enlace mágico
              </button>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-text-muted">
          ¿No tienes cuenta?{' '}
          <a href="/signup" className="text-primary hover:underline">
            Regístrate
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={<div className="flex min-h-screen items-center justify-center">Cargando...</div>}
    >
      <LoginForm />
    </Suspense>
  );
}
