# Despliegue en Neon + Render (plan gratuito)

Todo es gratis y no hace falta dominio. Tiempo estimado: 20-30 minutos. Las cuentas las crea el propietario del proyecto; nada de esto está hecho todavía.

## 0. Antes de empezar

- Repositorio en GitHub con la rama que quieras publicar (Render lee `render.yaml` de la raíz).
- Dos contraseñas largas inventadas por ti para la base de datos (una para el dueño y otra para `app_user`); guárdalas en un gestor de contraseñas.

## 1. Neon (PostgreSQL)

1. Entra en <https://neon.tech> y crea una cuenta (con GitHub vale).
2. **Create project**: nombre `kanban`, versión de Postgres 17, región cercana a la de Render (p. ej. Frankfurt, `eu-central-1`). Base de datos: `neondb` (la de por defecto).
3. El proyecto trae un rol propietario (por defecto `neondb_owner`). Ese rol **ejecuta las migraciones y el seed**; es el dueño de las tablas.
4. Crea el rol de la aplicación, que **no** es dueño de nada (así se aplica la seguridad por filas, RLS). En **SQL Editor** ejecuta, cambiando la contraseña:

   ```sql
   DO $$
   BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
       CREATE ROLE app_user LOGIN PASSWORD 'PON_AQUI_UNA_CONTRASENA_LARGA'
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
     END IF;
   END
   $$;
   GRANT CONNECT ON DATABASE neondb TO app_user;
   ```

   Es el equivalente de `apps/api/db/init/01-roles.sql` (que en local también apunta a las bases `kanban` y `kanban_test`; en Neon solo hay `neondb`). Debe existir **antes** de la primera migración, porque `0001_rls.sql` le da permisos.
5. Cadenas de conexión (botón **Connect** del panel de Neon). Neon da dos formas del host:
   - **Directa**: `ep-xxxx.region.aws.neon.tech`
   - **Con pool** (PgBouncer): `ep-xxxx-pooler.region.aws.neon.tech`

   Se usan así:

   | Variable | Rol | Host | Para qué |
   | --- | --- | --- | --- |
   | `DATABASE_URL_OWNER` | `neondb_owner` | **directo** | migraciones, seed y reinicio de la demo (usa `TRUNCATE`) |
   | `DATABASE_URL` | `app_user` | con pool (`-pooler`) | todas las peticiones de la app |

   Formato: `postgres://USUARIO:CONTRASENA@HOST/neondb?sslmode=require`. La app solo usa transacciones con `set_config(..., true)` (local a la transacción), por eso funciona con el pool en modo transacción.
6. Comprueba en el SQL Editor (con el rol propietario) que `app_user` existe: `select rolname from pg_roles where rolname = 'app_user';`.

## 2. Render

1. Entra en <https://render.com>, crea una cuenta y conecta tu GitHub.
2. **New → Blueprint**, elige el repositorio y la rama. Render lee `render.yaml` y propone un servicio web `kanban` en el plan **Free**.
3. Cuando pida las variables marcadas como secretas (`sync: false`), rellena:
   - `DATABASE_URL` → cadena de `app_user` con pool (paso 1.5).
   - `DATABASE_URL_OWNER` → cadena del propietario, host directo.
   - `APP_ORIGIN` → todavía no la sabes del todo: pon provisionalmente `https://kanban.onrender.com` y corrígela después (paso 5).
4. `SESSION_SECRET`, `UNSUBSCRIBE_SECRET` y `DEMO_RESET_TOKEN` los genera Render solos (aleatorios, más de 32 caracteres). Ya están fijadas: `NODE_ENV=production`, `NODE_VERSION=24`, `DEMO_MODE=true`, `MAIL_TRANSPORT=none` (solo buzón dentro de la app; el correo real se activa con Brevo, sección 5) y `TRUST_PROXY_HOPS=1`.
5. Pulsa **Apply**. El primer despliegue instala, compila el frontend, aplica las migraciones (también crea el esquema `pgboss` de la cola de correo y da a `app_user` los permisos justos para encolar) y carga los datos de demo (`db:seed-if-empty`, solo si no hay organizaciones). Tarda unos minutos.
6. Cuando termine, copia la URL pública (`https://<nombre>.onrender.com`). Si es distinta de la que pusiste, edítala en **Environment → `APP_ORIGIN`** (debe ser exactamente la URL, sin barra final) y guarda: Render redespliega. Si `APP_ORIGIN` no coincide, las peticiones de escritura dan 403 (comprobación de `Origin`).

El comando de build empieza por `corepack enable` (activa la versión de pnpm fijada en `packageManager`) y usa `pnpm install --frozen-lockfile --prod=false`: con `NODE_ENV=production` pnpm podría omitir las dependencias de desarrollo (vite, typescript), necesarias para compilar.

## 3. Verificación

```bash
curl https://<app>.onrender.com/api/health
# {"ok":true}

curl https://<app>.onrender.com/api/demo/users
# [{"email":"ana@demo.local","name":"Ana López","orgName":"Estudio Acme"}, ...]
```

Después, en el navegador:

1. Abre `https://<app>.onrender.com/entrar`: aparecen los botones «Entrar como Ana / Luis / Marta / Pablo».
2. Ventana normal: «Entrar como Ana». Ventana de incógnito: «Entrar como Luis». Abre el mismo tablero («Web corporativa») en ambas y mueve una tarjeta en la de Ana: se mueve en la de Luis sin recargar.
3. Entra como Pablo: no ve nada de «Estudio Acme».

## 4. Cosas a saber

- **Arranque en frío**: el plan gratuito duerme el servicio tras ~15 min sin visitas; la primera petición tarda ~1 minuto. La pantalla de entrada ya lo avisa.
- **Reinicio de la demo**: lo hace el propio servidor (tarea 15; todavía no está). Mientras tanto se puede forzar volviendo a cargar el seed con una base vacía.
- **Neon gratis** suspende la base tras unos minutos sin uso; la primera consulta puede tardar un segundo.
- Los secretos nunca van al repositorio: viven solo en el panel de Render.
- **Correo**: cada correo (menciones, asignaciones, comentarios, invitaciones) se guarda siempre en «Mi buzón» dentro de la app. Solo se envía de verdad con `MAIL_TRANSPORT=brevo` (o `smtp`), y nunca a usuarios de demo ni cuando el autor es de demo. Límites diarios (día UTC): 10 correos reales por dirección, 10 invitaciones por usuario y 250 en total (Brevo gratis permite 300). Si se supera, el correo queda en el buzón con estado «no enviado: límite diario». Cada correo lleva un enlace para darse de baja.

## 5. Correo real con Brevo (opcional)

Sin esto la demo funciona igual, pero los correos solo se ven en «Mi buzón».

1. Crea una cuenta gratuita en <https://www.brevo.com> (300 correos al día, sin dominio propio).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: añade tu dirección (p. ej. tu Gmail) y confírmala con el correo que te llega. Esa dirección verificada es el remitente.
3. **SMTP & API → SMTP**: anota el **Login** (algo como `xxxx@smtp-brevo.com`) y pulsa **Generate a new SMTP key**; copia la clave (solo se muestra una vez).
4. En Render, **Environment** del servicio:
   - `SMTP_USER` → el login SMTP de Brevo.
   - `SMTP_PASS` → la clave SMTP.
   - `MAIL_FROM` → el remitente verificado, p. ej. `Kanban demo <tu.direccion@gmail.com>`.
   - `MAIL_TRANSPORT` → cambia `none` por `brevo` (el servidor usa `smtp-relay.brevo.com:587` con STARTTLS).

   Guarda: Render redespliega. Con `MAIL_TRANSPORT=brevo` y alguna de las tres variables vacía, el servidor no arranca (lo indica en el log).
5. Prueba: regístrate con tu correo real, crea un proyecto e invita a otra dirección tuya, o pide a otra cuenta real que te mencione. El correo llega en unos segundos y también aparece en «Mi buzón». Los correos que fallan se reintentan 3 veces en total; si siguen fallando quedan como «fallido» en el buzón y en el log de Render.
6. Los primeros correos desde un remitente de Gmail a través de Brevo pueden acabar en spam: márcalos como «No es spam».
