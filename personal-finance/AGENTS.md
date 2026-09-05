<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Constitución Técnica del Proyecto

## 1. Propósito

`personal-finance` es una aplicación web de finanzas personales para gestionar:

- cuentas individuales;
- ingresos y gastos;
- categorías y etiquetas;
- saldos derivados de un ledger financiero;
- importaciones CSV con deduplicación;
- autenticación y aislamiento por usuario.

El objetivo del MVP es ofrecer operaciones financieras correctas, auditables y seguras, con una arquitectura simple y preparada para evolucionar sin romper la contabilidad.

## 2. Stack

- Next.js 16
- React 19
- TypeScript
- Supabase Auth
- PostgreSQL
- Row Level Security (RLS)
- Supabase SSR
- Zod para validación de contratos HTTP
- Tailwind CSS
- PapaParse para procesamiento CSV
- Recharts para visualizaciones
- ESLint
- Supabase CLI para desarrollo local
- Docker Desktop para Supabase local

## 3. Arquitectura

### Frontend

El frontend utiliza Next.js App Router.

Responsabilidades:

- renderizar páginas y componentes;
- capturar entradas del usuario;
- validar formatos básicos;
- consumir APIs internas;
- mostrar estados de carga, error y éxito;
- nunca ejecutar operaciones contables directamente.

Las páginas protegidas se encuentran bajo `/dashboard`.

### Backend

Next.js App Router expone Route Handlers para la API interna en `src/app/api`.

`src/proxy.ts` gestiona el refresh y la protección de sesión para la navegación. No sustituye la autenticación independiente que debe realizar cada Route Handler.

PostgreSQL/Supabase sigue siendo la autoridad de datos y contabilidad.

Responsabilidades de los Route Handlers:

- autenticar al usuario;
- validar el body con Zod;
- autorizar recursos mediante `auth.uid()` y RLS;
- invocar RPCs PostgreSQL para mutaciones financieras;
- devolver contratos HTTP consistentes;
- no duplicar lógica financiera en TypeScript.

### Base de datos

PostgreSQL es la autoridad contable.

- `transactions` es el ledger.
- `accounts.initial_balance` representa el saldo inicial contable.
- `accounts.balance` es una caché derivada.
- Los triggers mantienen el balance.
- Las RPCs financieras son atómicas.
- Las escrituras financieras directas están restringidas.

### Autenticación y autorización

- Supabase Auth gestiona la identidad.
- `auth.uid()` determina el propietario.
- RLS protege las tablas.
- `is_shared` no concede acceso a otros usuarios.
- Las categorías globales son de solo lectura.
- El proxy protege la navegación, pero cada API debe autenticar de forma independiente.

### Importaciones CSV

El importador utiliza:

- preparación y normalización en servidor;
- preview de filas;
- importación batch;
- deduplicación fuerte por archivo y external ID;
- detección heurística mediante `possible_duplicate`;
- la misma primitiva financiera utilizada por operaciones manuales.

Las importaciones nunca escriben directamente en el ledger ignorando las RPCs aprobadas.

## 4. Decisiones cerradas

Estas decisiones están aprobadas y no deben cambiarse sin autorización explícita.

### P0.1: Modelo y autorización

- El modelo es individual.
- Cada recurso pertenece a un usuario.
- `auth.uid()` es la fuente de identidad y propiedad.
- RLS debe estar habilitado y ser explícito.
- Las categorías globales son read-only.
- `is_shared` no concede acceso.
- No se implementará colaboración multiusuario en el MVP.

### P0.2: Modelo contable

- `amount` siempre es mayor que cero.
- `kind` solo puede ser `income` o `expense`.
- Solo las transacciones con `status = 'posted'` afectan el balance.
- El saldo se calcula conceptualmente como:
	`initial_balance + impacto del ledger`.
- `accounts.balance` es una caché mantenida por PostgreSQL.
- PostgreSQL mantiene el balance mediante trigger.
- Las operaciones financieras utilizan RPCs atómicas.
- El trigger contable es obligatorio para insert, update y delete.
- Las cuentas afectadas se bloquean con `FOR NO KEY UPDATE`.
- El balance se actualiza con:
	`balance = balance + delta`.

### P0.3: Privilegios y escrituras

- Los privilegios PostgreSQL deben ser explícitos.
- `transactions` y `transaction_tags` no aceptan writes directos de `authenticated`.
- Las escrituras financieras se ejecutan mediante RPC.
- No se utiliza `service_role` en el cliente.
- Typecheck, lint y build deben permanecer limpios.

### P1.1: Importador CSV

- La importación se procesa por batches.
- La deduplicación fuerte usa `file_hash` y `external_id`.
- `possible_duplicate` es únicamente heurístico.
- Las filas posibles duplicadas requieren una decisión explícita para importarse.
- No se permiten inserciones directas al ledger.
- Cada importación debe conservar historial y contadores de resultado.
- Una importación puede finalizar como `completed`, `partial` o `failed`.

### P1.2: Categorías y etiquetas

- El MVP incluye CRUD de categorías y etiquetas.
- Las categorías globales son read-only.
- Las categorías personales están protegidas por ownership.
- `budgets.category_id` usa `ON DELETE RESTRICT`.
- El trigger financiero de `transactions` solo se ejecuta ante cambios en `account_id`, `amount`, `kind` o `status`.
- Los cambios no financieros, incluidos categoría, descripción, notas y metadatos, no alteran el balance.

### MVP: MXN-only

- La moneda del producto para el MVP es exclusivamente `MXN`.
- Las columnas `currency` permanecen en PostgreSQL para conservar la capacidad futura del esquema.
- Las nuevas cuentas creadas por el MVP deben usar `MXN`.
- El MVP no incluye FX ni conversión de monedas.
- El MVP no expone un selector de moneda.
- Multicurrency queda fuera de alcance y requerirá una feature futura explícita.

### Timezone del MVP

- El timezone del producto es `America/Mexico_City`.
- Las fechas financieras y bancarias se almacenan como PostgreSQL `DATE`.
- Las fechas bancarias no deben sufrir conversiones UTC.
- Un timezone configurable por perfil queda fuera del alcance actual.

### P1.3: Dashboard financiero

- El dashboard es read-only.
- Solo las transacciones con `status = 'posted'` entran en las métricas.
- El saldo actual no depende del periodo seleccionado.
- `recent_transactions` representa las últimas 10 transacciones `posted` globales del usuario.
- `recent_transactions` no depende del periodo seleccionado.
- El contrato público del dashboard es MXN-only.
- El contrato público no expone estructuras multicurrency.

### Contratos monetarios y calendario del dashboard

- Todo importe del dashboard es un decimal string exacto con dos posiciones; nunca se convierte a JavaScript `number`.
- Los importes signed aceptan `-0.01`, pero `-0.00` no es una representación canónica válida.
- Los agregados deben conservar exactitud aunque sus centavos excedan `Number.MAX_SAFE_INTEGER`.
- `time_series.points` cubre siempre cada fecha del periodo, incluso sin movimientos; los días vacíos usan `"0.00"`.
- `last_30_days` contiene siempre exactamente 30 puntos consecutivos.

## 5. Invariante contable obligatorio

Para cada cuenta debe cumplirse siempre:

```text
stored_balance =
	initial_balance + SUM(impacto de transactions posted)
```

Reglas de impacto:

```text
income  => +amount
expense => -amount
no posted => 0
```

Toda modificación que pueda romper esta igualdad debe detenerse y corregirse antes de continuar.

No se acepta:

- actualizar `accounts.balance` desde el frontend;
- cambiar una transacción sin ajustar el balance;
- borrar una transacción sin revertir su impacto;
- insertar una transacción con moneda distinta a la cuenta;
- reinterpretar silenciosamente datos financieros ambiguos.

## 6. Reglas de seguridad

### Autenticación

- Toda ruta protegida debe validar `supabase.auth.getUser()`.
- No se debe confiar únicamente en datos enviados por el cliente.
- El usuario autenticado debe derivarse de la sesión, nunca del body.

### Autorización

- Cada consulta debe limitarse al usuario autenticado.
- Las RPCs deben validar propiedad de cuenta, categoría, etiqueta e importación.
- Nunca se debe asumir que conocer un UUID concede acceso.
- `is_shared` no modifica la autorización.

### RLS y privilegios

- RLS debe permanecer habilitado en recursos protegidos.
- Las policies deben ser explícitas y revisables.
- Los privilegios `authenticated`, `anon`, `public` y `service_role` deben revisarse por separado.
- `SECURITY DEFINER` no debe usarse por conveniencia.
- Se debe preferir `SECURITY INVOKER` + RLS cuando sea suficiente.
- Toda nueva función `SECURITY DEFINER` debe estar justificada explícitamente y aplicar el privilegio mínimo necesario.
- Las funciones `SECURITY DEFINER` deben:
	- usar `search_path` controlado;
	- validar `auth.uid()`;
	- comprobar propiedad de los recursos;
	- exponer solo el privilegio mínimo necesario.

### Secretos

- Nunca usar `service_role` en componentes cliente, bundles o archivos versionados.
- No incluir secretos en variables `NEXT_PUBLIC_*`.
- No imprimir tokens, claves ni credenciales en logs o respuestas.
- No crear configuraciones remotas dentro de `.env.local`.

### Validación

- Validar todo input externo.
- Rechazar cantidades no positivas.
- Rechazar enums desconocidos.
- Aplicar límites de tamaño, longitud y cantidad de filas.
- No construir SQL concatenando input del usuario.
- No devolver información de recursos que el usuario no puede consultar.

## 7. Reglas de migraciones

- Nunca modificar una migración histórica.
- Todo cambio de esquema requiere una nueva migración cronológica.
- Las migraciones deben ser idempotentes cuando sea razonable; no es un requisito absoluto.
- La prioridad es la reproducibilidad desde cero, el orden cronológico y no modificar migraciones históricas.
- Cada migración debe documentar su propósito.
- Toda migración financiera debe verificar:
	- impacto sobre balances existentes;
	- compatibilidad con triggers;
	- RLS;
	- privilegios;
	- RPCs;
	- tipos generados.
- No cambiar las decisiones P0/P1 mediante una migración sin aprobación del Lead.
- No ejecutar `db push`.
- No aplicar migraciones a Supabase remoto.
- Antes de proponer una migración, revisar reconciliación contable e impacto sobre datos históricos.
- Las nuevas migraciones deben probarse únicamente contra Supabase local o mediante revisión estática si el entorno local no está disponible.

- Las migraciones que reafirmen la frontera MXN deben revalidar datos y privilegios bajo un lock de tabla que impida escritores concurrentes cuando corresponda.

## 8. Reglas de Git

- No hacer commits automáticamente.
- No crear ramas automáticamente.
- No ejecutar `git reset --hard`.
- No usar `git checkout --` para descartar cambios.
- No revertir cambios de otros agentes o del usuario.
- Mantener los cambios enfocados en la tarea.
- No reformatear archivos no relacionados.
- Revisar `git diff` antes de entregar trabajo.
- No mezclar refactors con features salvo que sean imprescindibles.
- Nunca versionar `.env.local`, `.env.remote.local`, `supabase/.temp/`, `supabase/.branches/`, secretos o credenciales generadas localmente.
- Todo cambio debe indicar archivos afectados, riesgos y validaciones ejecutadas.

## 9. Supabase local y remoto

### Supabase local

Se puede utilizar Supabase local con Docker Desktop para:

- ejecutar migraciones;
- probar RLS;
- probar RPCs;
- validar triggers;
- ejecutar pruebas SQL;
- probar importaciones CSV.

Comandos permitidos cuando el agente tenga autorización:

```bash
npx supabase start
npx supabase db reset
npx supabase status -o env
npx supabase stop
```

`db reset` elimina únicamente la base local y debe ejecutarse sabiendo que destruye sus datos locales.

### Supabase remoto

Está prohibido:

- ejecutar `supabase db push`;
- acceder a una instancia remota;
- ejecutar SQL remoto;
- modificar datos remotos;
- utilizar claves remotas sin autorización explícita;
- mezclar URL local con claves remotas.

Antes de cualquier despliegue remoto se requiere:

1. revisión del diff de migraciones;
2. revisión de privilegios y RLS;
3. reconciliación contable;
4. aprobación explícita del Lead y del responsable del proyecto.

## 10. Responsabilidades por agente

### Lead

Responsabilidades:

- definir el objetivo y alcance de cada tarea;
- dividir features en tareas pequeñas;
- definir contratos frontend/backend;
- asignar trabajo a los demás agentes;
- proteger las decisiones P0/P1;
- revisar arquitectura y riesgos;
- aprobar cambios de esquema;
- revisar resultados de Backend, Frontend y Security/QA;
- decidir cuándo una tarea está Done.

El Lead coordina y revisa. No debe implementar features grandes directamente salvo solicitud explícita.

### Backend

Responsabilidades:

- implementar y mantener Route Handlers;
- definir y validar contratos HTTP;
- implementar RPCs y lógica PostgreSQL;
- proteger RLS y privilegios;
- mantener la invariancia contable;
- crear migraciones nuevas cuando sean necesarias;
- mantener tipos de base de datos;
- añadir pruebas SQL y de API;
- documentar errores y estados de respuesta.

### Frontend

Responsabilidades:

- implementar páginas y componentes;
- consumir contratos API aprobados;
- manejar estados de carga, vacío, error y éxito;
- validar entradas antes de enviarlas;
- mantener accesibilidad y diseño coherente;
- no duplicar lógica de autorización, contabilidad o deduplicación;
- no realizar escrituras directas en Supabase para operaciones financieras.

### Security/QA

Responsabilidades:

- revisar el diff completo de la tarea antes de aprobar;
- revisar autenticación y autorización;
- revisar RLS y privilegios;
- comprobar ausencia de `service_role` en cliente;
- probar aislamiento entre usuarios;
- probar límites y payloads inválidos;
- probar concurrencia y operaciones contables;
- probar deduplicación CSV;
- verificar regresiones;
- ejecutar typecheck, lint, build y pruebas relevantes;
- reportar hallazgos por severidad y con reproducción.

## 11. Límites de cada agente

### Límites del Lead

- No aprobar cambios que contradigan P0/P1 sin detener el trabajo.
- No aceptar una feature sin contrato y criterios de aceptación.
- No declarar Done con validaciones fallidas.
- No ignorar riesgos contables o de seguridad.

### Límites del Backend

- No modificar migraciones históricas.
- No añadir writes directos a tablas financieras.
- No cambiar el modelo contable sin aprobación.
- No usar `service_role` como solución por defecto.
- No introducir dependencias nuevas sin justificación.
- No ocultar errores de autorización como respuestas exitosas.

### Límites del Frontend

- No acceder a `service_role`.
- No modificar balances localmente como fuente de verdad.
- No llamar RPCs financieras directamente desde el navegador salvo contrato explícitamente aprobado.
- No asumir que `is_shared` concede permisos.
- No implementar una segunda versión de las reglas contables.

### Límites de Security/QA

- No cambiar código para ocultar un fallo sin registrar su causa.
- No modificar datos remotos.
- No ejecutar `db push`.
- No aprobar con pruebas omitidas cuando el riesgo afecta contabilidad, autorización o migraciones.
- No convertir pruebas temporales en cambios permanentes sin coordinación con Lead.

## 12. Definición de Done

Una tarea está Done cuando:

- el alcance aprobado está implementado;
- el contrato entre capas está documentado;
- la solución respeta P0.1, P0.2, P0.3, P1.1, P1.2 y las decisiones cerradas del MVP y P1.3 que le apliquen;
- no rompe la invariancia contable;
- la autenticación, autorización y RLS fueron revisadas;
- no existen writes financieros no autorizados;
- las cuentas nuevas del MVP solo pueden usar `MXN` y ninguna interfaz pública expone selección o agregación multicurrency;
- las fechas financieras conservan semántica PostgreSQL `DATE` sin conversiones UTC y los periodos usan `America/Mexico_City`;
- el dashboard mantiene el saldo actual independiente del periodo, limita sus métricas a transacciones `posted` y mantiene `recent_transactions` independiente del periodo;
- las migraciones nuevas fueron revisadas y probadas localmente;
- los estados de frontend están completos;
- las pruebas relevantes pasan;
- `npm run typecheck` pasa;
- `npm run lint` pasa;
- `npm run build` pasa;
- los cambios están revisados con `git diff`;
- `git status` fue revisado y confirma que no hay harnesses temporales, secretos ni archivos generados locales inesperados;
- las tareas que afecten auth, RLS/permisos, migraciones, operaciones financieras, importación CSV o cualquier cambio de seguridad tienen revisión PASS de Security/QA;
- los riesgos residuales están documentados;
- el Lead acepta el resultado.

## 13. Comandos obligatorios de validación

Desde la raíz del proyecto:

```bash
npm run typecheck
npm run lint
npm run build
git status
```

Para cambios relacionados con CSV:

```bash
node --test tests/csv-normalization.test.mts
node tests/api/csv-import-api.mjs
```

Para cambios SQL o financieros:

- ejecutar las pruebas SQL locales relevantes;
- probar insert, update y delete;
- probar transacciones `posted` y no `posted`;
- comprobar la invariancia contable;
- probar aislamiento entre usuarios;
- probar concurrencia cuando aplique.

La revisión final de `git status` debe confirmar que:

- no hay harnesses temporales;
- no hay secretos;
- no hay archivos generados locales inesperados.

No se considera válida una ejecución desde un directorio que no contenga el `package.json` del proyecto.

## 14. Cuándo detenerse y pedir aprobación

Un agente debe detenerse y pedir aprobación explícita cuando:

- la solución requiere cambiar una decisión P0 o P1;
- se necesita modificar una migración histórica;
- se necesita crear una nueva migración con impacto financiero;
- se propone cambiar el modelo de propietario o autorización;
- se propone introducir colaboración multiusuario;
- se requiere acceso a Supabase remoto;
- se considera ejecutar `supabase db push`;
- se necesita usar `service_role`;
- se requiere añadir una dependencia nueva;
- existe una discrepancia contable no explicada;
- una operación puede romper la invariancia de balance;
- las pruebas contradicen el contrato esperado;
- hay cambios de otros agentes que bloquean la tarea;
- no está claro si un comportamiento es correcto o si requiere decisión de producto;
- una vulnerabilidad no puede resolverse sin ampliar el alcance aprobado.

Cuando se detenga, el agente debe informar:

1. qué decisión o bloqueo encontró;
2. qué archivos y comportamiento están afectados;
3. qué alternativas existen;
4. qué riesgo tiene cada alternativa;
5. qué aprobación necesita para continuar.
