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
- **Reinicio de la demo**: lo hace el propio servidor al arrancar y cada hora si el último reinicio fue hace más de 24 h. Para forzarlo: `curl -X POST https://<app>.onrender.com/internal/demo/reset -H "Authorization: Bearer $DEMO_RESET_TOKEN"` (el token está en **Environment** de Render).
- **Neon gratis** suspende la base tras unos minutos sin uso; la primera consulta puede tardar un segundo.
- Los secretos nunca van al repositorio: viven solo en el panel de Render.
- **Correo**: cada correo (menciones, asignaciones, comentarios, invitaciones) se guarda siempre en «Mi buzón» dentro de la app. Solo se envía de verdad con `MAIL_TRANSPORT=brevo` (o `smtp`), y nunca a usuarios de demo ni cuando el autor es de demo. Límites diarios (día UTC): 10 correos reales por dirección, 10 invitaciones por usuario y 250 en total (Brevo gratis permite 300). Si se supera, el correo queda en el buzón con estado «no enviado: límite diario». Cada correo lleva un enlace para darse de baja.

## 5. Correo real con Brevo (opcional)

Sin esto la demo funciona igual, pero los correos solo se ven en «Mi buzón».

1. Crea una cuenta gratuita en <https://www.brevo.com> (300 correos al día, sin dominio propio).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: añade tu dirección (p. ej. tu Gmail) y confírmala con el correo que te llega. Esa dirección verificada es el remitente.
3. **SMTP & API → API Keys → Generate a new API key**: ponle un nombre (p. ej. `kanban-render`) y copia la clave (solo se muestra una vez). Es una **clave de API**, no la «SMTP key»: el plan gratuito de Render bloquea la salida por SMTP (puertos 25, 465 y 587), así que el servidor envía por la API HTTPS de Brevo (`https://api.brevo.com/v3/smtp/email`).
4. En Render, **Environment** del servicio:
   - `BREVO_API_KEY` → la clave de API.
   - `MAIL_FROM` → el remitente verificado del paso 2, p. ej. `Kanban demo <tu.direccion@gmail.com>` (si no está verificado, Brevo rechaza el envío).
   - `MAIL_TRANSPORT` → cambia `none` por `brevo`.

   Guarda: Render redespliega. Con `MAIL_TRANSPORT=brevo` y `BREVO_API_KEY` o `MAIL_FROM` vacías, el servidor no arranca (lo indica en el log).
5. Prueba: regístrate con tu correo real, crea un proyecto e invita a otra dirección tuya, o pide a otra cuenta real que te mencione. El correo llega en unos segundos y también aparece en «Mi buzón». Los correos que fallan (error o respuesta no 2xx de Brevo, o más de 10 s sin respuesta) se intentan 3 veces en total; si siguen fallando quedan como «fallido» en el buzón y en el log de Render, con el código y el mensaje de Brevo. Cada correo lleva la cabecera `List-Unsubscribe` con el enlace de baja.
6. Los primeros correos desde un remitente de Gmail a través de Brevo pueden acabar en spam: márcalos como «No es spam».

## 6. Verificación tras publicar

Con la URL pública ya en `APP_ORIGIN` y, si quieres correo real, `MAIL_TRANSPORT=brevo` (sección 5; sin Brevo, deja `none` y omite el último punto). Marca cada casilla:

- [ ] **Salud:** `curl https://<app>.onrender.com/api/health` devuelve `{"ok":true}` (la primera vez puede tardar ~1 minuto).
- [ ] **Demo:** `curl https://<app>.onrender.com/api/demo/users` devuelve los 4 usuarios y `/entrar` muestra los botones «Entrar como …».
- [ ] **Guion de prueba, pasos 1 a 4** (del [README](../README.md#guion-de-prueba)), en dos ventanas (una de incógnito):
  1. Ana mueve una tarjeta y Luis la ve moverse sin recargar.
  2. Crear, editar y borrar una tarjeta; añadir, renombrar, reordenar y borrar una columna.
  3. Ana menciona a Luis (escribe `@Lu` y lo elige en la lista): sube su campana y el correo aparece en «Mi buzón» con «Solo buzón (demo)».
  4. Pablo («Otra Empresa») no ve nada de Estudio Acme y, al abrir la dirección de un tablero de Acme, ve «Esta organización no existe o no tienes acceso a ella.» con un enlace a su organización (la URL no cambia).
- [ ] **Paso 5, correo real** (solo con Brevo): regístrate con tu correo real, crea una organización e invita a otra dirección tuya. El correo de invitación llega a la bandeja de entrada (mira también el spam) y el enlace funciona. Con `MAIL_TRANSPORT=brevo`, la invitación aparece en «Mi buzón» como «Enviado».
- [ ] **Reinicio:** `POST /internal/demo/reset` con el token da 204 y deja los datos de ejemplo.
- [ ] En el README, sustituye `<tu-app>` y `<usuario>/<repo>` por los valores reales y quita el aviso de «pendiente de publicar».
