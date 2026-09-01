# Personal Finance

Aplicación web para gestionar cuentas y un ledger personal de ingresos y gastos. Las operaciones financieras manuales se ejecutan mediante RPCs PostgreSQL atómicas; el saldo de cada cuenta es una caché derivada del saldo inicial y las transacciones confirmadas.

## Stack

- Next.js 16, React 19 y TypeScript
- Supabase Auth y PostgreSQL
- Row Level Security (RLS)
- Zod para validar contratos HTTP
- Tailwind CSS

## Requisitos

- Node.js compatible con Next.js 16
- npm
- Docker Desktop para Supabase local
- Supabase CLI, disponible como dependencia de desarrollo

## Instalación

```bash
npm install
```

Copia `.env.example` a `.env.local` y completa:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-local>
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DEFAULT_CURRENCY=MXN
```

No incluyas secretos en variables `NEXT_PUBLIC_*`. En particular, nunca uses `service_role` en componentes cliente, bundles del navegador ni archivos versionados.

## Supabase local

Si el repositorio aún no tiene `supabase/config.toml`, inicializa la configuración local una sola vez:

```bash
npx supabase init
```

Después levanta el stack y reconstruye la base local con las migraciones versionadas:

```bash
npx supabase start
npx supabase db reset
```

`db reset` elimina y recrea exclusivamente la base local. Para despliegues remotos, revisa primero el diff y la reconciliación financiera; no ejecutes `db push` de forma accidental.

Las migraciones están en `supabase/migrations/` y deben aplicarse en orden cronológico. No edites migraciones que ya puedan haber sido desplegadas; crea una nueva.

## Desarrollo

```bash
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`.

## Validación

```bash
npm run typecheck
npm run lint
npm run build
```

Los tres comandos deben finalizar correctamente antes de integrar cambios.
