# Tablero Kanban en tiempo real

SaaS multi-organización de tableros Kanban (proyecto de curso y portfolio).

## Base de datos

PostgreSQL 17 con dos roles:

- **Dueño** (`DATABASE_URL_OWNER`): ejecuta las migraciones y es dueño de todas las tablas. Lo usa también `systemDb` para las operaciones de sistema documentadas (sesiones, correo, reinicio de la demo).
- **`app_user`** (`DATABASE_URL`): el rol con el que trabaja la API. No es dueño de ninguna tabla ni tiene `BYPASSRLS`, así que la seguridad a nivel de fila (RLS) se le aplica siempre.

Cada petición abre una transacción y fija `app.user_id` y, dentro de una organización, `app.org_id` (con `set_config(..., true)`, equivalente a `SET LOCAL`). Las políticas de `apps/api/src/db/migrations/0001_rls.sql` solo dejan ver y escribir filas de esa organización; sin `app.org_id` no se ve ninguna.

### En local (Docker)

```bash
docker compose up -d                       # crea kanban, kanban_test y el rol app_user
pnpm --filter @kanban/api db:migrate       # con DATABASE_URL_OWNER en el entorno
pnpm test                                  # las pruebas migran kanban_test solas
```

Los scripts de `apps/api/db/init/` solo se ejecutan con un volumen nuevo. Si ya existía, recrearlo con `docker compose down -v && docker compose up -d` o ejecutar `01-roles.sql` a mano con `psql`.

### En Neon

1. Crear la base de datos; el rol dueño es el que da Neon (va en `DATABASE_URL_OWNER`).
2. Crear el rol de la aplicación **antes** de migrar, desde el editor SQL de Neon:

   ```sql
   CREATE ROLE app_user LOGIN PASSWORD '<contraseña segura>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   GRANT CONNECT ON DATABASE <base de datos> TO app_user;
   ```

3. Ejecutar `pnpm --filter @kanban/api db:migrate` con `DATABASE_URL_OWNER`. La migración `0001_rls.sql` da a `app_user` permisos de lectura y escritura sobre las tablas y activa RLS.
4. Poner en `DATABASE_URL` la cadena de conexión de `app_user`.
